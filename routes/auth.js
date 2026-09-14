const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');

const router = express.Router();

router.post('/register', async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).send('All fields are required.');
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO USERS (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, role]
        );

        res.status(201).send('User registered successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Registration failed.');
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required.');
    }

    try {
        const [rows] = await pool.query(
            'SELECT * FROM USERS WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).send('Invalid email or password.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).send('Invalid email or password.');
        }

        req.session.userId = user.user_id;
        req.session.role = user.role;

        res.status(200).send('Logged in successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Login failed.');
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Logout failed.');
        }
        res.status(200).send('Logged out successfully.');
    });
});

module.exports = router;
