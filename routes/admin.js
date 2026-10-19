const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { findSchool } = require('./programmes');
const { notify } = require('../utils/notify');

const router = express.Router();

// All admin routes require a valid token AND administrator role
router.use(verifyToken, checkRole('administrator'));

// Get all approved users
router.get('/users', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT U.user_id, U.name, U.email, U.role, U.status, COALESCE(L.school, U.school) AS school FROM USERS U LEFT JOIN LECTURERS L ON L.user_id = U.user_id WHERE U.status = 'approved' ORDER BY U.name"
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch users.');
    }
});

// Get users awaiting approval
router.get('/pending', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT U.user_id, U.name, U.email, U.created_at, U.account_type, U.school, U.programme,
                    (SELECT A.application_id FROM applications A
                      WHERE A.email = U.email AND A.status = 'accepted'
                      ORDER BY A.decided_at DESC LIMIT 1) AS accepted_application_id
             FROM USERS U WHERE U.status = 'pending' ORDER BY U.created_at`
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch pending users.');
    }
});

// Approve a pending user — assigns a role, sets status, and creates the matching profile row
router.post('/users/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { role, department_id, date_of_birth, enrollment_date, hire_date, salary } = req.body;

    const validRoles = ['student', 'class_teacher', 'lecturer', 'head_of_department', 'administrator', 'principal', 'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk'];

    if (!role || !validRoles.includes(role)) {
        return res.status(400).send('A valid role is required.');
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            "UPDATE USERS SET role = ?, status = 'approved' WHERE user_id = ? AND status = 'pending'",
            [role, id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).send('Pending user not found.');
        }

        if (role === 'student') {
            // Carry over the school and programme the student chose when registering
            // If they didn't choose one, fall back to the programme on their accepted application
            const [[reg]] = await connection.query(
                `SELECT COALESCE(U.school, A.school) AS school, COALESCE(U.programme, A.programme) AS programme
                 FROM USERS U
                 LEFT JOIN applications A ON A.email = U.email AND A.status = 'accepted'
                 WHERE U.user_id = ?
                 LIMIT 1`, [id]);
            await connection.query(
                'INSERT INTO students (user_id, date_of_birth, enrollment_date, department_id, school, programme) VALUES (?, ?, ?, ?, ?, ?)',
                [id, date_of_birth || null, enrollment_date || new Date().toISOString().slice(0, 10), department_id || null,
                 reg ? reg.school : null, reg ? reg.programme : null]
            );
        } else if (role === 'class_teacher' || role === 'lecturer') {
            // Carry over the school the lecturer chose when registering
            const [[reg]] = await connection.query('SELECT school FROM USERS WHERE user_id = ?', [id]);
            await connection.query(
                'INSERT INTO LECTURERS (user_id, department_id, hire_date, salary, school) VALUES (?, ?, ?, ?, ?)',
                [id, department_id || null, hire_date || null, salary || null, reg ? reg.school : null]
            );
        }
        // administrator/principal/dean_of_students/accountant/registrar/registry_clerk/head_of_department get no extra profile row

        await connection.commit();
        notify([id], {
            category: 'account',
            title: 'Welcome to the DMISEU Chipata Campus portal',
            body: 'Your account has been approved. You can now use your dashboard.',
            link: null
        });
        res.status(200).send('User approved.');
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).send('Failed to approve user.');
    } finally {
        connection.release();
    }
});

// Reject a pending user (deletes their account outright)
router.delete('/users/:id/reject', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query(
            "DELETE FROM USERS WHERE user_id = ? AND status = 'pending'",
            [id]
        );
        if (result.affectedRows === 0) return res.status(404).send('Pending user not found.');
        res.status(200).send('User rejected and removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to reject user.');
    }
});

// Update an already-approved user's role (does not create profile rows — use approve for that)
router.put('/users/:id/role', async (req, res) => {
    const { role } = req.body;
    const { id } = req.params;

    if (!role) {
        return res.status(400).send('Role is required.');
    }

    try {
        await pool.query('UPDATE USERS SET role = ? WHERE user_id = ?', [role, id]);
        res.status(200).send('User role updated.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update role.');
    }
});

// Set the school for a Head of Department or lecturer
router.put('/users/:id/school', async (req, res) => {
    const school = findSchool((req.body.school || '').trim());
    if (!school) return res.status(400).send('Please choose a school from the list.');
    try {
        const [result] = await pool.query('UPDATE USERS SET school = ? WHERE user_id = ?', [school.name, req.params.id]);
        if (result.affectedRows === 0) return res.status(404).send('User not found.');
        await pool.query('UPDATE LECTURERS SET school = ? WHERE user_id = ?', [school.name, req.params.id]);
        res.send(`School set to the ${school.name}.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to set school.');
    }
});

// Delete a user
router.delete('/users/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query('DELETE FROM USERS WHERE user_id = ?', [id]);
        res.status(200).send('User deleted.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete user.');
    }
});

module.exports = router;
