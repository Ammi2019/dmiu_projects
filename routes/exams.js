// Exams: eligibility (the "No Due Certificate") and Hall Tickets.
//
// How a student becomes eligible for an exam session:
//   Departments (any order)
//     1. Accounts office  — automatic: cleared once the student has paid at least the session's
//                           minimum % of everything billed (75% for mid-semester by default).
//                           The accountant can still clear or hold a student manually.
//     2. Class Advisor    — a lecturer / class teacher in the student's school clears them.
//     3. Hostel           — the Class Advisor, Head of Department (both for their own school) or the
//                           Dean of Students clears hostel residents (not applicable to others).
//   Final approvals (strictly in this order, each only after the previous one)
//     4. Head of Department (of the student's school)
//     5. Dean of Students
//     6. Dean (Academic)  — this approval issues the Hall Ticket, which the student can print.
//
// The Administrator can act on any step. Exam sessions and timetables are set up by the
// Registrar, the Dean (Academic) or the Administrator.
const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const { notify, userIdForStudent } = require('../utils/notify');

const router = express.Router();

const STEPS = {
    accounts: { label: 'Accounts office', roles: ['accountant', 'administrator'] },
    advisor:  { label: 'Class Advisor', roles: ['lecturer', 'class_teacher', 'administrator'] },
    hostel:   { label: 'Hostel', roles: ['lecturer', 'class_teacher', 'head_of_department', 'dean_of_students', 'administrator'] },
    hod:      { label: 'Head of Department', roles: ['head_of_department', 'administrator'], after: ['accounts', 'advisor', 'hostel'] },
    dos:      { label: 'Dean of Students', roles: ['dean_of_students', 'administrator'], after: ['hod'] },
    academic: { label: 'Dean (Academic)', roles: ['dean_academic', 'administrator'], after: ['dos'] }
};
const STEP_KEYS = Object.keys(STEPS);
const DEPARTMENTS = ['accounts', 'advisor', 'hostel'];
const BOARD_ROLES = [...ROLES.EXAM_VIEW, 'lecturer', 'class_teacher'];

const clean = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const SEMESTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// Accepts "V", "v", "5" or "Semester 5" and returns the Roman numeral used on hall tickets
function toSemester(v) {
    const t = String(v || '').trim().toUpperCase().replace(/^SEM(ESTER)?\s*/, '');
    if (SEMESTERS.includes(t)) return t;
    const n = Number(t);
    return Number.isInteger(n) && n >= 1 && n <= SEMESTERS.length ? SEMESTERS[n - 1] : null;
}
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(Date.parse(v));

// ---------------------------------------------------------------------------------------------
// Who is asking, and which school they are limited to (HOD and lecturers only see their school)
// ---------------------------------------------------------------------------------------------
async function contextFor(req) {
    const [[u]] = await pool.query('SELECT user_id, name, role, school FROM USERS WHERE user_id = ?', [req.user.id]);
    const ctx = { id: req.user.id, name: u ? u.name : '', role: req.user.role, school: u ? u.school : null, scoped: false };
    if (ctx.role === 'head_of_department') ctx.scoped = true;
    if (ctx.role === 'lecturer' || ctx.role === 'class_teacher') {
        const [[l]] = await pool.query('SELECT school FROM LECTURERS WHERE user_id = ?', [req.user.id]);
        ctx.school = (l && l.school) || ctx.school;
        ctx.scoped = true;
    }
    return ctx;
}

async function getSession(id) {
    const [[s]] = await pool.query(
        `SELECT session_id, name, exam_type, min_paid_pct, centre_name, centre_code, is_open,
                DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at
         FROM exam_sessions WHERE session_id = ?`, [id]);
    return s || null;
}

// A session's papers. With a programme + semester, only the papers that student sits.
// (Papers saved before semesters existed have no semester and apply to the whole programme.)
async function timetableFor(sessionId, programme = null, semester = undefined) {
    const bySemester = semester !== undefined;
    const [rows] = await pool.query(
        `SELECT row_id, school, programme, semester, DATE_FORMAT(exam_date, '%Y-%m-%d') AS exam_date, start_time, module_code, module_name
         FROM exam_timetable WHERE session_id = ? AND (? IS NULL OR programme = ?)
         ${bySemester ? 'AND (semester IS NULL OR semester = ?)' : ''}
         ORDER BY programme, semester, exam_date, start_time, module_code`,
        bySemester ? [sessionId, programme, programme, semester] : [sessionId, programme, programme]);
    return rows;
}
const papersFor = (timetable, student) => timetable.filter(t =>
    t.programme === student.programme && (t.semester === null || t.semester === student.current_semester));

// Students taking a session (their programme has a timetable in it), with fees and clearance row.
async function studentsForSession(sessionId, { school = null, programme = null, q = null, studentId = null } = {}) {
    const where = ['s.programme IN (SELECT DISTINCT programme FROM exam_timetable WHERE session_id = ?)'];
    const params = [sessionId];
    if (school) { where.push('s.school = ?'); params.push(school); }
    if (programme) { where.push('s.programme = ?'); params.push(programme); }
    if (studentId) { where.push('s.student_id = ?'); params.push(studentId); }
    if (q) {
        where.push('(u.name LIKE ? OR s.reg_no LIKE ? OR s.student_id = ? OR c.ticket_no = ?)');
        params.push(`%${q}%`, `%${q}%`, Number(q) || 0, q);
    }
    const [rows] = await pool.query(
        `SELECT s.student_id, s.user_id, u.name, u.email, s.school, s.programme, s.reg_no, s.current_semester,
                s.hostel_resident,
                (SELECT COALESCE(SUM(amount), 0) FROM fee_entries fe WHERE fe.student_id = s.student_id AND fe.entry_type = 'charge') AS charged,
                (SELECT COALESCE(SUM(amount), 0) FROM fee_entries fe WHERE fe.student_id = s.student_id AND fe.entry_type = 'payment') AS paid,
                c.accounts_status, c.accounts_by, DATE_FORMAT(c.accounts_at, '%Y-%m-%d %H:%i') AS accounts_at, c.accounts_note,
                c.advisor_status,  c.advisor_by,  DATE_FORMAT(c.advisor_at,  '%Y-%m-%d %H:%i') AS advisor_at,  c.advisor_note,
                c.hostel_status,   c.hostel_by,   DATE_FORMAT(c.hostel_at,   '%Y-%m-%d %H:%i') AS hostel_at,   c.hostel_note,
                c.hod_status,      c.hod_by,      DATE_FORMAT(c.hod_at,      '%Y-%m-%d %H:%i') AS hod_at,      c.hod_note,
                c.dos_status,      c.dos_by,      DATE_FORMAT(c.dos_at,      '%Y-%m-%d %H:%i') AS dos_at,      c.dos_note,
                c.academic_status, c.academic_by, DATE_FORMAT(c.academic_at, '%Y-%m-%d %H:%i') AS academic_at, c.academic_note,
                c.ticket_no, DATE_FORMAT(c.issued_at, '%Y-%m-%d %H:%i') AS issued_at
         FROM students s
         JOIN USERS u ON u.user_id = s.user_id
         LEFT JOIN exam_clearances c ON c.student_id = s.student_id AND c.session_id = ?
         WHERE ${where.join(' AND ')}
         ORDER BY s.programme, u.name
         LIMIT 1000`,
        [sessionId, ...params]);
    return rows;
}

// Names of the officers who signed, for display
async function officerNames(rows) {
    const ids = new Set();
    rows.forEach(r => STEP_KEYS.forEach(k => r[`${k}_by`] && ids.add(r[`${k}_by`])));
    if (ids.size === 0) return {};
    const [users] = await pool.query('SELECT user_id, name FROM USERS WHERE user_id IN (?)', [[...ids]]);
    return Object.fromEntries(users.map(u => [u.user_id, u.name]));
}

// Turns a raw row into the checklist: one entry per step with a status the UI can show.
//   status: cleared | held | pending | waiting (earlier steps not done) | na (not applicable)
function evaluate(row, session, names = {}) {
    const steps = {};
    const charged = Number(row.charged) || 0;
    const paid = Number(row.paid) || 0;
    const pct = charged > 0 ? Math.floor((paid / charged) * 100) : 100;
    const needed = Math.ceil((charged * session.min_paid_pct) / 100 - paid);

    STEP_KEYS.forEach(k => {
        const s = {
            key: k,
            label: STEPS[k].label,
            status: row[`${k}_status`] || 'pending',
            by: row[`${k}_by`] ? (names[row[`${k}_by`]] || 'Staff') : null,
            at: row[`${k}_at`] || null,
            note: row[`${k}_note`] || null
        };
        if (k === 'accounts') {
            s.paid_pct = pct;
            s.required_pct = session.min_paid_pct;
            s.charged = charged;
            s.paid = paid;
            s.auto = !row.accounts_status;
            if (!row.accounts_status) {
                s.status = pct >= session.min_paid_pct ? 'cleared' : 'pending';
                s.detail = pct >= session.min_paid_pct
                    ? `Paid ${pct}% of fees (needs ${session.min_paid_pct}%)`
                    : `Paid ${pct}% of fees — needs ${session.min_paid_pct}%. Pay at least K${Math.max(needed, 0).toLocaleString('en-US')} more.`;
            } else {
                s.detail = row.accounts_status === 'cleared' ? 'Cleared by the Accounts office' : 'Held by the Accounts office';
            }
        }
        if (k === 'hostel' && !Number(row.hostel_resident)) {
            s.status = 'na';
            s.detail = 'Not a hostel resident';
        }
        steps[k] = s;
    });

    const done = k => ['cleared', 'na'].includes(steps[k].status);
    STEP_KEYS.forEach(k => {
        const after = STEPS[k].after || [];
        if (steps[k].status === 'pending' && !after.every(done)) steps[k].status = 'waiting';
    });

    const departmentsCleared = DEPARTMENTS.every(done);
    return {
        steps,
        departments_cleared: departmentsCleared,
        eligible: !!row.ticket_no,
        ticket_no: row.ticket_no || null,
        issued_at: row.issued_at || null
    };
}

// Can this person act on this step for this student right now?
function canAct(ctx, stepKey, student, evaluation) {
    const step = STEPS[stepKey];
    if (!step.roles.includes(ctx.role)) return false;
    if (ctx.scoped && (!ctx.school || ctx.school !== student.school)) return false;
    if (stepKey === 'hostel' && evaluation.steps.hostel.status === 'na') return false;
    if (evaluation.ticket_no && stepKey !== 'academic') return false; // locked once issued
    const after = step.after || [];
    return after.every(k => ['cleared', 'na'].includes(evaluation.steps[k].status));
}

function publicStudent(r) {
    return {
        student_id: r.student_id, name: r.name, email: r.email, school: r.school, programme: r.programme,
        reg_no: r.reg_no, current_semester: r.current_semester, hostel_resident: !!Number(r.hostel_resident)
    };
}

// =============================================================================================
// Exam sessions + timetable
// =============================================================================================

// LIST sessions
router.get('/sessions', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT es.session_id, es.name, es.exam_type, es.min_paid_pct, es.centre_name, es.centre_code, es.is_open,
                    DATE_FORMAT(es.created_at, '%Y-%m-%d') AS created_at,
                    (SELECT COUNT(*) FROM exam_timetable t WHERE t.session_id = es.session_id) AS papers,
                    (SELECT COUNT(*) FROM exam_clearances c WHERE c.session_id = es.session_id AND c.ticket_no IS NOT NULL) AS tickets
             FROM exam_sessions es ORDER BY es.is_open DESC, es.created_at DESC`);
        res.json({
            kind: 'exam',
            outcome_label: 'Hall ticket',
            done_label: 'Hall ticket issued',
            sessions: rows,
            can_manage: ROLES.EXAM_MANAGE.includes(req.user.role),
            can_edit_details: ROLES.EXAM_DETAILS.includes(req.user.role),
            can_mark_hostel: ROLES.HOSTEL.includes(req.user.role),
            steps: STEP_KEYS.map(k => ({ key: k, label: STEPS[k].label, mine: STEPS[k].roles.includes(req.user.role) }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load exam sessions.');
    }
});

function readSession(body) {
    const name = clean(body.name);
    const exam_type = body.exam_type === 'end' ? 'end' : 'mid';
    const pct = Number(body.min_paid_pct);
    const centre_name = clean(body.centre_name) || 'CHIPATA';
    const centre_code = clean(body.centre_code) || '33';
    if (!name || name.length > 120) return { error: 'Enter a session name, e.g. "Mid-Semester Test – October 2026".' };
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return { error: 'Minimum fees paid must be a whole number from 0 to 100.' };
    if (centre_name.length > 60 || centre_code.length > 10) return { error: 'Centre name or code is too long.' };
    return { name, exam_type, min_paid_pct: pct, centre_name, centre_code };
}

// CREATE a session
router.post('/sessions', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const s = readSession(req.body);
    if (s.error) return res.status(400).send(s.error);
    try {
        const [r] = await pool.query(
            'INSERT INTO exam_sessions (name, exam_type, min_paid_pct, centre_name, centre_code, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [s.name, s.exam_type, s.min_paid_pct, s.centre_name, s.centre_code, req.user.id]);
        res.status(201).json({ session_id: r.insertId, message: 'Exam session created.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create the exam session.');
    }
});

// UPDATE a session (details, or open / close it)
router.put('/sessions/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const current = await getSession(req.params.id);
        if (!current) return res.status(404).send('Exam session not found.');
        const s = readSession({ ...current, ...req.body });
        if (s.error) return res.status(400).send(s.error);
        const isOpen = req.body.is_open === undefined ? current.is_open : (req.body.is_open ? 1 : 0);
        await pool.query(
            'UPDATE exam_sessions SET name = ?, exam_type = ?, min_paid_pct = ?, centre_name = ?, centre_code = ?, is_open = ? WHERE session_id = ?',
            [s.name, s.exam_type, s.min_paid_pct, s.centre_name, s.centre_code, isOpen, req.params.id]);
        res.send('Exam session updated.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update the exam session.');
    }
});

// DELETE a session — only while no hall tickets have been issued for it
router.delete('/sessions/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const [[t]] = await pool.query('SELECT COUNT(*) AS n FROM exam_clearances WHERE session_id = ? AND ticket_no IS NOT NULL', [req.params.id]);
        if (Number(t.n) > 0) return res.status(409).send('Hall tickets have already been issued for this session. Close it instead of deleting it.');
        const [r] = await pool.query('DELETE FROM exam_sessions WHERE session_id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).send('Exam session not found.');
        await pool.query('DELETE FROM exam_timetable WHERE session_id = ?', [req.params.id]);
        await pool.query('DELETE FROM exam_clearances WHERE session_id = ?', [req.params.id]);
        res.send('Exam session deleted.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete the exam session.');
    }
});

// ---------- Programme module catalogue ----------

// LIST modules (?programme=&semester=)
router.get('/modules', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const programme = clean(req.query.programme);
        const semester = toSemester(req.query.semester);
        const [rows] = await pool.query(
            `SELECT module_id, school, programme, semester, module_code, module_name FROM programme_modules
             WHERE (? IS NULL OR programme = ?) AND (? IS NULL OR semester = ?)
             ORDER BY programme, FIELD(semester, ${SEMESTERS.map(() => '?').join(', ')}), module_code`,
            [programme, programme, semester, semester, ...SEMESTERS]);
        res.json({ semesters: SEMESTERS, modules: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load programme modules.');
    }
});

// ADD a module to a programme { school, programme, semester, module_code, module_name }
router.post('/modules', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const school = clean(req.body.school);
    const programme = clean(req.body.programme);
    const semester = toSemester(req.body.semester);
    const module_code = (clean(req.body.module_code) || '').toUpperCase();
    const module_name = (clean(req.body.module_name) || '').toUpperCase();
    if (!school || !programme) return res.status(400).send('Choose the school and programme.');
    if (!semester) return res.status(400).send('Choose the semester this module is taught in.');
    if (!/^[A-Z0-9-]{2,20}$/.test(module_code)) return res.status(400).send('Enter the module code (letters and numbers, up to 20).');
    if (!module_name || module_name.length > 150) return res.status(400).send('Enter the module name.');
    try {
        const [dupe] = await pool.query('SELECT semester FROM programme_modules WHERE programme = ? AND module_code = ?', [programme, module_code]);
        if (dupe.length) return res.status(409).send(`${module_code} is already listed for this programme (Semester ${dupe[0].semester}).`);
        await pool.query(
            'INSERT INTO programme_modules (school, programme, semester, module_code, module_name) VALUES (?, ?, ?, ?, ?)',
            [school, programme, semester, module_code, module_name]);
        res.status(201).send(`${module_code} added to Semester ${semester}.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to add the module.');
    }
});

// REMOVE a module from the catalogue (papers already on a timetable keep their copy)
router.delete('/modules/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const [r] = await pool.query('DELETE FROM programme_modules WHERE module_id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).send('Module not found.');
        res.send('Module removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove the module.');
    }
});

// Programmes on a session's timetable (for the board's filter)
router.get('/sessions/:id/programmes', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT DISTINCT programme FROM exam_timetable WHERE session_id = ? ORDER BY programme', [req.params.id]);
        res.json({ programmes: rows.map(r => r.programme) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load programmes.');
    }
});

// GET a session's timetable (?programme=)
router.get('/sessions/:id/timetable', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const session = await getSession(req.params.id);
        if (!session) return res.status(404).send('Exam session not found.');
        res.json({ session, timetable: await timetableFor(req.params.id, clean(req.query.programme)) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load the timetable.');
    }
});

// ADD a paper to the timetable { module_id, exam_date, start_time }
// The module (code, name, programme, semester) comes from the programme's module list,
// so a programme's timetable can only contain that programme's own modules.
router.post('/sessions/:id/timetable', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const exam_date = clean(req.body.exam_date);
    const start_time = clean(req.body.start_time);
    if (!Number(req.body.module_id)) return res.status(400).send('Choose a module from the programme\'s module list.');
    if (!isDate(exam_date)) return res.status(400).send('Enter a valid exam date.');
    if (start_time && !/^\d{2}:\d{2}$/.test(start_time)) return res.status(400).send('Enter the start time as HH:MM.');
    try {
        if (!(await getSession(req.params.id))) return res.status(404).send('Exam session not found.');
        const [[m]] = await pool.query(
            'SELECT school, programme, semester, module_code, module_name FROM programme_modules WHERE module_id = ?',
            [Number(req.body.module_id)]);
        if (!m) return res.status(404).send('That module is not in the programme\'s module list.');
        if (req.body.programme && req.body.programme !== m.programme) {
            return res.status(400).send(`${m.module_code} is not a module of ${req.body.programme}.`);
        }
        const [dupe] = await pool.query(
            'SELECT 1 FROM exam_timetable WHERE session_id = ? AND programme = ? AND module_code = ?',
            [req.params.id, m.programme, m.module_code]);
        if (dupe.length) return res.status(409).send(`${m.module_code} is already on this programme's timetable.`);
        await pool.query(
            `INSERT INTO exam_timetable (session_id, school, programme, semester, exam_date, start_time, module_code, module_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, m.school, m.programme, m.semester, exam_date, start_time, m.module_code, m.module_name]);
        res.status(201).send(`${m.module_code} ${m.module_name} added for Semester ${m.semester}.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to add the paper.');
    }
});

// REMOVE a paper
router.delete('/timetable/:rowId', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const [r] = await pool.query('DELETE FROM exam_timetable WHERE row_id = ?', [req.params.rowId]);
        if (r.affectedRows === 0) return res.status(404).send('Paper not found.');
        res.send('Paper removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove the paper.');
    }
});

// =============================================================================================
// Clearance board (staff + class advisors)
// =============================================================================================

// LIST students and their clearance (?school=&programme=&q=&filter=mine|eligible|pending)
router.get('/sessions/:id/clearances', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const session = await getSession(req.params.id);
        if (!session) return res.status(404).send('Exam session not found.');
        const ctx = await contextFor(req);
        if (ctx.scoped && !ctx.school) return res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');

        const rows = await studentsForSession(session.session_id, {
            school: ctx.scoped ? ctx.school : clean(req.query.school),
            programme: clean(req.query.programme),
            q: clean(req.query.q)
        });
        const names = await officerNames(rows);
        const timetable = await timetableFor(session.session_id);
        let students = rows.map(r => {
            const ev = evaluate(r, session, names);
            const actions = STEP_KEYS.filter(k => canAct(ctx, k, r, ev));
            return { ...publicStudent(r), ...ev, actions, papers: papersFor(timetable, r).length };
        });

        const filter = req.query.filter;
        if (filter === 'mine') {
            // Only steps still waiting on me
            students = students.filter(s => s.actions.some(k => ['pending', 'held'].includes(s.steps[k].status)));
        } else if (filter === 'eligible') {
            students = students.filter(s => s.eligible);
        } else if (filter === 'pending') {
            students = students.filter(s => !s.eligible);
        }

        res.json({
            session,
            school: ctx.scoped ? ctx.school : null,
            counts: {
                total: rows.length,
                eligible: rows.filter(r => r.ticket_no).length
            },
            students
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load the clearance list.');
    }
});

// DECIDE a step { decision: 'cleared' | 'held' | 'reset', note }
router.put('/sessions/:id/clearances/:studentId/:step', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    const stepKey = req.params.step;
    const decision = req.body.decision;
    const note = clean(req.body.note);
    if (!STEPS[stepKey]) return res.status(400).send('Unknown clearance step.');
    if (!['cleared', 'held', 'reset'].includes(decision)) return res.status(400).send('Choose clear, hold or reset.');
    if (decision === 'held' && !note) return res.status(400).send('Give the student a reason when holding their clearance.');
    if (note && note.length > 300) return res.status(400).send('The note is too long (300 characters max).');

    try {
        const session = await getSession(req.params.id);
        if (!session) return res.status(404).send('Exam session not found.');
        if (!session.is_open) return res.status(409).send('This exam session is closed.');
        const ctx = await contextFor(req);

        const [row] = await studentsForSession(session.session_id, { studentId: Number(req.params.studentId) || -1 });
        if (!row) return res.status(404).send('This student is not sitting this exam session.');
        const ev = evaluate(row, session);
        if (!canAct(ctx, stepKey, row, ev)) {
            if (!STEPS[stepKey].roles.includes(ctx.role)) return res.status(403).send(`Only the ${STEPS[stepKey].label} can sign this step.`);
            if (ctx.scoped && ctx.school !== row.school) return res.status(403).send('This student is not in your school.');
            if (ev.ticket_no && stepKey !== 'academic') return res.status(409).send('The hall ticket has already been issued.');
            return res.status(409).send('Earlier clearance steps must be completed first.');
        }

        if (stepKey === 'academic' && decision === 'cleared') {
            const papers = papersFor(await timetableFor(session.session_id, row.programme), row);
            if (!row.current_semester) return res.status(409).send(`Set ${row.name}'s current semester first, so the hall ticket lists the right modules.`);
            if (papers.length === 0) return res.status(409).send(`There are no Semester ${row.current_semester} papers for ${row.programme} on this timetable.`);
        }

        const status = decision === 'reset' ? null : decision;
        const issueTicket = stepKey === 'academic' && decision === 'cleared';
        const revokeTicket = stepKey === 'academic' && decision !== 'cleared';
        const ticketNo = issueTicket
            ? `HT${String(new Date().getFullYear()).slice(-2)}-${String(session.session_id).padStart(2, '0')}-${String(row.student_id).padStart(5, '0')}`
            : null;

        await pool.query(
            `INSERT INTO exam_clearances (session_id, student_id, ${stepKey}_status, ${stepKey}_by, ${stepKey}_at, ${stepKey}_note)
             VALUES (?, ?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE ${stepKey}_status = VALUES(${stepKey}_status), ${stepKey}_by = VALUES(${stepKey}_by),
                 ${stepKey}_at = VALUES(${stepKey}_at), ${stepKey}_note = VALUES(${stepKey}_note)`,
            [session.session_id, row.student_id, status, status ? ctx.id : null, note]);

        // Holding or resetting a final approval sends the later approvals back to the queue
        if (decision !== 'cleared' && ['hod', 'dos'].includes(stepKey)) {
            const later = stepKey === 'hod' ? ['dos', 'academic'] : ['academic'];
            await pool.query(
                `UPDATE exam_clearances SET ${later.map(k => `${k}_status = NULL, ${k}_by = NULL, ${k}_at = NULL`).join(', ')}
                 WHERE session_id = ? AND student_id = ?`, [session.session_id, row.student_id]);
        }

        if (issueTicket) {
            await pool.query('UPDATE exam_clearances SET ticket_no = ?, issued_at = NOW() WHERE session_id = ? AND student_id = ?',
                [ticketNo, session.session_id, row.student_id]);
            notify([row.user_id], {
                category: 'exams',
                title: `Your hall ticket for ${session.name} is ready`,
                body: 'You have been cleared by all offices. Open the Exams tab to print your hall ticket.',
                link: 'tab-exams'
            });
        } else if (revokeTicket && row.ticket_no) {
            await pool.query('UPDATE exam_clearances SET ticket_no = NULL, issued_at = NULL WHERE session_id = ? AND student_id = ?',
                [session.session_id, row.student_id]);
        }

        if (decision === 'held') {
            notify([row.user_id], {
                category: 'exams',
                title: `${STEPS[stepKey].label}: exam clearance on hold`,
                body: `${session.name}: ${note}`,
                link: 'tab-exams'
            });
        }

        res.json({
            message: issueTicket ? `Approved. Hall ticket ${ticketNo} issued.`
                : decision === 'cleared' ? `${STEPS[stepKey].label}: cleared.`
                : decision === 'held' ? `${STEPS[stepKey].label}: on hold.` : `${STEPS[stepKey].label}: reset.`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to save the clearance.');
    }
});

// UPDATE hall-ticket details kept by the registry { reg_no, current_semester }
router.put('/students/:studentId/details', verifyToken, checkRole(...ROLES.EXAM_DETAILS), async (req, res) => {
    const reg_no = clean(req.body.reg_no);
    const current_semester = clean(req.body.current_semester) ? toSemester(req.body.current_semester) : null;
    if (clean(req.body.current_semester) && !current_semester) return res.status(400).send('Choose a semester from I to X.');
    if (reg_no && !/^[A-Za-z0-9/-]{3,30}$/.test(reg_no)) return res.status(400).send('Register number may only contain letters, numbers, / and - (3–30 characters).');
    try {
        if (reg_no) {
            const [taken] = await pool.query('SELECT 1 FROM students WHERE reg_no = ? AND student_id <> ?', [reg_no, req.params.studentId]);
            if (taken.length) return res.status(409).send('That register number belongs to another student.');
        }
        const [r] = await pool.query('UPDATE students SET reg_no = ?, current_semester = ? WHERE student_id = ?',
            [reg_no, current_semester, req.params.studentId]);
        if (r.affectedRows === 0) return res.status(404).send('Student not found.');
        res.send('Student details saved.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to save the student details.');
    }
});

// MARK a student as a hostel resident or not { hostel_resident: true|false }
router.put('/students/:studentId/hostel', verifyToken, checkRole(...ROLES.HOSTEL), async (req, res) => {
    try {
        const [r] = await pool.query('UPDATE students SET hostel_resident = ? WHERE student_id = ?',
            [req.body.hostel_resident ? 1 : 0, req.params.studentId]);
        if (r.affectedRows === 0) return res.status(404).send('Student not found.');
        res.send(req.body.hostel_resident ? 'Marked as a hostel resident.' : 'Marked as not living in the hostel.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update hostel status.');
    }
});

// =============================================================================================
// Student — my eligibility and my hall ticket
// =============================================================================================
async function myStudent(userId) {
    const [[s]] = await pool.query('SELECT student_id, programme, current_semester FROM students WHERE user_id = ?', [userId]);
    return s || null;
}

// My exam sessions with the clearance checklist
router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const me = await myStudent(req.user.id);
        if (!me) return res.status(404).send('No student record is linked to your account.');
        if (!me.programme) return res.json({ sessions: [], no_programme: true });

        const [sessions] = await pool.query(
            `SELECT DISTINCT es.session_id FROM exam_sessions es
             JOIN exam_timetable t ON t.session_id = es.session_id AND t.programme = ?
             LEFT JOIN exam_clearances c ON c.session_id = es.session_id AND c.student_id = ?
             WHERE es.is_open = 1 OR c.ticket_no IS NOT NULL
             ORDER BY es.session_id DESC`,
            [me.programme, me.student_id]);

        const out = [];
        for (const { session_id } of sessions) {
            const session = await getSession(session_id);
            const [row] = await studentsForSession(session_id, { studentId: me.student_id });
            if (!row) continue;
            const names = await officerNames([row]);
            out.push({
                session,
                ...evaluate(row, session, names),
                timetable: await timetableFor(session_id, me.programme, me.current_semester)
            });
        }
        res.json({ sessions: out, semester: me.current_semester, programme: me.programme });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load your exam clearance.');
    }
});

// My hall ticket — only once it has been issued
router.get('/mine/:sessionId/ticket', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const me = await myStudent(req.user.id);
        if (!me) return res.status(404).send('No student record is linked to your account.');
        const session = await getSession(req.params.sessionId);
        if (!session) return res.status(404).send('Exam session not found.');
        const [row] = await studentsForSession(session.session_id, { studentId: me.student_id });
        if (!row || !row.ticket_no) return res.status(403).send('Your hall ticket has not been issued yet. Complete all clearance steps first.');

        const [[photo]] = await pool.query('SELECT (photo_path IS NOT NULL) AS has_photo FROM student_profiles WHERE student_id = ?', [me.student_id]);
        res.json({
            session,
            ticket_no: row.ticket_no,
            issued_at: row.issued_at,
            student: { ...publicStudent(row), has_photo: !!(photo && photo.has_photo) },
            timetable: await timetableFor(session.session_id, row.programme, row.current_semester)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load your hall ticket.');
    }
});

module.exports = router;
