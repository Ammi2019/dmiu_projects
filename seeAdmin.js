require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function seed() {
    const hashedPassword = await bcrypt.hash('ChangeMeImmediately123!', 10);

    try {
        await pool.query(
            'INSERT INTO USERS (name, email, password, role) VALUES (?, ?, ?, ?)',
            ['System Admin', 'admin@dmiseu.edu', hashedPassword, 'head_of_department']
        );
        console.log('Admin account created: admin@dmiseu.edu / ChangeMeImmediately123!');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            console.log('Admin account already exists — nothing to do.');
        } else {
            console.error('Seed failed:', err);
        }
    } finally {
        process.exit();
    }
}

seed();
