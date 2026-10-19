// Semester registration.
//
// Every student starts in Semester I. Each semester the student clicks "Register" in their portal
// during an open registration window. The registration is then signed, strictly in this order:
//   1. Accounts office  — automatic once the student has paid at least the window's minimum % of
//                         everything billed (40% by default). The accountant can clear or hold manually.
//   2. Class Advisor    — a lecturer / class teacher in the student's school
//   3. Head of Department (of the student's school)
//   4. Dean of Students
//   5. Dean (Academic)  — this approval completes the registration and moves the student to that semester.
// Each registration is kept, so the table is the student's semester-by-semester registration history.
//
// Direct entry / exemptions: the registry can exempt a student from a range of semesters (e.g. I–II for a
// direct-entry student). A new direct-entry student starts at the first semester they are not exempted from,
// and registration always skips exempted semesters.
const express = require('express');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const { notify } = require('../utils/notify');

const router = express.Router();

const SEMESTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const STEPS = {
    accounts: { label: 'Accounts office', roles: ['accountant', 'administrator'] },
    advisor:  { label: 'Class Advisor', roles: ['lecturer', 'class_teacher', 'administrator'] },
    hod:      { label: 'Head of Department', roles: ['head_of_department', 'administrator'] },
    dos:      { label: 'Dean of Students', roles: ['dean_of_students', 'administrator'] },
    academic: { label: 'Dean (Academic)', roles: ['dean_academic', 'administrator'] }
};
const ORDER = Object.keys(STEPS);              // strictly sequential
const BOARD_ROLES = [...ROLES.EXAM_VIEW, 'lecturer', 'class_teacher'];
const clean = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const nextSemester = s => SEMESTERS[SEMESTERS.indexOf(s) + 1] || null;
const semIndex = s => SEMESTERS.indexOf(s);

// Exemptions for a student, and the set of exempted semesters
async function exemptionsFor(studentId) {
    const [rows] = await pool.query(
        `SELECT e.exemption_id, e.from_semester, e.to_semester, e.reason, DATE_FORMAT(e.granted_at, '%Y-%m-%d') AS granted_at, u.name AS granted_by
         FROM student_exemptions e LEFT JOIN USERS u ON u.user_id = e.granted_by
         WHERE e.student_id = ? ORDER BY e.exemption_id`, [studentId]);
    const set = new Set();
    rows.forEach(r => { for (let i = semIndex(r.from_semester); i <= semIndex(r.to_semester); i++) set.add(SEMESTERS[i]); });
    return { list: rows, set };
}
// The first semester at or after `sem` that is not exempted (null if none left)
function firstOpen(sem, exempt) {
    for (let i = Math.max(semIndex(sem), 0); i < SEMESTERS.length; i++) if (!exempt.has(SEMESTERS[i])) return SEMESTERS[i];
    return null;
}

// Number of semesters in a programme (years x 2), from data/programmes.json
function maxSemesterFor(programme) {
    try {
        const data = require('../data/programmes.json');
        for (const school of data.schools) {
            const p = school.programmes.find(x => x.name === programme);
            if (p && p.years) return SEMESTERS[Math.min(p.years * 2, SEMESTERS.length) - 1];
        }
    } catch (e) { /* fall through */ }
    return SEMESTERS[SEMESTERS.length - 1];
}

async function contextFor(req) {
    const [[u]] = await pool.query('SELECT user_id, name, role, school FROM USERS WHERE user_id = ?', [req.user.id]);
    const ctx = { id: req.user.id, role: req.user.role, school: u ? u.school : null, scoped: false };
    if (ctx.role === 'head_of_department') ctx.scoped = true;
    if (ctx.role === 'lecturer' || ctx.role === 'class_teacher') {
        const [[l]] = await pool.query('SELECT school FROM LECTURERS WHERE user_id = ?', [req.user.id]);
        ctx.school = (l && l.school) || ctx.school;
        ctx.scoped = true;
    }
    return ctx;
}

async function getPeriod(id) {
    const [[p]] = await pool.query(
        `SELECT period_id, name, min_paid_pct, is_open, DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at
         FROM registration_periods WHERE period_id = ?`, [id]);
    return p || null;
}

// Registrations (with student, fees and signatures). Filter by period, student or registration id.
async function registrations({ periodId = null, studentId = null, regId = null, school = null, programme = null, q = null } = {}) {
    const where = ['1=1'];
    const params = [];
    if (periodId) { where.push('r.period_id = ?'); params.push(periodId); }
    if (studentId) { where.push('r.student_id = ?'); params.push(studentId); }
    if (regId) { where.push('r.reg_id = ?'); params.push(regId); }
    if (school) { where.push('s.school = ?'); params.push(school); }
    if (programme) { where.push('s.programme = ?'); params.push(programme); }
    if (q) { where.push('(u.name LIKE ? OR s.reg_no LIKE ? OR s.student_id = ?)'); params.push(`%${q}%`, `%${q}%`, Number(q) || 0); }
    const [rows] = await pool.query(
        `SELECT r.reg_id, r.period_id, rp.name AS period_name, rp.min_paid_pct, rp.is_open,
                r.semester, r.prev_semester, r.status,
                DATE_FORMAT(r.submitted_at, '%Y-%m-%d %H:%i') AS submitted_at,
                DATE_FORMAT(r.approved_at, '%Y-%m-%d %H:%i') AS approved_at,
                s.student_id, s.user_id, u.name, u.email, s.school, s.programme, s.reg_no, s.current_semester, s.hostel_resident, s.entry_type,
                (SELECT COALESCE(SUM(amount), 0) FROM fee_entries fe WHERE fe.student_id = s.student_id AND fe.entry_type = 'charge') AS charged,
                (SELECT COALESCE(SUM(amount), 0) FROM fee_entries fe WHERE fe.student_id = s.student_id AND fe.entry_type = 'payment') AS paid,
                ${ORDER.map(k => `r.${k}_status, r.${k}_by, DATE_FORMAT(r.${k}_at, '%Y-%m-%d %H:%i') AS ${k}_at, r.${k}_note`).join(',\n                ')}
         FROM semester_registrations r
         JOIN registration_periods rp ON rp.period_id = r.period_id
         JOIN students s ON s.student_id = r.student_id
         JOIN USERS u ON u.user_id = s.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY r.submitted_at DESC
         LIMIT 1000`, params);
    return rows;
}

async function officerNames(rows) {
    const ids = new Set();
    rows.forEach(r => ORDER.forEach(k => r[`${k}_by`] && ids.add(r[`${k}_by`])));
    if (!ids.size) return {};
    const [users] = await pool.query('SELECT user_id, name FROM USERS WHERE user_id IN (?)', [[...ids]]);
    return Object.fromEntries(users.map(u => [u.user_id, u.name]));
}

// Checklist for one registration. status: cleared | held | pending | waiting
function evaluate(row, names = {}) {
    const steps = {};
    const charged = Number(row.charged) || 0;
    const paid = Number(row.paid) || 0;
    const pct = charged > 0 ? Math.floor((paid / charged) * 100) : 100;
    const needed = Math.ceil((charged * row.min_paid_pct) / 100 - paid);
    ORDER.forEach(k => {
        const s = {
            key: k, label: STEPS[k].label,
            status: row[`${k}_status`] || 'pending',
            by: row[`${k}_by`] ? (names[row[`${k}_by`]] || 'Staff') : null,
            at: row[`${k}_at`] || null,
            note: row[`${k}_note`] || null
        };
        if (k === 'accounts') {
            Object.assign(s, { paid_pct: pct, required_pct: row.min_paid_pct, charged, paid, auto: !row.accounts_status });
            if (!row.accounts_status) {
                s.status = pct >= row.min_paid_pct ? 'cleared' : 'pending';
                s.detail = pct >= row.min_paid_pct
                    ? `Paid ${pct}% of fees (needs ${row.min_paid_pct}%)`
                    : `Paid ${pct}% of fees — needs ${row.min_paid_pct}%. Pay at least K${Math.max(needed, 0).toLocaleString('en-US')} more.`;
            } else {
                s.detail = row.accounts_status === 'cleared' ? 'Cleared by the Accounts office' : 'Held by the Accounts office';
            }
        }
        steps[k] = s;
    });
    // Strictly in order: a step waits until every earlier step is cleared
    ORDER.forEach((k, i) => {
        if (steps[k].status === 'pending' && !ORDER.slice(0, i).every(e => steps[e].status === 'cleared')) steps[k].status = 'waiting';
    });
    const approved = row.status === 'approved';
    return {
        steps,
        eligible: approved,
        outcome: approved
            ? { ok: true, label: `Semester ${row.semester} registered`, sub: (row.approved_at || '').slice(0, 10) }
            : { ok: false, label: `Registering for Semester ${row.semester}`, sub: '' }
    };
}

function canAct(ctx, stepKey, row, ev) {
    if (!STEPS[stepKey].roles.includes(ctx.role)) return false;
    if (ctx.scoped && (!ctx.school || ctx.school !== row.school)) return false;
    if (ev.eligible && stepKey !== 'academic') return false;        // locked once approved
    const i = ORDER.indexOf(stepKey);
    return ORDER.slice(0, i).every(k => ev.steps[k].status === 'cleared');
}

const publicStudent = r => ({
    student_id: r.student_id, reg_id: r.reg_id, name: r.name, email: r.email, school: r.school, programme: r.programme,
    reg_no: r.reg_no, current_semester: r.current_semester, hostel_resident: !!Number(r.hostel_resident), semester: r.semester,
    entry_type: r.entry_type || 'regular'
});

// =============================================================================================
// Registration windows (staff). Same shape as exam sessions so the shared clearance board works.
// =============================================================================================
router.get('/sessions', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT rp.period_id AS session_id, rp.name, rp.min_paid_pct, rp.is_open, DATE_FORMAT(rp.created_at, '%Y-%m-%d') AS created_at,
                    (SELECT COUNT(*) FROM semester_registrations r WHERE r.period_id = rp.period_id) AS registrations,
                    (SELECT COUNT(*) FROM semester_registrations r WHERE r.period_id = rp.period_id AND r.status = 'approved') AS approved
             FROM registration_periods rp ORDER BY rp.is_open DESC, rp.created_at DESC`);
        res.json({
            kind: 'registration',
            sessions: rows,
            can_manage: ROLES.EXAM_MANAGE.includes(req.user.role),
            can_edit_details: ROLES.EXAM_DETAILS.includes(req.user.role),
            can_mark_hostel: false,
            outcome_label: 'Registration',
            done_label: 'Registered',
            steps: ORDER.map(k => ({ key: k, label: STEPS[k].label, mine: STEPS[k].roles.includes(req.user.role) }))
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load registration windows.');
    }
});

router.post('/sessions', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const name = clean(req.body.name);
    const pct = Number(req.body.min_paid_pct ?? 40);
    if (!name || name.length > 120) return res.status(400).send('Enter a name, e.g. "January 2027 Registration".');
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return res.status(400).send('Minimum fees paid must be a whole number from 0 to 100.');
    try {
        const [r] = await pool.query('INSERT INTO registration_periods (name, min_paid_pct, created_by) VALUES (?, ?, ?)', [name, pct, req.user.id]);
        res.status(201).json({ session_id: r.insertId, message: 'Registration window opened. Students can now register.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to open the registration window.');
    }
});

router.put('/sessions/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const p = await getPeriod(req.params.id);
        if (!p) return res.status(404).send('Registration window not found.');
        const name = clean(req.body.name) || p.name;
        const pct = req.body.min_paid_pct === undefined ? p.min_paid_pct : Number(req.body.min_paid_pct);
        if (!Number.isInteger(pct) || pct < 0 || pct > 100) return res.status(400).send('Minimum fees paid must be a whole number from 0 to 100.');
        const isOpen = req.body.is_open === undefined ? p.is_open : (req.body.is_open ? 1 : 0);
        await pool.query('UPDATE registration_periods SET name = ?, min_paid_pct = ?, is_open = ? WHERE period_id = ?', [name, pct, isOpen, p.period_id]);
        res.send(isOpen ? 'Registration window updated.' : 'Registration window closed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update the registration window.');
    }
});

router.delete('/sessions/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const [[c]] = await pool.query('SELECT COUNT(*) AS n FROM semester_registrations WHERE period_id = ?', [req.params.id]);
        if (Number(c.n) > 0) return res.status(409).send('Students have already registered in this window. Close it instead of deleting it.');
        const [r] = await pool.query('DELETE FROM registration_periods WHERE period_id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).send('Registration window not found.');
        res.send('Registration window deleted.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete the registration window.');
    }
});

// Programmes that have registrations in a window (for the board's filter)
router.get('/sessions/:id/programmes', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT DISTINCT s.programme FROM semester_registrations r JOIN students s ON s.student_id = r.student_id
             WHERE r.period_id = ? AND s.programme IS NOT NULL ORDER BY s.programme`, [req.params.id]);
        res.json({ programmes: rows.map(r => r.programme) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load programmes.');
    }
});

// =============================================================================================
// Approval board
// =============================================================================================
router.get('/sessions/:id/clearances', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    try {
        const period = await getPeriod(req.params.id);
        if (!period) return res.status(404).send('Registration window not found.');
        const ctx = await contextFor(req);
        if (ctx.scoped && !ctx.school) return res.status(403).send('Your school has not been set yet. Ask the administrator to assign you to a school.');
        const rows = await registrations({
            periodId: period.period_id,
            school: ctx.scoped ? ctx.school : clean(req.query.school),
            programme: clean(req.query.programme),
            q: clean(req.query.q)
        });
        const names = await officerNames(rows);
        let students = rows.map(r => {
            const ev = evaluate(r, names);
            return { ...publicStudent(r), ...ev, actions: ORDER.filter(k => canAct(ctx, k, r, ev)) };
        });
        const f = req.query.filter;
        if (f === 'mine') students = students.filter(s => s.actions.some(k => ['pending', 'held'].includes(s.steps[k].status)));
        else if (f === 'eligible') students = students.filter(s => s.eligible);
        else if (f === 'pending') students = students.filter(s => !s.eligible);
        const approved = rows.filter(r => r.status === 'approved').length;
        res.json({
            session: { session_id: period.period_id, name: period.name, is_open: period.is_open, min_paid_pct: period.min_paid_pct },
            school: ctx.scoped ? ctx.school : null,
            summary: `Semester registration · Accounts clears students who have paid at least ${period.min_paid_pct}% of their fees · ` +
                     `${approved} of ${rows.length} registration${rows.length === 1 ? '' : 's'} approved` +
                     (ctx.scoped ? ` · ${ctx.school}` : '') + (period.is_open ? '' : ' · This window is closed.'),
            counts: { total: rows.length, eligible: approved },
            students
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load registrations.');
    }
});

// DECIDE a step { decision: cleared | held | reset, note }. :studentId is the student in this window.
router.put('/sessions/:id/clearances/:studentId/:step', verifyToken, checkRole(...BOARD_ROLES), async (req, res) => {
    const stepKey = req.params.step;
    const decision = req.body.decision;
    const note = clean(req.body.note);
    if (!STEPS[stepKey]) return res.status(400).send('Unknown approval step.');
    if (!['cleared', 'held', 'reset'].includes(decision)) return res.status(400).send('Choose clear, hold or reset.');
    if (decision === 'held' && !note) return res.status(400).send('Give the student a reason when holding their registration.');
    if (note && note.length > 300) return res.status(400).send('The note is too long (300 characters max).');
    try {
        const period = await getPeriod(req.params.id);
        if (!period) return res.status(404).send('Registration window not found.');
        if (!period.is_open) return res.status(409).send('This registration window is closed.');
        const ctx = await contextFor(req);
        const [row] = await registrations({ periodId: period.period_id, studentId: Number(req.params.studentId) || -1 });
        if (!row) return res.status(404).send('This student has not registered in this window.');
        const ev = evaluate(row);
        if (!canAct(ctx, stepKey, row, ev)) {
            if (!STEPS[stepKey].roles.includes(ctx.role)) return res.status(403).send(`Only the ${STEPS[stepKey].label} can sign this step.`);
            if (ctx.scoped && ctx.school !== row.school) return res.status(403).send('This student is not in your school.');
            if (ev.eligible) return res.status(409).send('This registration has already been approved.');
            return res.status(409).send('Earlier approval steps must be completed first.');
        }

        const status = decision === 'reset' ? null : decision;
        await pool.query(
            `UPDATE semester_registrations SET ${stepKey}_status = ?, ${stepKey}_by = ?, ${stepKey}_at = ${status ? 'NOW()' : 'NULL'}, ${stepKey}_note = ?
             WHERE reg_id = ?`, [status, status ? ctx.id : null, note, row.reg_id]);

        // Holding or undoing a step sends every later step back to the queue
        if (decision !== 'cleared') {
            const later = ORDER.slice(ORDER.indexOf(stepKey) + 1);
            if (later.length) {
                await pool.query(
                    `UPDATE semester_registrations SET ${later.map(k => `${k}_status = NULL, ${k}_by = NULL, ${k}_at = NULL`).join(', ')}
                     WHERE reg_id = ?`, [row.reg_id]);
            }
        }

        let message = `${STEPS[stepKey].label}: ${decision === 'cleared' ? 'cleared' : decision === 'held' ? 'on hold' : 'reset'}.`;
        if (stepKey === 'academic' && decision === 'cleared') {
            // Registration complete: the student moves to this semester
            await pool.query("UPDATE semester_registrations SET status = 'approved', approved_at = NOW(), prev_semester = ? WHERE reg_id = ?",
                [row.current_semester, row.reg_id]);
            await pool.query('UPDATE students SET current_semester = ? WHERE student_id = ?', [row.semester, row.student_id]);
            notify([row.user_id], {
                category: 'account',
                title: `You are registered for Semester ${row.semester}`,
                body: `${period.name}: your registration has been approved by all offices.`,
                link: 'tab-registration'
            });
            message = `Approved. ${row.name} is now registered for Semester ${row.semester}.`;
        } else if (stepKey === 'academic' && row.status === 'approved') {
            // Revoking an approved registration puts the student back in their previous semester
            await pool.query("UPDATE semester_registrations SET status = 'pending', approved_at = NULL WHERE reg_id = ?", [row.reg_id]);
            await pool.query('UPDATE students SET current_semester = ? WHERE student_id = ?', [row.prev_semester || row.current_semester, row.student_id]);
            message = `Registration revoked. ${row.name} is back in Semester ${row.prev_semester || row.current_semester}.`;
        }
        if (decision === 'held') {
            notify([row.user_id], {
                category: 'account',
                title: `${STEPS[stepKey].label}: registration on hold`,
                body: `${period.name}: ${note}`,
                link: 'tab-registration'
            });
        }
        res.json({ message });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to save the approval.');
    }
});

// =============================================================================================
// Direct entry / exemptions (Registrar, Dean (Academic), Administrator)
// =============================================================================================

// After exemptions change: a student who has never had a registration approved is moved to the
// first semester they are not exempted from (direct entry), or back to Semester I.
async function placeStudent(studentId) {
    if ((await approvedCount(studentId)) > 0) return null;
    const { set } = await exemptionsFor(studentId);
    const start = firstOpen('I', set) || 'I';
    await pool.query('UPDATE students SET current_semester = ?, entry_type = ? WHERE student_id = ?',
        [start, set.size ? 'direct' : 'regular', studentId]);
    return start;
}

// FIND students to exempt (?q=name, register no or student ID)
router.get('/students', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const q = clean(req.query.q);
    if (!q || q.length < 2) return res.json({ students: [] });
    try {
        const [rows] = await pool.query(
            `SELECT s.student_id, u.name, s.reg_no, s.school, s.programme, s.current_semester, s.entry_type
             FROM students s JOIN USERS u ON u.user_id = s.user_id
             WHERE u.name LIKE ? OR s.reg_no LIKE ? OR s.student_id = ?
             ORDER BY u.name LIMIT 20`, [`%${q}%`, `%${q}%`, Number(q) || 0]);
        for (const r of rows) {
            r.exemptions = (await exemptionsFor(r.student_id)).list;
            r.final_semester = maxSemesterFor(r.programme);
        }
        res.json({ semesters: SEMESTERS, students: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to search students.');
    }
});

// GRANT an exemption { from_semester, to_semester, reason }
router.post('/students/:id/exemptions', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    const from = clean(req.body.from_semester);
    const to = clean(req.body.to_semester) || from;
    const reason = clean(req.body.reason);
    if (!SEMESTERS.includes(from) || !SEMESTERS.includes(to)) return res.status(400).send('Choose the semesters to exempt.');
    if (semIndex(from) > semIndex(to)) return res.status(400).send('The first exempted semester must come before the last one.');
    if (!reason || reason.length > 300) return res.status(400).send('Give the reason for the exemption, e.g. "Direct entry — holds a Diploma in Computer Science".');
    try {
        const [[st]] = await pool.query(
            'SELECT s.student_id, s.user_id, s.programme, u.name FROM students s JOIN USERS u ON u.user_id = s.user_id WHERE s.student_id = ?',
            [req.params.id]);
        if (!st) return res.status(404).send('Student not found.');
        const max = maxSemesterFor(st.programme);
        if (semIndex(to) >= semIndex(max)) return res.status(400).send(`A student can't be exempted up to their final semester (${max}).`);
        const range = SEMESTERS.slice(semIndex(from), semIndex(to) + 1);
        const { set } = await exemptionsFor(st.student_id);
        const overlap = range.filter(x => set.has(x));
        if (overlap.length) return res.status(409).send(`Semester ${overlap.join(', ')} is already exempted.`);
        const [done] = await pool.query(
            "SELECT semester FROM semester_registrations WHERE student_id = ? AND status = 'approved' AND semester IN (?)", [st.student_id, range]);
        if (done.length) return res.status(409).send(`${st.name} has already registered for Semester ${done.map(d => d.semester).join(', ')}.`);

        await pool.query('INSERT INTO student_exemptions (student_id, from_semester, to_semester, reason, granted_by) VALUES (?, ?, ?, ?, ?)',
            [st.student_id, from, to, reason, req.user.id]);
        await pool.query("UPDATE students SET entry_type = 'direct' WHERE student_id = ?", [st.student_id]);
        const start = await placeStudent(st.student_id);
        const label = from === to ? `Semester ${from}` : `Semesters ${from}–${to}`;
        notify([st.user_id], {
            category: 'account',
            title: `Exempted from ${label}`,
            body: `${reason}${start ? ` You start in Semester ${start}.` : ''}`,
            link: 'tab-registration'
        });
        res.status(201).send(`${st.name} is exempted from ${label}.${start ? ` They start in Semester ${start}.` : ''}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to save the exemption.');
    }
});

// REMOVE an exemption
router.delete('/exemptions/:id', verifyToken, checkRole(...ROLES.EXAM_MANAGE), async (req, res) => {
    try {
        const [[e]] = await pool.query('SELECT student_id FROM student_exemptions WHERE exemption_id = ?', [req.params.id]);
        if (!e) return res.status(404).send('Exemption not found.');
        await pool.query('DELETE FROM student_exemptions WHERE exemption_id = ?', [req.params.id]);
        const { set } = await exemptionsFor(e.student_id);
        if (!set.size) await pool.query("UPDATE students SET entry_type = 'regular' WHERE student_id = ?", [e.student_id]);
        const start = await placeStudent(e.student_id);
        res.send(`Exemption removed.${start ? ` The student now starts in Semester ${start}.` : ''}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove the exemption.');
    }
});

// =============================================================================================
// Student — register, and my registration history
// =============================================================================================
async function myStudent(userId) {
    const [[s]] = await pool.query('SELECT student_id, programme, current_semester, entry_type FROM students WHERE user_id = ?', [userId]);
    return s || null;
}

// Which semester the student registers for next (skipping exempted semesters):
//   - never registered before -> their current semester (Semester I for a new student,
//                                e.g. Semester III for a direct-entry student exempted from I–II)
//   - otherwise               -> the semester after their current one
async function approvedCount(studentId) {
    const [[a]] = await pool.query("SELECT COUNT(*) AS n FROM semester_registrations WHERE student_id = ? AND status = 'approved'", [studentId]);
    return Number(a.n);
}
async function targetSemester(me, exempt = null) {
    exempt = exempt || (await exemptionsFor(me.student_id)).set;
    const current = me.current_semester || 'I';
    if ((await approvedCount(me.student_id)) > 0) {
        const next = nextSemester(current);
        return next ? firstOpen(next, exempt) : null;
    }
    return firstOpen(current, exempt);
}

router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const me = await myStudent(req.user.id);
        if (!me) return res.status(404).send('No student record is linked to your account.');
        const rows = await registrations({ studentId: me.student_id });
        const names = await officerNames(rows);
        const history = rows.map(r => ({
            reg_id: r.reg_id, period_id: r.period_id, period_name: r.period_name, semester: r.semester, status: r.status,
            submitted_at: r.submitted_at, approved_at: r.approved_at, is_open: !!r.is_open, ...evaluate(r, names)
        }));
        const registeredIn = new Set(rows.map(r => r.period_id));
        const [open] = await pool.query('SELECT period_id, name, min_paid_pct FROM registration_periods WHERE is_open = 1 ORDER BY created_at DESC');
        const exemptions = await exemptionsFor(me.student_id);
        const next = await targetSemester(me, exemptions.set);
        const max = maxSemesterFor(me.programme);
        const inProgress = rows.some(r => r.status !== 'approved' && r.is_open);
        res.json({
            programme: me.programme,
            current_semester: me.current_semester || 'I',
            next_semester: next && SEMESTERS.indexOf(next) <= SEMESTERS.indexOf(max) ? next : null,
            final_semester: max,
            in_progress: inProgress,
            open_periods: open.filter(p => !registeredIn.has(p.period_id)),
            entry_type: me.entry_type || 'regular',
            exemptions: exemptions.list,
            history
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load your registration.');
    }
});

// REGISTER for the next semester in an open window { period_id }
router.post('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const me = await myStudent(req.user.id);
        if (!me) return res.status(404).send('No student record is linked to your account.');
        if (!me.programme) return res.status(400).send('Your programme has not been recorded yet. Please contact the registry.');
        const period = await getPeriod(Number(req.body.period_id) || -1);
        if (!period || !period.is_open) return res.status(400).send('Registration is not open for that window.');
        const [pending] = await pool.query(
            `SELECT r.reg_id FROM semester_registrations r JOIN registration_periods rp ON rp.period_id = r.period_id
             WHERE r.student_id = ? AND r.status <> 'approved' AND rp.is_open = 1`, [me.student_id]);
        if (pending.length) return res.status(409).send('You already have a registration waiting for approval.');
        const [dupe] = await pool.query('SELECT 1 FROM semester_registrations WHERE period_id = ? AND student_id = ?', [period.period_id, me.student_id]);
        if (dupe.length) return res.status(409).send('You have already registered in this window.');
        const semester = await targetSemester(me);
        const max = maxSemesterFor(me.programme);
        if (!semester || SEMESTERS.indexOf(semester) > SEMESTERS.indexOf(max)) {
            return res.status(400).send(`You have completed all ${SEMESTERS.indexOf(max) + 1} semesters of your programme.`);
        }
        await pool.query('INSERT INTO semester_registrations (period_id, student_id, semester) VALUES (?, ?, ?)',
            [period.period_id, me.student_id, semester]);
        res.status(201).send(`Registered for Semester ${semester}. Your registration now goes to the Accounts office, Class Advisor, Head of Department, Dean of Students and Dean (Academic).`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to register.');
    }
});

// WITHDRAW a registration nobody has signed yet
router.delete('/mine/:regId', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const me = await myStudent(req.user.id);
        if (!me) return res.status(404).send('No student record is linked to your account.');
        const [[r]] = await pool.query('SELECT * FROM semester_registrations WHERE reg_id = ? AND student_id = ?', [req.params.regId, me.student_id]);
        if (!r) return res.status(404).send('Registration not found.');
        if (r.status === 'approved' || ORDER.some(k => r[`${k}_by`])) return res.status(409).send('Staff have already started approving this registration, so it can\'t be withdrawn.');
        await pool.query('DELETE FROM semester_registrations WHERE reg_id = ?', [r.reg_id]);
        res.send('Registration withdrawn.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to withdraw the registration.');
    }
});

module.exports = router;
