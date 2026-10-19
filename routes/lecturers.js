const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Only these roles may see lecturer salaries
const SALARY_ROLES = ['administrator', 'accountant'];
function hideSalary(req, rows) {
    if (SALARY_ROLES.includes(req.user.role)) return rows;
    return rows.map(({ salary, ...rest }) => rest);
}

// ===== Lecturer profile storage =====

const photoDir = path.join(__dirname, '..', 'uploads', 'profiles');
fs.mkdirSync(photoDir, { recursive: true });

const photoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, photoDir),
        filename: (req, file, cb) => {
            const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
            cb(null, `lecturer-${req.user.id}-${Date.now()}${ext}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (['image/png', 'image/jpeg'].includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only PNG and JPEG photos are allowed.'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

const LECTURER_ROLES = ['lecturer', 'class_teacher'];
const { findSchool } = require('./programmes');

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;

async function getMyLecturerId(userId) {
    const [rows] = await pool.query('SELECT lecturer_id FROM LECTURERS WHERE user_id = ?', [userId]);
    return rows.length ? rows[0].lecturer_id : null;
}

// ===== Lecturer self-service (these must come before the '/:id' routes) =====

// GET my own profile
router.get('/me', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT L.lecturer_id,
                    DATE_FORMAT(L.hire_date, '%Y-%m-%d') AS hire_date,
                    U.name, U.email, U.role, D.name AS department_name, L.school,
                    P.phone, P.office, P.office_hours, P.qualification, P.specialization, P.bio,
                    (P.photo_path IS NOT NULL) AS has_photo
             FROM LECTURERS L
             JOIN USERS U ON L.user_id = U.user_id
             LEFT JOIN departments D ON L.department_id = D.department_id
             LEFT JOIN lecturer_profiles P ON P.lecturer_id = L.lecturer_id
             WHERE L.user_id = ?`,
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).send('No lecturer record is linked to your account.');
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your lecturer record.');
    }
});

// UPDATE my own profile — contact and academic details only
// (name, email, department, hire date and salary are managed by the administration)
router.put('/me', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    const clean = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const phone = clean(req.body.phone);
    const office = clean(req.body.office);
    const office_hours = clean(req.body.office_hours);
    const qualification = clean(req.body.qualification);
    const specialization = clean(req.body.specialization);
    const bio = clean(req.body.bio);

    if (phone && !PHONE_PATTERN.test(phone)) return res.status(400).send('Please enter a valid phone number.');
    if (office && office.length > 100) return res.status(400).send('Office is too long.');
    if (office_hours && office_hours.length > 100) return res.status(400).send('Office hours text is too long.');
    if (qualification && qualification.length > 150) return res.status(400).send('Qualification is too long.');
    if (specialization && specialization.length > 150) return res.status(400).send('Specialization is too long.');
    if (bio && bio.length > 1000) return res.status(400).send('Bio must be 1000 characters or fewer.');

    try {
        const lecturerId = await getMyLecturerId(req.user.id);
        if (!lecturerId) return res.status(404).send('No lecturer record is linked to your account.');

        await pool.query(
            `INSERT INTO lecturer_profiles (lecturer_id, phone, office, office_hours, qualification, specialization, bio)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE phone = VALUES(phone), office = VALUES(office),
                 office_hours = VALUES(office_hours), qualification = VALUES(qualification),
                 specialization = VALUES(specialization), bio = VALUES(bio)`,
            [lecturerId, phone, office, office_hours, qualification, specialization, bio]
        );
        res.send('Profile updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update profile.');
    }
});

// UPLOAD my profile photo
router.post('/me/photo', verifyToken, checkRole(...LECTURER_ROLES), (req, res, next) => {
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
        const lecturerId = await getMyLecturerId(req.user.id);
        if (!lecturerId) {
            fs.unlink(req.file.path, () => {});
            return res.status(404).send('No lecturer record is linked to your account.');
        }

        const [old] = await pool.query('SELECT photo_path FROM lecturer_profiles WHERE lecturer_id = ?', [lecturerId]);

        await pool.query(
            `INSERT INTO lecturer_profiles (lecturer_id, photo_path) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE photo_path = VALUES(photo_path)`,
            [lecturerId, req.file.filename]
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
router.get('/me/photo', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT P.photo_path FROM lecturer_profiles P
             JOIN LECTURERS L ON P.lecturer_id = L.lecturer_id
             WHERE L.user_id = ?`,
            [req.user.id]
        );
        if (rows.length === 0 || !rows[0].photo_path) return res.status(404).send('No photo set.');
        res.sendFile(path.join(photoDir, path.basename(rows[0].photo_path)));
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch photo.');
    }
});

// SET my school — allowed once, only if no school has been set yet.
// After that, only the administrator can change it (PUT /api/lecturers/:id/school).
router.put('/me/school', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    const school = findSchool((req.body.school || '').trim());
    if (!school) return res.status(400).send('Please choose a school from the list.');

    try {
        const [result] = await pool.query(
            'UPDATE LECTURERS SET school = ? WHERE user_id = ? AND school IS NULL',
            [school.name, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(409).send('Your school is already set. Contact the administrator to change it.');
        }
        res.send(`Your school is now the ${school.name}.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to set your school.');
    }
});

// GET the sections I teach, with how many students are enrolled in each
router.get('/me/classes', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturerId = await getMyLecturerId(req.user.id);
        if (!lecturerId) return res.status(404).send('No lecturer record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT S.section_id, S.semester, S.year, S.room, S.capacity,
                    C.course_code, C.title AS course_title, C.credits,
                    (SELECT COUNT(*) FROM enrollments E WHERE E.section_id = S.section_id) AS enrolled_count,
                    (SELECT COUNT(*) FROM enrollments E WHERE E.section_id = S.section_id AND E.grade IS NULL) AS ungraded_count
             FROM sections S
             JOIN courses C ON S.course_id = C.course_id
             WHERE S.lecturer_id = ?
             ORDER BY S.year DESC, S.semester, C.course_code`,
            [lecturerId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your classes.');
    }
});

// ===== General lecturer routes =====

router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT L.lecturer_id, L.user_id, L.department_id, L.hire_date, L.salary, U.name, U.email, U.role, D.name AS department_name FROM LECTURERS L JOIN USERS U ON L.user_id = U.user_id LEFT JOIN departments D ON L.department_id = D.department_id"
        );
        res.json(hideSalary(req, rows));
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch lecturers.");
    }
});

router.get('/:id', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT L.lecturer_id, L.user_id, L.department_id, L.hire_date, L.salary, U.name, U.email, U.role, D.name AS department_name FROM LECTURERS L JOIN USERS U ON L.user_id = U.user_id LEFT JOIN departments D ON L.department_id = D.department_id WHERE L.lecturer_id = ?",
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).send("Lecturer not found.");
        res.json(hideSalary(req, rows)[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to fetch lecturer.");
    }
});

router.put('/:id', verifyToken, checkRole('administrator'), async (req, res) => {
    const { department_id, hire_date, salary } = req.body;

    try {
        const [result] = await pool.query(
            "UPDATE LECTURERS SET department_id = ?, hire_date = ?, salary = ? WHERE lecturer_id = ?",
            [department_id, hire_date, salary, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).send("Lecturer not found.");
        res.send("Lecturer updated successfully.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to update lecturer.");
    }
});

// Administrator: change a lecturer's school
router.put('/:id/school', verifyToken, checkRole('administrator'), async (req, res) => {
    const school = findSchool((req.body.school || '').trim());
    if (!school) return res.status(400).send('Please choose a school from the list.');
    try {
        const [result] = await pool.query('UPDATE LECTURERS SET school = ? WHERE lecturer_id = ?', [school.name, req.params.id]);
        if (result.affectedRows === 0) return res.status(404).send('Lecturer not found.');
        res.send('Lecturer school updated.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update lecturer school.');
    }
});

router.delete('/:id', verifyToken, checkRole('administrator'), async (req, res) => {
    try {
        await pool.query("DELETE FROM lecturer_profiles WHERE lecturer_id = ?", [req.params.id]);
        const [result] = await pool.query(
            "DELETE FROM LECTURERS WHERE lecturer_id = ?",
            [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).send("Lecturer not found.");
        res.send("Lecturer deleted successfully.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to delete lecturer.");
    }
});

module.exports = router;
