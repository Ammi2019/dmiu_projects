// Assignments: lecturers post Assignment 1 / 2 to students in their school; students submit work.
//
// Who can see what:
//   - A lecturer can only post to their own school (LECTURERS.school), either to one programme
//     in that school or to every programme in it.
//   - A student sees assignments whose school matches theirs and whose programme is theirs
//     (or is blank, meaning "all programmes in the school").
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

// ===== File uploads =====
const ASSIGNMENT_DIR = path.join(__dirname, '..', 'uploads', 'assignments');
const SUBMISSION_DIR = path.join(__dirname, '..', 'uploads', 'submissions');
fs.mkdirSync(ASSIGNMENT_DIR, { recursive: true });
fs.mkdirSync(SUBMISSION_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.zip', '.png', '.jpg', '.jpeg'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function makeUpload(dir, prefix) {
    return multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, dir),
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                cb(null, `${prefix}-${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
            else cb(new Error('Allowed file types: PDF, Word, PowerPoint, Excel, TXT, ZIP, PNG, JPEG.'));
        },
        limits: { fileSize: MAX_FILE_SIZE }
    });
}

const assignmentUpload = makeUpload(ASSIGNMENT_DIR, 'assignment');
const submissionUpload = makeUpload(SUBMISSION_DIR, 'submission');

// Wrap multer so upload problems come back as clear 400 messages
function handleUpload(upload, field) {
    return (req, res, next) => {
        upload.single(field)(req, res, err => {
            if (!err) return next();
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('File is too large. Maximum size is 10MB.');
            }
            return res.status(400).send(err.message || 'Upload failed.');
        });
    };
}

function removeFile(dir, storedName) {
    if (storedName) fs.unlink(path.join(dir, path.basename(storedName)), () => {});
}

// ===== Helpers =====
async function getLecturer(userId) {
    const [rows] = await pool.query('SELECT lecturer_id, school FROM LECTURERS WHERE user_id = ?', [userId]);
    return rows[0] || null;
}

async function getStudent(userId) {
    const [rows] = await pool.query('SELECT student_id, school, programme FROM students WHERE user_id = ?', [userId]);
    return rows[0] || null;
}

// Is this assignment meant for this student?
function isForStudent(assignment, student) {
    return Boolean(student && student.school) &&
        assignment.school === student.school &&
        (!assignment.programme || assignment.programme === student.programme);
}

// 'YYYY-MM-DDTHH:MM' (from <input type="datetime-local">) → 'YYYY-MM-DD HH:MM:00' for MySQL
function parseDueDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    return value.replace('T', ' ') + ':00';
}

const ASSIGNMENT_FIELDS = `
    a.assignment_id, a.school, a.programme, a.course_name, a.assignment_no, a.title, a.instructions,
    DATE_FORMAT(a.due_at, '%Y-%m-%dT%H:%i') AS due_at, (a.due_at < NOW()) AS is_past_due,
    a.file_name, DATE_FORMAT(a.created_at, '%Y-%m-%d') AS created_at`;

// =====================================================================
// Lecturer routes
// =====================================================================

// GET the assignments I have posted, with submission counts
router.get('/teaching', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT ${ASSIGNMENT_FIELDS},
                    (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.assignment_id) AS submitted_count,
                    (SELECT COUNT(*) FROM students st
                      WHERE st.school = a.school AND (a.programme IS NULL OR st.programme = a.programme)) AS student_count
             FROM assignments a
             WHERE a.lecturer_id = ?
             ORDER BY a.due_at DESC`,
            [lecturer.lecturer_id]
        );
        res.json({ school: lecturer.school, assignments: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your assignments.');
    }
});

// POST a new assignment (optional attachment in field "attachment")
router.post('/', verifyToken, checkRole(...LECTURER_ROLES), handleUpload(assignmentUpload, 'attachment'), async (req, res) => {
    const discard = () => req.file && removeFile(ASSIGNMENT_DIR, req.file.filename);
    const clean = v => (typeof v === 'string' ? v.trim() : '');

    const assignmentNo = Number(req.body.assignment_no);
    const courseName = clean(req.body.course_name);
    const title = clean(req.body.title);
    const instructions = clean(req.body.instructions);
    const programme = clean(req.body.programme) || null; // blank = all programmes in the school
    const dueAt = parseDueDate(req.body.due_at);

    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) { discard(); return res.status(404).send('No lecturer record is linked to your account.'); }
        if (!lecturer.school) {
            discard();
            return res.status(403).send('Choose your school in My Profile before posting assignments.');
        }

        const school = findSchool(lecturer.school);
        if (!school) { discard(); return res.status(400).send('Your school is not recognised. Contact the administrator.'); }

        if (![1, 2].includes(assignmentNo)) { discard(); return res.status(400).send('Choose Assignment 1 or Assignment 2.'); }
        if (!courseName) { discard(); return res.status(400).send('Enter the course or module name.'); }
        if (!title) { discard(); return res.status(400).send('Enter a title for the assignment.'); }
        if (courseName.length > 150 || title.length > 200) { discard(); return res.status(400).send('Course name or title is too long.'); }
        if (instructions.length > 5000) { discard(); return res.status(400).send('Instructions must be 5000 characters or fewer.'); }
        if (!dueAt) { discard(); return res.status(400).send('Choose a due date and time.'); }
        if (new Date(dueAt.replace(' ', 'T')) <= new Date()) { discard(); return res.status(400).send('The due date must be in the future.'); }

        // Access control: lecturers can only target programmes in their own school
        if (programme && !school.programmes.some(p => p.name === programme)) {
            discard();
            return res.status(403).send(`You can only post to programmes in the ${lecturer.school}.`);
        }

        const [result] = await pool.query(
            `INSERT INTO assignments
                (lecturer_id, school, programme, course_name, assignment_no, title, instructions, due_at, file_path, file_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [lecturer.lecturer_id, lecturer.school, programme, courseName, assignmentNo, title, instructions || null, dueAt,
             req.file ? req.file.filename : null, req.file ? req.file.originalname : null]
        );
        notify(await studentUserIds(lecturer.school, programme), {
            category: 'assignment',
            title: `New assignment: ${courseName} — Assignment ${assignmentNo}`,
            body: `${title}. Due ${dueAt.slice(0, 16)}.`,
            link: 'tab-assignments'
        });
        res.status(201).json({ assignment_id: result.insertId, message: 'Assignment posted.' });
    } catch (err) {
        console.error(err);
        discard();
        res.status(500).send('Failed to post assignment.');
    }
});

// DELETE one of my assignments (and its submissions)
router.delete('/:id', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');

        const [rows] = await pool.query(
            'SELECT file_path FROM assignments WHERE assignment_id = ? AND lecturer_id = ?',
            [req.params.id, lecturer.lecturer_id]
        );
        if (rows.length === 0) return res.status(404).send('Assignment not found.');

        const [subs] = await pool.query('SELECT file_path FROM assignment_submissions WHERE assignment_id = ?', [req.params.id]);
        await pool.query('DELETE FROM assignment_submissions WHERE assignment_id = ?', [req.params.id]);
        await pool.query('DELETE FROM assignments WHERE assignment_id = ?', [req.params.id]);

        removeFile(ASSIGNMENT_DIR, rows[0].file_path);
        subs.forEach(s => removeFile(SUBMISSION_DIR, s.file_path));
        res.send('Assignment deleted.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete assignment.');
    }
});

// GET every student the assignment is for, with their submission (if any)
router.get('/:id/submissions', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');

        const [assignments] = await pool.query(
            `SELECT ${ASSIGNMENT_FIELDS} FROM assignments a WHERE a.assignment_id = ? AND a.lecturer_id = ?`,
            [req.params.id, lecturer.lecturer_id]
        );
        if (assignments.length === 0) return res.status(404).send('Assignment not found.');
        const a = assignments[0];

        const [students] = await pool.query(
            `SELECT st.student_id, u.name, u.email, st.programme,
                    sub.submission_id, sub.file_name, sub.comment, sub.is_late,
                    DATE_FORMAT(sub.submitted_at, '%Y-%m-%d %H:%i') AS submitted_at
             FROM students st
             JOIN USERS u ON st.user_id = u.user_id
             LEFT JOIN assignment_submissions sub
                    ON sub.student_id = st.student_id AND sub.assignment_id = ?
             WHERE st.school = ? AND (? IS NULL OR st.programme = ?)
             ORDER BY (sub.submission_id IS NULL), u.name`,
            [a.assignment_id, a.school, a.programme, a.programme]
        );
        res.json({ assignment: a, students });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch submissions.');
    }
});

// GET (download) a student's submitted file — only the lecturer who posted the assignment
router.get('/submissions/:submissionId/file', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT sub.file_path, sub.file_name FROM assignment_submissions sub
             JOIN assignments a ON sub.assignment_id = a.assignment_id
             WHERE sub.submission_id = ? AND a.lecturer_id = ?`,
            [req.params.submissionId, lecturer.lecturer_id]
        );
        if (rows.length === 0) return res.status(404).send('Submission not found.');
        res.download(path.join(SUBMISSION_DIR, path.basename(rows[0].file_path)), rows[0].file_name);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch file.');
    }
});

// =====================================================================
// Student routes
// =====================================================================

// GET assignments for my school + programme, with my submission status
router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const student = await getStudent(req.user.id);
        if (!student) return res.status(404).send('No student record is linked to your account.');
        if (!student.school) return res.json({ school: null, programme: student.programme, assignments: [] });

        const [rows] = await pool.query(
            `SELECT ${ASSIGNMENT_FIELDS}, u.name AS lecturer_name,
                    sub.file_name AS my_file_name, sub.comment AS my_comment, sub.is_late AS my_is_late,
                    DATE_FORMAT(sub.submitted_at, '%Y-%m-%d %H:%i') AS my_submitted_at
             FROM assignments a
             JOIN LECTURERS l ON a.lecturer_id = l.lecturer_id
             JOIN USERS u ON l.user_id = u.user_id
             LEFT JOIN assignment_submissions sub
                    ON sub.assignment_id = a.assignment_id AND sub.student_id = ?
             WHERE a.school = ? AND (a.programme IS NULL OR a.programme = ?)
             ORDER BY a.assignment_no, a.due_at`,
            [student.student_id, student.school, student.programme]
        );
        res.json({ school: student.school, programme: student.programme, assignments: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch assignments.');
    }
});

// POST (or replace) my submission — file in field "file"
router.post('/:id/submit', verifyToken, checkRole('student'), handleUpload(submissionUpload, 'file'), async (req, res) => {
    const discard = () => req.file && removeFile(SUBMISSION_DIR, req.file.filename);
    const comment = typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';

    if (!req.file) return res.status(400).send('Choose a file to submit.');

    try {
        const student = await getStudent(req.user.id);
        if (!student) { discard(); return res.status(404).send('No student record is linked to your account.'); }

        const [assignments] = await pool.query(
            'SELECT assignment_id, school, programme, (due_at < NOW()) AS is_past_due FROM assignments WHERE assignment_id = ?',
            [req.params.id]
        );
        if (assignments.length === 0 || !isForStudent(assignments[0], student)) {
            discard();
            return res.status(404).send('Assignment not found.');
        }
        const pastDue = Boolean(Number(assignments[0].is_past_due));

        const [existing] = await pool.query(
            'SELECT submission_id, file_path FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
            [req.params.id, student.student_id]
        );

        // After the deadline: first submissions are accepted (marked late), but changes are not
        if (existing.length && pastDue) {
            discard();
            return res.status(409).send('The deadline has passed, so your submission can no longer be changed.');
        }

        if (existing.length) {
            await pool.query(
                'UPDATE assignment_submissions SET file_path = ?, file_name = ?, comment = ?, is_late = 0 WHERE submission_id = ?',
                [req.file.filename, req.file.originalname, comment || null, existing[0].submission_id]
            );
            removeFile(SUBMISSION_DIR, existing[0].file_path);
            return res.send('Submission updated.');
        }

        await pool.query(
            `INSERT INTO assignment_submissions (assignment_id, student_id, file_path, file_name, comment, is_late)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.params.id, student.student_id, req.file.filename, req.file.originalname, comment || null, pastDue ? 1 : 0]
        );
        res.status(201).send(pastDue ? 'Submitted after the deadline — marked as late.' : 'Assignment submitted.');
    } catch (err) {
        console.error(err);
        discard();
        res.status(500).send('Failed to submit assignment.');
    }
});

// GET (download) my own submitted file
router.get('/:id/my-submission/file', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const student = await getStudent(req.user.id);
        if (!student) return res.status(404).send('No student record is linked to your account.');

        const [rows] = await pool.query(
            'SELECT file_path, file_name FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
            [req.params.id, student.student_id]
        );
        if (rows.length === 0) return res.status(404).send('You have not submitted this assignment.');
        res.download(path.join(SUBMISSION_DIR, path.basename(rows[0].file_path)), rows[0].file_name);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch file.');
    }
});

// =====================================================================
// Shared: download the lecturer's attachment (the student it's for, or the lecturer who posted it)
// =====================================================================
router.get('/:id/attachment', verifyToken, checkRole('student', ...LECTURER_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT assignment_id, lecturer_id, school, programme, file_path, file_name FROM assignments WHERE assignment_id = ?',
            [req.params.id]
        );
        if (rows.length === 0 || !rows[0].file_path) return res.status(404).send('No attachment for this assignment.');
        const a = rows[0];

        let allowed = false;
        if (req.user.role === 'student') {
            allowed = isForStudent(a, await getStudent(req.user.id));
        } else {
            const lecturer = await getLecturer(req.user.id);
            allowed = Boolean(lecturer) && lecturer.lecturer_id === a.lecturer_id;
        }
        if (!allowed) return res.status(404).send('No attachment for this assignment.');

        res.download(path.join(ASSIGNMENT_DIR, path.basename(a.file_path)), a.file_name);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch attachment.');
    }
});

module.exports = router;
