const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { findProgramme } = require('./programmes');

const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'applications'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, and PDF files are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const { ROLES } = require('../utils/roles');
const { getStaffContext } = require('./staff');

// Run the upload and turn upload problems into clear messages for the applicant
function handleDocumentUpload(req, res, next) {
  upload.array('documents', 5)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'Each document must be 5MB or smaller.' });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ message: 'You can upload up to 5 documents.' });
      return res.status(400).json({ message: 'Upload error: ' + err.message });
    }
    return res.status(400).json({ message: err.message || 'Upload failed.' });
  });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', handleDocumentUpload, async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const phone = (req.body.phone || '').trim();
  const programmeName = (req.body.programme || '').trim();
  const { qualifications } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required.' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }

  const match = programmeName ? findProgramme(programmeName) : null;
  if (!match) {
    return res.status(400).json({ message: 'Please choose a programme from the list.' });
  }

  let parsedQualifications = [];
  if (qualifications) {
    try {
      parsedQualifications = JSON.parse(qualifications);
    } catch (err) {
      return res.status(400).json({ message: 'Qualifications could not be read. Please try again.' });
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [appResult] = await connection.query(
      'INSERT INTO applications (name, email, phone, programme, school, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, phone || null, match.programme.name, match.school.name, 'pending']
    );

    const applicationId = appResult.insertId;

    for (const q of parsedQualifications) {
      if (!q.subject || q.result === undefined) continue;
      await connection.query(
        'INSERT INTO application_qualifications (application_id, subject, result) VALUES (?, ?, ?)',
        [applicationId, q.subject, q.result]
      );
    }

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await connection.query(
          'INSERT INTO application_documents (application_id, file_name, file_path, file_type) VALUES (?, ?, ?, ?)',
          [applicationId, file.originalname, file.path, file.mimetype]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ application_id: applicationId, message: 'Application submitted successfully.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ message: 'Failed to submit application. Please try again.' });
  } finally {
    connection.release();
  }
});

// =====================================================================
// Staff review (who can see / decide is set in utils/roles.js)
//   - View + add notes: ROLES.APP_VIEW
//   - Accept / reject:  ROLES.APP_DECIDE (Registrar, Principal, Administrator)
//   - Head of Department only sees applications for their own school
// =====================================================================

// Returns the staff context, or sends an error and returns null
async function staffScope(req, res) {
  const ctx = await getStaffContext(req);
  if (ctx.scoped && !ctx.school) {
    res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');
    return null;
  }
  return ctx;
}

// Load one application if this staff member is allowed to see it
async function getVisibleApplication(id, ctx) {
  const [rows] = await pool.query('SELECT * FROM applications WHERE application_id = ?', [id]);
  const app = rows[0];
  if (!app) return null;
  if (ctx.scoped && app.school !== ctx.school) return null;
  return app;
}

// LIST applications (?status=pending|accepted|rejected&q=search)
router.get('/', verifyToken, checkRole(...ROLES.APP_VIEW), async (req, res) => {
  try {
    const ctx = await staffScope(req, res);
    if (!ctx) return;

    const where = [];
    const params = [];
    if (ctx.scoped) { where.push('a.school = ?'); params.push(ctx.school); }
    if (['pending', 'accepted', 'rejected'].includes(req.query.status)) { where.push('a.status = ?'); params.push(req.query.status); }
    if (req.query.school && !ctx.scoped) { where.push('a.school = ?'); params.push(req.query.school); }
    if (req.query.q) {
      where.push('(a.name LIKE ? OR a.email LIKE ? OR a.programme LIKE ? OR a.application_id = ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like, Number(String(req.query.q).replace(/\D/g, '')) || 0);
    }

    const [rows] = await pool.query(
      `SELECT a.application_id, a.name, a.email, a.phone, a.programme, a.school, a.status,
              DATE_FORMAT(a.applied_at, '%Y-%m-%d %H:%i') AS applied_at,
              d.name AS department_name,
              (SELECT COUNT(*) FROM application_notes n WHERE n.application_id = a.application_id) AS notes_count,
              (SELECT COUNT(*) FROM application_documents ad WHERE ad.application_id = a.application_id) AS documents_count
       FROM applications a
       LEFT JOIN departments d ON a.department_id = d.department_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (a.status = 'pending') DESC, a.applied_at DESC
       LIMIT 500`,
      params
    );
    res.json({ school: ctx.scoped ? ctx.school : null, can_decide: ROLES.APP_DECIDE.includes(ctx.role), applications: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch applications.');
  }
});

// DOWNLOAD a supporting document
router.get('/documents/:documentId', verifyToken, checkRole(...ROLES.APP_VIEW), async (req, res) => {
  try {
    const ctx = await staffScope(req, res);
    if (!ctx) return;

    const [rows] = await pool.query('SELECT * FROM application_documents WHERE document_id = ?', [req.params.documentId]);
    if (rows.length === 0) return res.status(404).send('Document not found.');
    const doc = rows[0];
    if (!(await getVisibleApplication(doc.application_id, ctx))) return res.status(404).send('Document not found.');

    res.setHeader('Content-Type', doc.file_type);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`);
    res.sendFile(doc.file_path, err => {
      if (err && !res.headersSent) res.status(404).send('The file for this document is missing.');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch document.');
  }
});

// GET one application with qualifications, documents and staff notes
router.get('/:id', verifyToken, checkRole(...ROLES.APP_VIEW), async (req, res) => {
  try {
    const ctx = await staffScope(req, res);
    if (!ctx) return;
    const app = await getVisibleApplication(req.params.id, ctx);
    if (!app) return res.status(404).send('Application not found.');

    const [[extra]] = await pool.query(
      `SELECT d.name AS department_name, u.name AS decided_by_name,
              DATE_FORMAT(a.applied_at, '%Y-%m-%d %H:%i') AS applied_at_text,
              DATE_FORMAT(a.decided_at, '%Y-%m-%d %H:%i') AS decided_at_text
       FROM applications a
       LEFT JOIN departments d ON a.department_id = d.department_id
       LEFT JOIN USERS u ON a.decided_by = u.user_id
       WHERE a.application_id = ?`,
      [app.application_id]
    );
    const [qualifications] = await pool.query(
      'SELECT subject, result FROM application_qualifications WHERE application_id = ?', [app.application_id]);
    const [documents] = await pool.query(
      'SELECT document_id, file_name, file_type FROM application_documents WHERE application_id = ?', [app.application_id]);
    const [notes] = await pool.query(
      `SELECT n.note_id, n.note, DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i') AS created_at, u.name AS author, u.role AS author_role
       FROM application_notes n JOIN USERS u ON n.user_id = u.user_id
       WHERE n.application_id = ? ORDER BY n.created_at`,
      [app.application_id]
    );
    // Has this applicant already registered an account with the same email?
    const [accounts] = await pool.query('SELECT user_id, status, role FROM USERS WHERE email = ?', [app.email]);

    res.json({
      application_id: app.application_id,
      name: app.name,
      email: app.email,
      phone: app.phone,
      programme: app.programme,
      school: app.school,
      status: app.status,
      applied_at: extra.applied_at_text,
      department_name: extra.department_name,
      decided_by: extra.decided_by_name,
      decided_at: extra.decided_at_text,
      qualifications,
      documents,
      notes,
      account: accounts[0] || null,
      can_decide: ROLES.APP_DECIDE.includes(ctx.role)
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch application.');
  }
});

// ADD a staff note
router.post('/:id/notes', verifyToken, checkRole(...ROLES.APP_VIEW), async (req, res) => {
  const note = (req.body.note || '').trim();
  if (!note) return res.status(400).send('Write a note first.');
  if (note.length > 1000) return res.status(400).send('Notes must be 1000 characters or fewer.');

  try {
    const ctx = await staffScope(req, res);
    if (!ctx) return;
    if (!(await getVisibleApplication(req.params.id, ctx))) return res.status(404).send('Application not found.');

    await pool.query('INSERT INTO application_notes (application_id, user_id, note) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, note]);
    res.status(201).send('Note added.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to add note.');
  }
});

// ACCEPT / REJECT (or reopen as pending) — Registrar, Principal, Administrator only
router.put('/:id/status', verifyToken, checkRole(...ROLES.APP_DECIDE), async (req, res) => {
  const { status } = req.body;
  const note = (req.body.note || '').trim();

  if (!['pending', 'accepted', 'rejected'].includes(status)) {
    return res.status(400).send('Status must be pending, accepted, or rejected.');
  }
  if (note.length > 1000) return res.status(400).send('Notes must be 1000 characters or fewer.');

  try {
    const ctx = await staffScope(req, res);
    if (!ctx) return;
    if (!(await getVisibleApplication(req.params.id, ctx))) return res.status(404).send('Application not found.');

    await pool.query(
      `UPDATE applications SET status = ?, decided_by = ?, decided_at = ${status === 'pending' ? 'NULL' : 'NOW()'}
       WHERE application_id = ?`,
      [status, status === 'pending' ? null : req.user.id, req.params.id]
    );

    const label = { accepted: 'Accepted', rejected: 'Rejected', pending: 'Reopened' }[status];
    await pool.query('INSERT INTO application_notes (application_id, user_id, note) VALUES (?, ?, ?)',
      [req.params.id, req.user.id, note ? `${label}: ${note}` : label]);

    res.send({ accepted: 'Application accepted.', rejected: 'Application rejected.', pending: 'Application reopened.' }[status]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update application status.');
  }
});

module.exports = router;
