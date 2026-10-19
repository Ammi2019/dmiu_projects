const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth'); // updated import

const router = express.Router();

// GET all courses — any logged-in user
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT courses.*, departments.name AS department_name FROM courses LEFT JOIN departments ON courses.department_id = departments.department_id'
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch courses.');
    }
});

// GET single course by ID — any logged-in user
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT courses.*, departments.name AS department_name FROM courses LEFT JOIN departments ON courses.department_id = departments.department_id WHERE courses.course_id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Course not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch course.');
    }
});

// CREATE course — restricted to head_of_department
router.post('/', verifyToken, checkRole('head_of_department'), async (req, res) => {
    const { course_code, title, credits, department_id } = req.body;

    if (!course_code || !title) {
        return res.status(400).send('Course code and title are required.');
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO courses (course_code, title, credits, department_id) VALUES (?, ?, ?, ?)',
            [course_code, title, credits || 3, department_id || null]
        );
        res.status(201).json({ course_id: result.insertId, course_code, title, credits, department_id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create course.');
    }
});

// UPDATE course — restricted to head_of_department
router.put('/:id', verifyToken, checkRole('head_of_department'), async (req, res) => {
    const { course_code, title, credits, department_id } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE courses SET course_code = ?, title = ?, credits = ?, department_id = ? WHERE course_id = ?',
            [course_code, title, credits, department_id, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Course not found.');
        }
        res.send('Course updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update course.');
    }
});

// DELETE course — restricted to head_of_department
router.delete('/:id', verifyToken, checkRole('head_of_department'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM courses WHERE course_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Course not found.');
        }
        res.send('Course deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete course.');
    }
});

module.exports = router;

