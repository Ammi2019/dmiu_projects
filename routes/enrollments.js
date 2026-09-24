// routes/enrollments.js
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET all enrollments — joined with student name and course title
router.get('/', requireLogin, async (req, res) => {
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

// GET single enrollment
router.get('/:id', requireLogin, async (req, res) => {
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

// CREATE enrollment — restricted to student role
router.post('/', requireRole('student'), async (req, res) => {
    const { student_id, section_id } = req.body;

    if (!student_id || !section_id) {
        return res.status(400).send('Student and section are required.');
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO enrollments (student_id, section_id, enrollment_date) VALUES (?, ?, CURRENT_DATE)',
            [student_id, section_id]
        );
        res.status(201).json({ enrollment_id: result.insertId, student_id, section_id });
    } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('Student is already enrolled in this section.');
        }
        res.status(500).send('Failed to create enrollment.');
    }
});

// UPDATE enrollment — lecturers can update grade
router.put('/:id', requireRole('class_teacher', 'head_of_department'), async (req, res) => {
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

// DELETE enrollment — student can drop a section
router.delete('/:id', requireRole('student'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM enrollments WHERE enrollment_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Enrollment not found.');
        }
        res.send('Enrollment deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete enrollment.');
    }
});

module.exports = router;

