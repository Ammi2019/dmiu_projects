// routes/enrollments.js
const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth'); // updated import

const router = express.Router();

// GET all enrollments — joined with student name and course title
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT enrollments.enrollment_id, enrollments.student_id, enrollments.section_id,
                    enrollments.grade, enrollments.enrollment_date,
                    USERS.name AS student_name,
                    courses.title AS course_title,
                    sections.semester, sections.year
             FROM enrollments
             JOIN students ON enrollments.student_id = students.student_id
             JOIN USERS ON students.user_id = USERS.user_id
             JOIN sections ON enrollments.section_id = sections.section_id
             JOIN courses ON sections.course_id = courses.course_id`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch enrollments.');
    }
});

// ===== Student self-service (must come before '/:id') =====

// Look up the students.student_id for the logged-in user
async function getMyStudentId(userId) {
    const [rows] = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [userId]);
    return rows.length ? rows[0].student_id : null;
}

// GET my enrollments — the logged-in student's courses, with lecturer and credits
router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) return res.status(404).send('No student record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT e.enrollment_id, e.section_id, e.grade, e.enrollment_date,
                    c.course_code, c.title AS course_title, c.credits,
                    s.semester, s.year, s.room,
                    u.name AS lecturer_name
             FROM enrollments e
             JOIN sections s ON e.section_id = s.section_id
             JOIN courses c ON s.course_id = c.course_id
             LEFT JOIN LECTURERS l ON s.lecturer_id = l.lecturer_id
             LEFT JOIN USERS u ON l.user_id = u.user_id
             WHERE e.student_id = ?
             ORDER BY s.year DESC, s.semester, c.course_code`,
            [studentId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your enrollments.');
    }
});

// GET sections a student can browse — with seats taken and whether I'm already in it
router.get('/available', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) return res.status(404).send('No student record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT s.section_id, s.semester, s.year, s.room, s.capacity,
                    c.course_id, c.course_code, c.title AS course_title, c.credits,
                    d.name AS department_name,
                    u.name AS lecturer_name,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = s.section_id) AS enrolled_count,
                    EXISTS(SELECT 1 FROM enrollments e WHERE e.section_id = s.section_id AND e.student_id = ?) AS is_enrolled
             FROM sections s
             JOIN courses c ON s.course_id = c.course_id
             LEFT JOIN departments d ON c.department_id = d.department_id
             LEFT JOIN LECTURERS l ON s.lecturer_id = l.lecturer_id
             LEFT JOIN USERS u ON l.user_id = u.user_id
             ORDER BY s.year DESC, s.semester, c.course_code`,
            [studentId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch available sections.');
    }
});

// GET single enrollment
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT enrollments.enrollment_id, enrollments.student_id, enrollments.section_id,
                    enrollments.grade, enrollments.enrollment_date,
                    USERS.name AS student_name,
                    courses.title AS course_title,
                    sections.semester, sections.year
             FROM enrollments
             JOIN students ON enrollments.student_id = students.student_id
             JOIN USERS ON students.user_id = USERS.user_id
             JOIN sections ON enrollments.section_id = sections.section_id
             JOIN courses ON sections.course_id = courses.course_id
             WHERE enrollments.enrollment_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Enrollment not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch enrollment.');
    }
});

// CREATE enrollment — a student enrolls THEMSELVES (student_id comes from the token, not the request)
router.post('/', verifyToken, checkRole('student'), async (req, res) => {
    const { section_id } = req.body;

    if (!section_id) {
        return res.status(400).send('Section is required.');
    }

    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) return res.status(404).send('No student record is linked to your account.');

        const [sections] = await pool.query(
            `SELECT s.capacity,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = s.section_id) AS enrolled_count
             FROM sections s WHERE s.section_id = ?`,
            [section_id]
        );
        if (sections.length === 0) return res.status(404).send('Section not found.');

        const { capacity, enrolled_count } = sections[0];
        if (capacity && enrolled_count >= capacity) {
            return res.status(409).send('This section is full.');
        }

        const [existing] = await pool.query(
            'SELECT 1 FROM enrollments WHERE student_id = ? AND section_id = ?',
            [studentId, section_id]
        );
        if (existing.length) return res.status(409).send('You are already enrolled in this section.');

        const [result] = await pool.query(
            'INSERT INTO enrollments (student_id, section_id, enrollment_date) VALUES (?, ?, CURRENT_DATE)',
            [studentId, section_id]
        );
        res.status(201).json({ enrollment_id: result.insertId, student_id: studentId, section_id });
    } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('You are already enrolled in this section.');
        }
        res.status(500).send('Failed to create enrollment.');
    }
});

// UPDATE enrollment — lecturers can update grade
router.put('/:id', verifyToken, checkRole('class_teacher', 'head_of_department'), async (req, res) => {
    const { grade } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE enrollments SET grade = ? WHERE enrollment_id = ?',
            [grade, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Enrollment not found.');
        }
        res.send('Grade updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update grade.');
    }
});

// DELETE enrollment — a student can drop only their OWN, ungraded enrollment
router.delete('/:id', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await getMyStudentId(req.user.id);
        if (!studentId) return res.status(404).send('No student record is linked to your account.');

        const [rows] = await pool.query(
            'SELECT grade FROM enrollments WHERE enrollment_id = ? AND student_id = ?',
            [req.params.id, studentId]
        );
        if (rows.length === 0) return res.status(404).send('Enrollment not found.');
        if (rows[0].grade) return res.status(409).send('This course has already been graded and cannot be dropped.');

        await pool.query('DELETE FROM enrollments WHERE enrollment_id = ? AND student_id = ?', [req.params.id, studentId]);
        res.send('Course dropped.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to drop course.');
    }
});

module.exports = router;

