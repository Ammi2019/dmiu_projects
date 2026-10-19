// Course notes: lecturers upload Units 1–5 for each course; students read them in their Library.
// Access follows the same rule as assignments: a lecturer posts within their own school, to one
// programme or to every programme in it; students see notes for their school + programme.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { findSchool } = require('./programmes');
const { notify, studentUserIds } = require('../utils/notify');

const router = express.Router();
const LECTURER_ROLES = ['lecturer', 'class_teacher'];
const MAX_UNITS = 5;

const NOTES_DIR = path.join(__dirname, '..', 'uploads', 'notes');
fs.mkdirSync(NOTES_DIR, { recursive: true });
const ALLOWED = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip', '.png', '.jpg', '.jpeg'];

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, NOTES_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `notes-${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (ALLOWED.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
        else cb(new Error('Allowed file types: PDF, Word, PowerPoint, Excel, TXT, ZIP, PNG, JPEG.'));
    },
    limits: { fileSize: 20 * 1024 * 1024 }
});
const removeFile = name => name && fs.unlink(path.join(NOTES_DIR, path.basename(name)), () => {});

async function getLecturer(userId) {
    const [rows] = await pool.query('SELECT lecturer_id, school FROM LECTURERS WHERE user_id = ?', [userId]);
    return rows[0] || null;
}
async function getStudent(userId) {
    const [rows] = await pool.query('SELECT student_id, school, programme FROM students WHERE user_id = ?', [userId]);
    return rows[0] || null;
}

const NOTE_FIELDS = `n.note_id, n.school, n.programme, n.course_name, n.unit_no, n.title, n.description,
    n.file_name, n.file_type, DATE_FORMAT(n.updated_at, '%Y-%m-%d') AS updated_at`;

// =====================================================================
// Lecturer
// =====================================================================

// GET my notes
router.get('/teaching', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const [rows] = await pool.query(
            `SELECT ${NOTE_FIELDS} FROM course_notes n WHERE n.lecturer_id = ? ORDER BY n.course_name, n.programme, n.unit_no`,
            [lecturer.lecturer_id]
        );
        res.json({ school: lecturer.school, max_units: MAX_UNITS, notes: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your notes.');
    }
});

// UPLOAD (or replace) a unit: fields course_name, programme, unit_no, title, description + file "file"
router.post('/', verifyToken, checkRole(...LECTURER_ROLES), (req, res, next) => {
    upload.single('file')(req, res, err => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(400).send('File is too large. Maximum size is 20MB.');
        return res.status(400).send(err.message || 'Upload failed.');
    });
}, async (req, res) => {
    const discard = () => req.file && removeFile(req.file.filename);
    const clean = v => (typeof v === 'string' ? v.trim() : '');
    const courseName = clean(req.body.course_name);
    const programme = clean(req.body.programme) || null;
    const unitNo = Number(req.body.unit_no);
    const title = clean(req.body.title);
    const description = clean(req.body.description);

    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) { discard(); return res.status(404).send('No lecturer record is linked to your account.'); }
        if (!lecturer.school) { discard(); return res.status(403).send('Choose your school in My Profile before posting notes.'); }
        const school = findSchool(lecturer.school);
        if (!school) { discard(); return res.status(400).send('Your school is not recognised. Contact the administrator.'); }

        if (!courseName || courseName.length > 150) { discard(); return res.status(400).send('Enter the course or module name.'); }
        if (!Number.isInteger(unitNo) || unitNo < 1 || unitNo > MAX_UNITS) { discard(); return res.status(400).send(`Choose a unit from 1 to ${MAX_UNITS}.`); }
        if (!title || title.length > 200) { discard(); return res.status(400).send('Enter a title for this unit.'); }
        if (description.length > 1000) { discard(); return res.status(400).send('Description must be 1000 characters or fewer.'); }
        if (programme && !school.programmes.some(p => p.name === programme)) {
            discard();
            return res.status(403).send(`You can only post notes to programmes in the ${lecturer.school}.`);
        }

        const [existing] = await pool.query(
            `SELECT note_id, file_path FROM course_notes
             WHERE lecturer_id = ? AND course_name = ? AND programme <=> ? AND unit_no = ?`,
            [lecturer.lecturer_id, courseName, programme, unitNo]
        );

        // Replacing a unit only needs a new file if the lecturer chose one
        if (existing.length) {
            if (req.file) {
                await pool.query(
                    'UPDATE course_notes SET title = ?, description = ?, file_path = ?, file_name = ?, file_type = ? WHERE note_id = ?',
                    [title, description || null, req.file.filename, req.file.originalname, req.file.mimetype, existing[0].note_id]
                );
                removeFile(existing[0].file_path);
            } else {
                await pool.query('UPDATE course_notes SET title = ?, description = ? WHERE note_id = ?',
                    [title, description || null, existing[0].note_id]);
            }
        } else {
            if (!req.file) return res.status(400).send('Attach the notes file for this unit.');
            await pool.query(
                `INSERT INTO course_notes (lecturer_id, school, programme, course_name, unit_no, title, description, file_path, file_name, file_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [lecturer.lecturer_id, lecturer.school, programme, courseName, unitNo, title, description || null,
                 req.file.filename, req.file.originalname, req.file.mimetype]
            );
        }

        // Tell the students
        if (req.file) {
            await notify(await studentUserIds(lecturer.school, programme), {
                category: 'notes',
                title: `${existing.length ? 'Updated' : 'New'} notes: ${courseName} — Unit ${unitNo}`,
                body: title,
                link: 'tab-library'
            });
        }

        res.status(existing.length ? 200 : 201).send(existing.length ? `Unit ${unitNo} updated.` : `Unit ${unitNo} posted.`);
    } catch (err) {
        console.error(err);
        discard();
        res.status(500).send('Failed to save notes.');
    }
});

// DELETE one of my units
router.delete('/:id', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const [rows] = await pool.query('SELECT file_path FROM course_notes WHERE note_id = ? AND lecturer_id = ?',
            [req.params.id, lecturer.lecturer_id]);
        if (rows.length === 0) return res.status(404).send('Notes not found.');
        await pool.query('DELETE FROM course_notes WHERE note_id = ?', [req.params.id]);
        removeFile(rows[0].file_path);
        res.send('Unit removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove notes.');
    }
});

// =====================================================================
// Student — Library
// =====================================================================
router.get('/library', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const student = await getStudent(req.user.id);
        if (!student) return res.status(404).send('No student record is linked to your account.');
        if (!student.school) return res.json({ school: null, programme: null, max_units: MAX_UNITS, notes: [] });
        const [rows] = await pool.query(
            `SELECT ${NOTE_FIELDS}, u.name AS lecturer_name
             FROM course_notes n
             JOIN LECTURERS l ON n.lecturer_id = l.lecturer_id
             JOIN USERS u ON l.user_id = u.user_id
             WHERE n.school = ? AND (n.programme IS NULL OR n.programme = ?)
             ORDER BY n.course_name, n.unit_no`,
            [student.school, student.programme]
        );
        res.json({ school: student.school, programme: student.programme, max_units: MAX_UNITS, notes: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load the library.');
    }
});

// OPEN a notes file — the lecturer who posted it, or a student it is meant for
router.get('/:id/file', verifyToken, checkRole('student', ...LECTURER_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM course_notes WHERE note_id = ?', [req.params.id]);
        const note = rows[0];
        if (!note) return res.status(404).send('Notes not found.');

        let allowed = false;
        if (req.user.role === 'student') {
            const s = await getStudent(req.user.id);
            allowed = Boolean(s && s.school) && s.school === note.school && (!note.programme || note.programme === s.programme);
        } else {
            const l = await getLecturer(req.user.id);
            allowed = Boolean(l) && l.lecturer_id === note.lecturer_id;
        }
        if (!allowed) return res.status(404).send('Notes not found.');

        res.setHeader('Content-Type', note.file_type);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(note.file_name)}`);
        res.sendFile(path.join(NOTES_DIR, path.basename(note.file_path)), err => {
            if (err && !res.headersSent) res.status(404).send('The notes file is missing.');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to open notes.');
    }
});

module.exports = router;
