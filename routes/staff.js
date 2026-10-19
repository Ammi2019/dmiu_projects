// Staff dashboard data: who am I, overview figures, student and lecturer directories.
// What each role sees is decided in utils/roles.js.
const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { ROLES, ROLE_LABELS } = require('../utils/roles');

const router = express.Router();

// The logged-in staff member, including the school a Head of Department is limited to
async function getStaffContext(req) {
    const [rows] = await pool.query('SELECT user_id, name, email, role, school FROM USERS WHERE user_id = ?', [req.user.id]);
    const me = rows[0] || {};
    return {
        ...me,
        scoped: ROLES.SCHOOL_SCOPED.includes(me.role),
        school: me.school || null
    };
}

// Adds "AND <col> = ?" for school-scoped roles. Returns null if the role is scoped but has no school yet.
function schoolFilter(ctx, column) {
    if (!ctx.scoped) return { sql: '', params: [] };
    if (!ctx.school) return null;
    return { sql: ` AND ${column} = ?`, params: [ctx.school] };
}

// GET who I am + what I can do
router.get('/me', verifyToken, checkRole(...ROLES.STAFF), async (req, res) => {
    try {
        const ctx = await getStaffContext(req);
        res.json({
            user_id: ctx.user_id,
            name: ctx.name,
            email: ctx.email,
            role: ctx.role,
            role_label: ROLE_LABELS[ctx.role] || ctx.role,
            school: ctx.school,
            school_scoped: ctx.scoped,
            can: {
                viewApplications: ROLES.APP_VIEW.includes(ctx.role),
                decideApplications: ROLES.APP_DECIDE.includes(ctx.role),
                viewStudents: ROLES.STUDENT_DIR.includes(ctx.role),
                viewStudentContacts: ROLES.STUDENT_CONTACT.includes(ctx.role),
                viewLecturers: ROLES.LECTURER_DIR.includes(ctx.role),
                manageFees: ROLES.FEE_MANAGE.includes(ctx.role),
                viewFees: ROLES.FEE_VIEW.includes(ctx.role),
                manageUsers: ctx.role === 'administrator'
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load your account.');
    }
});

// GET overview cards — the server picks which figures each role sees
router.get('/overview', verifyToken, checkRole(...ROLES.STAFF), async (req, res) => {
    try {
        const ctx = await getStaffContext(req);
        if (ctx.scoped && !ctx.school) {
            return res.json({ cards: [], notice: 'Your school has not been set yet. Ask the administrator to assign you to a school.' });
        }
        const cards = [];
        const one = async (sql, params) => Number(Object.values((await pool.query(sql, params))[0][0])[0]) || 0;

        if (ROLES.APP_VIEW.includes(ctx.role)) {
            const f = schoolFilter(ctx, 'school');
            const [rows] = await pool.query(
                `SELECT status, COUNT(*) AS n FROM applications WHERE 1=1${f.sql} GROUP BY status`, f.params);
            const by = Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
            cards.push({ label: 'Applications awaiting decision', value: by.pending || 0, tab: 'tab-applications', tone: (by.pending ? 'warn' : '') });
            cards.push({ label: 'Applications accepted', value: by.accepted || 0, tab: 'tab-applications' });
        }

        if (ctx.role === 'administrator') {
            cards.push({ label: 'Accounts awaiting approval', value: await one("SELECT COUNT(*) FROM USERS WHERE status = 'pending'"), tab: 'tab-approvals' });
        }

        if (ROLES.STUDENT_DIR.includes(ctx.role)) {
            const f = schoolFilter(ctx, 'school');
            cards.push({ label: ctx.scoped ? 'Students in your school' : 'Students', value: await one(`SELECT COUNT(*) FROM students WHERE 1=1${f.sql}`, f.params), tab: 'tab-students' });
        }

        if (ROLES.LECTURER_DIR.includes(ctx.role)) {
            const f = schoolFilter(ctx, 'school');
            cards.push({ label: ctx.scoped ? 'Lecturers in your school' : 'Lecturers', value: await one(`SELECT COUNT(*) FROM LECTURERS WHERE 1=1${f.sql}`, f.params), tab: 'tab-lecturers' });
        }

        if (ROLES.FEE_VIEW.includes(ctx.role)) {
            const [[t]] = await pool.query(
                `SELECT COALESCE(SUM(CASE WHEN entry_type = 'charge' THEN amount END), 0) AS billed,
                        COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN amount END), 0) AS paid
                 FROM fee_entries`);
            cards.push({ label: 'Fees billed', value: Number(t.billed), money: true, tab: 'tab-fees' });
            cards.push({ label: 'Fees collected', value: Number(t.paid), money: true, tab: 'tab-fees' });
            cards.push({ label: 'Payment proofs to verify', value: await one("SELECT COUNT(*) FROM payment_proofs WHERE status = 'pending'"), tab: 'tab-fees', tone: 'warn' });
            cards.push({ label: 'Outstanding balance', value: Number(t.billed) - Number(t.paid), money: true, tab: 'tab-fees', tone: (Number(t.billed) - Number(t.paid) > 0 ? 'warn' : '') });
        }

        res.json({ cards });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load overview.');
    }
});

// GET student directory (?school=&programme=&q=)
router.get('/students', verifyToken, checkRole(...ROLES.STUDENT_DIR), async (req, res) => {
    try {
        const ctx = await getStaffContext(req);
        const f = schoolFilter(ctx, 's.school');
        if (!f) return res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');

        const where = [];
        const params = [];
        if (req.query.school && !ctx.scoped) { where.push('s.school = ?'); params.push(req.query.school); }
        if (req.query.programme) { where.push('s.programme = ?'); params.push(req.query.programme); }
        if (req.query.q) {
            where.push('(u.name LIKE ? OR u.email LIKE ? OR s.student_id = ?)');
            params.push(`%${req.query.q}%`, `%${req.query.q}%`, Number(req.query.q) || 0);
        }

        const withContacts = ROLES.STUDENT_CONTACT.includes(ctx.role);
        const withFees = ROLES.FEE_VIEW.includes(ctx.role);

        const [rows] = await pool.query(
            `SELECT s.student_id, u.name, u.email, s.school, s.programme,
                    DATE_FORMAT(s.enrollment_date, '%Y-%m-%d') AS enrollment_date
                    ${withContacts ? ', p.phone, p.address, p.next_of_kin_name, p.next_of_kin_phone' : ''}
                    ${withFees ? `, (SELECT COALESCE(SUM(CASE WHEN entry_type='charge' THEN amount ELSE -amount END), 0)
                                     FROM fee_entries fe WHERE fe.student_id = s.student_id) AS balance` : ''}
             FROM students s
             JOIN USERS u ON s.user_id = u.user_id
             ${withContacts ? 'LEFT JOIN student_profiles p ON p.student_id = s.student_id' : ''}
             WHERE 1=1${f.sql}${where.length ? ' AND ' + where.join(' AND ') : ''}
             ORDER BY u.name
             LIMIT 500`,
            [...f.params, ...params]
        );
        res.json({ school: ctx.scoped ? ctx.school : null, students: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch students.');
    }
});

// GET lecturer directory
router.get('/lecturers', verifyToken, checkRole(...ROLES.LECTURER_DIR), async (req, res) => {
    try {
        const ctx = await getStaffContext(req);
        const f = schoolFilter(ctx, 'L.school');
        if (!f) return res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');

        const [rows] = await pool.query(
            `SELECT L.lecturer_id, U.name, U.email, U.role, L.school,
                    P.phone, P.office, P.qualification, P.specialization,
                    (SELECT COUNT(*) FROM assignments A WHERE A.lecturer_id = L.lecturer_id) AS assignments_posted,
                    (SELECT COUNT(*) FROM result_sheets R WHERE R.lecturer_id = L.lecturer_id) AS result_sheets
             FROM LECTURERS L
             JOIN USERS U ON L.user_id = U.user_id
             LEFT JOIN lecturer_profiles P ON P.lecturer_id = L.lecturer_id
             WHERE 1=1${f.sql}
             ORDER BY U.name`,
            f.params
        );
        res.json({ school: ctx.scoped ? ctx.school : null, lecturers: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch lecturers.');
    }
});

module.exports = router;
module.exports.getStaffContext = getStaffContext;
