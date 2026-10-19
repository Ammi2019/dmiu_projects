// Notifications (the bell) for every logged-in user, and announcements sent by staff.
const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const { notify, audienceUserIds } = require('../utils/notify');
const { findSchool, findProgramme } = require('./programmes');

const router = express.Router();

// GET my notifications (latest 50) + unread count
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT notification_id, category, title, body, link, is_read,
                    DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS created_at
             FROM notifications WHERE user_id = ?
             ORDER BY created_at DESC, notification_id DESC LIMIT 50`,
            [req.user.id]
        );
        const [[{ unread }]] = await pool.query(
            'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
        res.json({ unread: Number(unread), notifications: rows.map(r => ({ ...r, is_read: Boolean(r.is_read) })) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch notifications.');
    }
});

// Mark one as read
router.put('/:id/read', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.send('OK');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update notification.');
    }
});

// Mark all as read
router.put('/read-all', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
        res.send('OK');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update notifications.');
    }
});

// ===== Announcements =====

// SEND { audience: everyone|students|lecturers|staff, school?, programme?, title, body }
router.post('/announcements', verifyToken, checkRole(...ROLES.ANNOUNCE), async (req, res) => {
    const audience = req.body.audience;
    const title = (req.body.title || '').trim();
    const body = (req.body.body || '').trim();
    let school = (req.body.school || '').trim() || null;
    let programme = (req.body.programme || '').trim() || null;

    if (!['everyone', 'students', 'lecturers', 'staff'].includes(audience)) return res.status(400).send('Choose who should receive it.');
    if (!title || title.length > 200) return res.status(400).send('Enter a title (up to 200 characters).');
    if (!body || body.length > 1500) return res.status(400).send('Write the message (up to 1500 characters).');
    if (school && !findSchool(school)) return res.status(400).send('Unknown school.');
    if (programme) {
        const match = findProgramme(programme);
        if (!match) return res.status(400).send('Unknown programme.');
        if (audience !== 'students') return res.status(400).send('A programme can only be chosen when sending to students.');
        school = match.school.name;
    }

    try {
        // A Head of Department can only reach their own school
        const [[me]] = await pool.query('SELECT role, school FROM USERS WHERE user_id = ?', [req.user.id]);
        if (ROLES.SCHOOL_SCOPED.includes(me.role)) {
            if (!me.school) return res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');
            if (school && school !== me.school) return res.status(403).send(`You can only send announcements to the ${me.school}.`);
            school = me.school;
        }

        const recipients = (await audienceUserIds({ audience, school, programme })).filter(id => id !== req.user.id);
        if (recipients.length === 0) return res.status(400).send('Nobody matches that audience yet.');

        await pool.query(
            'INSERT INTO announcements (sender_id, audience, school, programme, title, body, recipients) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, audience, school, programme, title, body, recipients.length]
        );
        const [[sender]] = await pool.query('SELECT name FROM USERS WHERE user_id = ?', [req.user.id]);
        await notify(recipients, { category: 'announcement', title, body: `${body}\n— ${sender.name}`, link: null });

        res.status(201).send(`Announcement sent to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to send announcement.');
    }
});

// LIST recent announcements (staff who can announce see all; HOD sees their school's + their own)
router.get('/announcements', verifyToken, checkRole(...ROLES.ANNOUNCE), async (req, res) => {
    try {
        const [[me]] = await pool.query('SELECT role, school FROM USERS WHERE user_id = ?', [req.user.id]);
        const scoped = ROLES.SCHOOL_SCOPED.includes(me.role);
        const [rows] = await pool.query(
            `SELECT a.announcement_id, a.audience, a.school, a.programme, a.title, a.body, a.recipients,
                    DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i') AS created_at, u.name AS sender, u.role AS sender_role
             FROM announcements a JOIN USERS u ON a.sender_id = u.user_id
             ${scoped ? 'WHERE a.school = ? OR a.sender_id = ?' : ''}
             ORDER BY a.created_at DESC LIMIT 50`,
            scoped ? [me.school, req.user.id] : []
        );
        res.json({ announcements: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch announcements.');
    }
});

module.exports = router;
