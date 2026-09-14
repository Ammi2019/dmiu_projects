const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET all departments — any logged-in user
router.get('/', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch departments.');
    }
});

// GET one department by ID — any logged-in user
router.get('/:id', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM departments WHERE department_id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Department not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch department.');
    }
});

// CREATE a department — head_of_department only
router.post('/', requireRole('head_of_department'), async (req, res) => {
    const { name, building, budget } = req.body;

    if (!name) {
        return res.status(400).send('Department name is required.');
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO departments (name, building, budget) VALUES (?, ?, ?)',
            [name, building || null, budget || null]
        );
        res.status(201).json({ department_id: result.insertId, name, building, budget });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create department.');
    }
});

// UPDATE a department — head_of_department only
router.put('/:id', requireRole('head_of_department'), async (req, res) => {
    const { name, building, budget } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE departments SET name = ?, building = ?, budget = ? WHERE department_id = ?',
            [name, building, budget, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Department not found.');
        }
        res.send('Department updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update department.');
    }
});

// DELETE a department — head_of_department only
router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM departments WHERE department_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Department not found.');
        }
        res.send('Department deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete department.');
    }
});

module.exports = router;
