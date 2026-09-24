const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET all lecturers — joined to USERS (name/email/role) and departments (name)
router.get('/', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT LECTURERS.lecturer_id, LECTURERS.user_id, LECTURERS.department_id,
                    LECTURERS.hire_date, LECTURERS.salary,
                    USERS.name, USERS.email, USERS.role,
                    departments.name AS department_name
             FROM LECTURERS
             JOIN USERS ON LECTURERS.user_id = USERS.user_id
             LEFT JOIN departments ON LECTURERS.department_id = departments.department_id`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch lecturers.');
    }
});

// GET single lecturer
router.get('/:id', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT LECTURERS.lecturer_id, LECTURERS.user_id, LECTURERS.department_id,
                    LECTURERS.hire_date, LECTURERS.salary,
                    USERS.name, USERS.email, USERS.role,
                    departments.name AS department_name
             FROM LECTURERS
             JOIN USERS ON LECTURERS.user_id = USERS.user_id
             LEFT JOIN departments ON LECTURERS.department_id = departments.department_id
             WHERE LECTURERS.lecturer_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Lecturer not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch lecturer.');
    }
});

// CREATE lecturer — inserts a USERS row and a LECTURERS row together in one transaction.
// role must be 'class_teacher' or 'head_of_department' (the schema's enum has no plain 'lecturer' value).
router.post('/', requireRole('head_of_department'), async (req, res) => {
    const { name, email, password, role, department_id, hire_date, salary } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).send('Name, email, password, and role are required.');
    }
    if (!['class_teacher', 'head_of_department'].includes(role)) {
        return res.status(400).send("Role must be 'class_teacher' or 'head_of_department' for a lecturer.");
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await connection.query(
            'INSERT INTO USERS (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, role]
        );

        const [lecturerResult] = await connection.query(
            'INSERT INTO LECTURERS (user_id, department_id, hire_date, salary) VALUES (?, ?, ?, ?)',
            [userResult.insertId, department_id || null, hire_date || null, salary || null]
        );

        await connection.commit();

        res.status(201).json({
            lecturer_id: lecturerResult.insertId,
            user_id: userResult.insertId,
            name,
            email,
            role,
            department_id,
            hire_date,
            salary
        });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        // Duplicate email hits USERS.email's unique constraint (if one exists) — surface a clearer message for that case
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('A user with that email already exists.');
        }
        res.status(500).send('Failed to create lecturer.');
    } finally {
        connection.release();
    }
});

// UPDATE lecturer — updates the LECTURERS row only (department/hire_date/salary).
// Name/email/password live on USERS and aren't touched here; add a separate route if you need that.
router.put('/:id', requireRole('head_of_department'), async (req, res) => {
    const { department_id, hire_date, salary } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE LECTURERS SET department_id = ?, hire_date = ?, salary = ? WHERE lecturer_id = ?',
            [department_id, hire_date, salary, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Lecturer not found.');
        }
        res.send('Lecturer updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update lecturer.');
    }
});

// DELETE lecturer — removes the LECTURERS row only. The linked USERS row (their login) is left intact.
// If you want deleting a lecturer to also remove their login, add a second DELETE against USERS here.
router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM LECTURERS WHERE lecturer_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Lecturer not found.');
        }
        res.send('Lecturer deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete lecturer.');
    }
});

module.exports = router;
