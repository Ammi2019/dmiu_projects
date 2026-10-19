const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = express.Router();

// GET all departments — public (needed for the application form dropdown)
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch departments.');
    }
});

// GET one department by ID — public
router.get('/:id', async (req, res) => {
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

// CREATE a department — administrator only
router.post('/', verifyToken, checkRole('administrator'), async (req, res) => {
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

module.exports = router;
