const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const { findProgramme, findSchool } = require('./programmes');

const router = express.Router();

// Which roles may sign in through each portal on the home page
const PORTAL_ROLES = {
    student: ['student'],
    lecturer: ['lecturer', 'class_teacher'],
    staff: ['administrator', 'principal', 'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk', 'head_of_department']
};

const PORTAL_LABELS = { student: 'Student', lecturer: 'Lecturer', staff: 'Administration' };

function portalForRole(role) {
    return Object.keys(PORTAL_ROLES).find(p => PORTAL_ROLES[p].includes(role));
}

// Register — anyone can sign up, but gets no role and 'pending' status until an admin approves them
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    const accountType = ['student', 'lecturer', 'staff'].includes(req.body.account_type) ? req.body.account_type : 'student';
    const schoolName = (req.body.school || '').trim();
    const programmeName = (req.body.programme || '').trim();

    if (!name || !email || !password) {
        return res.status(400).send('Name, email, and password are required.');
    }
    if (password.length < 8) {
        return res.status(400).send('Password must be at least 8 characters.');
    }

    // Students must pick a real programme, and it must belong to the school they chose
    let school = null;
    let programme = null;
    if (accountType === 'student') {
        const match = programmeName ? findProgramme(programmeName) : null;
        if (!schoolName) return res.status(400).send('Please choose your school.');
        if (!match) return res.status(400).send('Please choose your programme.');
        if (match.school.name !== schoolName) {
            return res.status(400).send('That programme is not offered by the school you selected.');
        }
        school = match.school.name;
        programme = match.programme.name;
    }

    // Lecturers choose the school they teach in (confirmed by the admin on approval)
    if (accountType === 'lecturer') {
        const lecturerSchool = schoolName ? findSchool(schoolName) : null;
        if (!lecturerSchool) return res.status(400).send('Please choose the school you teach in.');
        school = lecturerSchool.name;
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO USERS (name, email, password, role, status, account_type, school, programme) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
            [name, email, hashedPassword, 'pending', accountType, school, programme]
        );

        res.status(201).send('Registration submitted. An admin will review your account before you can log in.');
    } catch (err) {
        console.error(err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).send('An account with that email already exists.');
        }
        res.status(500).send('Registration failed.');
    }
});

// Login — blocked until an admin has approved the account
router.post('/login', async (req, res) => {
    const { email, password, portal } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required.');
    }
    if (!portal || !PORTAL_ROLES[portal]) {
        return res.status(400).send('Please choose a portal to sign in to.');
    }

    try {
        const [rows] = await pool.query('SELECT * FROM USERS WHERE email = ?', [email]);

        if (rows.length === 0) {
            return res.status(401).send('Invalid email or password.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).send('Invalid email or password.');
        }

        if (user.status === 'pending') {
            return res.status(403).send('Your account is awaiting admin approval.');
        }

        // Only allow sign-in through the portal that matches the account's role
        if (!PORTAL_ROLES[portal].includes(user.role)) {
            const correct = portalForRole(user.role);
            return res.status(403).send(
                correct
                    ? `This account cannot sign in through the ${PORTAL_LABELS[portal]} portal. Please use the ${PORTAL_LABELS[correct]} portal.`
                    : 'This account does not have access to any portal yet. Please contact the administrator.'
            );
        }

        const token = jwt.sign(
            { id: user.user_id, role: user.role },
            process.env.SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            message: 'Logged in successfully.',
            token,
            role: user.role,
            name: user.name
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Login failed.');
    }
});

// Change password — requires the current password, works for any logged-in role
router.put('/change-password', verifyToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).send('Current and new password are required.');
    }
    if (newPassword.length < 8) {
        return res.status(400).send('New password must be at least 8 characters.');
    }

    try {
        const [rows] = await pool.query('SELECT * FROM USERS WHERE user_id = ?', [req.user.id]);

        if (rows.length === 0) {
            return res.status(404).send('User not found.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(currentPassword, user.password);

        if (!match) {
            return res.status(401).send('Current password is incorrect.');
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE USERS SET password = ? WHERE user_id = ?', [hashedNewPassword, req.user.id]);

        res.status(200).send('Password changed successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to change password.');
    }
});

module.exports = router;
