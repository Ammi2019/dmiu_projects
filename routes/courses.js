const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
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

router.get('/:id', requireLogin, async (req, res) => {
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

router.post('/', requireRole('head_of_department'), async (req, res) => {
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

router.put('/:id', requireRole('head_of_department'), async (req, res) => {
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

router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
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
