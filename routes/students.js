const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET all students — joined to USERS (name/email) and departments (name)
router.get('/', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT students.student_id, students.user_id, students.department_id,
                    students.date_or_birth, students.enrollment_date,
                    USERS.name, USERS.email,
                    departments.name AS department_name
             FROM students
             JOIN USERS ON students.user_id = USERS.user_id
             LEFT JOIN departments ON students.department_id = departments.department_id`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch students.');
    }
});

// GET single student
router.get('/:id', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT students.student_id, students.user_id, students.department_id,
                    students.date_or_birth, students.enrollment_date,
                    USERS.name, USERS.email,
                    departments.name AS department_name
             FROM students
             JOIN USERS ON students.user_id = USERS.user_id
             LEFT JOIN departments ON students.department_id = departments.department_id
             WHERE students.student_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Student not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch student.');
    }
});

// REGISTER student — inserts a USERS row (role forced to 'student') and a students row together
router.post('/register', async (req, res) => {
    const { name, email, password, date_of_birth, enrollment_date, department_id } = req.body;

    if (!name || !email || !password) {
        return res.status(400).send('Name, email, and password are required.');
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into USERS
        const [userResult] = await connection.query(
            'INSERT INTO USERS (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, 'student']
        );

        // Insert into students (student_id auto-increments)
        const [studentResult] = await connection.query(
            'INSERT INTO students (user_id, date_or_birth, enrollment_date, department_id) VALUES (?, ?, ?, ?)',
            [userResult.insertId, date_of_birth || null, enrollment_date || null, department_id || null]
        );

        await connection.commit();

        res.status(201).json({
            student_id: studentResult.insertId,
            user_id: userResult.insertId,
            name,
            email,
            date_of_birth,
            enrollment_date,
            department_id
        });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('A user with that email already exists.');
        }
        res.status(500).send('Failed to create student.');
    } finally {
        connection.release();
    }
});

// UPDATE student — updates the students row only (dob/enrollment/department).
// Name/email/password live on USERS and aren't touched here.
router.put('/:id', requireRole('head_of_department', 'class_teacher'), async (req, res) => {
    const { date_of_birth, enrollment_date, department_id } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE students SET date_or_birth = ?, enrollment_date = ?, department_id = ? WHERE student_id = ?',
            [date_of_birth, enrollment_date, department_id, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Student not found.');
        }
        res.send('Student updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update student.');
    }
});

// DELETE student — removes the students row only. The linked USERS row (their login) is left intact.
router.delete('/:id', requireRole('head_of_department', 'class_teacher'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM students WHERE student_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Student not found.');
        }
        res.send('Student deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete student.');
    }
});

module.exports = router;

