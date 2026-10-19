const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ===== Student profile storage =====

const photoDir = path.join(__dirname, '..', 'uploads', 'profiles');
fs.mkdirSync(photoDir, { recursive: true });

const photoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, photoDir),
        filename: (req, file, cb) => {
            const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
            cb(null, `student-${req.user.id}-${Date.now()}${ext}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (['image/png', 'image/jpeg'].includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only PNG and JPEG photos are allowed.'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Find the logged-in user's student record
async function getMyStudentId(userId) {
    const [rows] = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [userId]);
    return rows.length ? rows[0].student_id : null;
}

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

// GET all students — restricted to class teachers (lecturers) and administrator
router.get('/', verifyToken, checkRole('class_teacher', 'administrator'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT s.student_id, s.user_id, s.department_id, s.date_of_birth, s.enrollment_date, s.school, s.programme, u.name, u.email, d.name AS department_name FROM students s JOIN USERS u ON s.user_id = u.user_id LEFT JOIN departments d ON s.department_id = d.department_id"
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch students.");
    }
});

// ===== Student self-service (these must come before the '/:id' routes) =====

// GET my own profile — student record + editable profile details
router.get('/me', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.student_id,
                    DATE_FORMAT(s.date_of_birth, '%Y-%m-%d') AS date_of_birth,
                    DATE_FORMAT(s.enrollment_date, '%Y-%m-%d') AS enrollment_date,
                    u.name, u.email, d.name AS department_name,
                    s.school, s.programme,
                    p.phone, p.address, p.next_of_kin_name, p.next_of_kin_phone,
                    (p.photo_path IS NOT NULL) AS has_photo
             FROM students s
             JOIN USERS u ON s.user_id = u.user_id
             LEFT JOIN departments d ON s.department_id = d.department_id
             LEFT JOIN student_profiles p ON p.student_id = s.student_id
             WHERE s.user_id = ?`,
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).send("No student record is linked to your account.");
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch your student record.");
    }
});

// UPDATE my own profile — students can change their personal/contact details only
// (name, email, department and student ID are managed by the administration)
router.put('/me', verifyToken, checkRole('student'), async (req, res) => {
    const clean = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const date_of_birth = clean(req.body.date_of_birth);
    const phone = clean(req.body.phone);
    const address = clean(req.body.address);
    const next_of_kin_name = clean(req.body.next_of_kin_name);
    const next_of_kin_phone = clean(req.body.next_of_kin_phone);

    if (date_of_birth && (isNaN(Date.parse(date_of_birth)) || new Date(date_of_birth) > new Date())) {
        return res.status(400).send('Please enter a valid date of birth.');
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
        return res.status(400).send('Please enter a valid phone number.');
    }
    if (next_of_kin_phone && !PHONE_PATTERN.test(next_of_kin_phone)) {
        return res.status(400).send("Please enter a valid next of kin phone number.");
    }
    if (address && address.length > 255) {
        return res.status(400).send('Address is too long.');
    }

    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) return res.status(404).send("No student record is linked to your account.");

        await pool.query('UPDATE students SET date_of_birth = ? WHERE student_id = ?', [date_of_birth, studentId]);
        await pool.query(
            `INSERT INTO student_profiles (student_id, phone, address, next_of_kin_name, next_of_kin_phone)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE phone = VALUES(phone), address = VALUES(address),
                 next_of_kin_name = VALUES(next_of_kin_name), next_of_kin_phone = VALUES(next_of_kin_phone)`,
            [studentId, phone, address, next_of_kin_name, next_of_kin_phone]
        );
        res.send('Profile updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update profile.');
    }
});

// UPLOAD my profile photo
router.post('/me/photo', verifyToken, checkRole('student'), (req, res, next) => {
    photoUpload.single('photo')(req, res, err => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).send('Photo is too large. Maximum size is 5MB.');
        }
        if (err) return res.status(400).send(err.message || 'Upload failed.');
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).send('No photo uploaded.');

    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) {
            fs.unlink(req.file.path, () => {});
            return res.status(404).send("No student record is linked to your account.");
        }

        const [old] = await pool.query('SELECT photo_path FROM student_profiles WHERE student_id = ?', [studentId]);

        await pool.query(
            `INSERT INTO student_profiles (student_id, photo_path) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE photo_path = VALUES(photo_path)`,
            [studentId, req.file.filename]
        );

        // Remove the previous photo file so old uploads don't pile up
        if (old.length && old[0].photo_path) {
            fs.unlink(path.join(photoDir, path.basename(old[0].photo_path)), () => {});
        }

        res.send('Photo uploaded successfully.');
    } catch (err) {
        console.error(err);
        fs.unlink(req.file.path, () => {});
        res.status(500).send('Failed to save photo.');
    }
});

// GET my profile photo
router.get('/me/photo', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.photo_path FROM student_profiles p
             JOIN students s ON p.student_id = s.student_id
             WHERE s.user_id = ?`,
            [req.user.id]
        );
        if (rows.length === 0 || !rows[0].photo_path) return res.status(404).send('No photo set.');
        res.sendFile(path.join(photoDir, path.basename(rows[0].photo_path)));
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch photo.');
    }
});

// GET single student — any logged-in user can view
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT s.student_id, s.user_id, s.department_id, s.date_of_birth, s.enrollment_date, u.name, u.email, d.name AS department_name FROM students s JOIN USERS u ON s.user_id = u.user_id LEFT JOIN departments d ON s.department_id = d.department_id WHERE s.student_id = ?",
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).send("Student not found.");
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch student.");
    }
});

// UPDATE student — restricted to administrator or class_teacher
router.put('/:id', verifyToken, checkRole('administrator', 'class_teacher'), async (req, res) => {
    const { date_of_birth, enrollment_date, department_id } = req.body;

    try {
        const [result] = await pool.query(
            "UPDATE students SET date_of_birth = ?, enrollment_date = ?, department_id = ? WHERE student_id = ?",
            [date_of_birth, enrollment_date, department_id, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).send("Student not found.");
        res.send("Student updated successfully.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to update student.");
    }
});

// DELETE student — restricted to administrator or class_teacher
router.delete('/:id', verifyToken, checkRole('administrator', 'class_teacher'), async (req, res) => {
    try {
        await pool.query("DELETE FROM student_profiles WHERE student_id = ?", [req.params.id]);
        const [result] = await pool.query(
            "DELETE FROM students WHERE student_id = ?",
            [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).send("Student not found.");
        res.send("Student deleted successfully.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to delete student.");
    }
});

module.exports = router;
