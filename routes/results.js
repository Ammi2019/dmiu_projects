// Results: lecturers record Assignment 1, Assignment 2, Mid-semester and End-semester marks
// per course; students see the parts the lecturer has published.
//
// Weights, pass mark and grade scale live in data/results-config.json.
const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { findSchool } = require('./programmes');
const { notify, studentUserIds } = require('../utils/notify');

const router = express.Router();
const LECTURER_ROLES = ['lecturer', 'class_teacher'];
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'results-config.json');

function loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// ---------- calculation (same rules as public/js/results-calc.js) ----------
// marks: { a1: 72, mid: 60, ... } — only the components to include
function computeResult(marks, config) {
    const round1 = n => Math.round(n * 10) / 10;
    let ca = 0, caMax = 0, exam = 0, examMax = 0, complete = true;

    for (const c of config.components) {
        const has = marks[c.key] !== undefined && marks[c.key] !== null;
        if (!has) complete = false;
        const contribution = has ? (Number(marks[c.key]) * c.weight) / 100 : 0;
        if (c.ca) { ca += contribution; caMax += c.weight; }
        else { exam += contribution; examMax += c.weight; }
    }

    const result = { ca: round1(ca), caMax, exam: round1(exam), examMax, complete, total: null, grade: null, remark: null, passed: null };
    if (complete) {
        result.total = round1(ca + exam);
        const band = config.grades.find(g => result.total >= g.min) || config.grades[config.grades.length - 1];
        result.grade = band.grade;
        result.remark = band.remark;
        result.passed = result.total >= config.passMark;
    }
    return result;
}

// ---------- helpers ----------
async function getLecturer(userId) {
    const [rows] = await pool.query('SELECT lecturer_id, school FROM LECTURERS WHERE user_id = ?', [userId]);
    return rows[0] || null;
}

async function getStudent(userId) {
    const [rows] = await pool.query('SELECT student_id, school, programme FROM students WHERE user_id = ?', [userId]);
    return rows[0] || null;
}

async function getMySheet(sheetId, lecturerId) {
    const [rows] = await pool.query(
        'SELECT * FROM result_sheets WHERE sheet_id = ? AND lecturer_id = ?',
        [sheetId, lecturerId]
    );
    return rows[0] || null;
}

const publishedList = sheet => (sheet.published || '').split(',').filter(Boolean);

// Students a sheet covers: same school, and same programme unless the sheet is for all programmes
async function studentsForSheet(sheet) {
    const [rows] = await pool.query(
        `SELECT st.student_id, u.name, u.email, st.programme
         FROM students st JOIN USERS u ON st.user_id = u.user_id
         WHERE st.school = ? AND (? IS NULL OR st.programme = ?)
         ORDER BY u.name`,
        [sheet.school, sheet.programme, sheet.programme]
    );
    return rows;
}

// Settings (weights, grade scale) — any logged-in user
router.get('/config', verifyToken, (req, res) => {
    try {
        const { components, passMark, grades } = loadConfig();
        res.json({ components, passMark, grades });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load results settings.');
    }
});

// =====================================================================
// Lecturer routes
// =====================================================================

// GET my result sheets
router.get('/sheets', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');

        const [rows] = await pool.query(
            `SELECT rs.sheet_id, rs.school, rs.programme, rs.course_name, rs.period, rs.published,
                    (SELECT COUNT(DISTINCT rm.student_id) FROM result_marks rm WHERE rm.sheet_id = rs.sheet_id) AS students_with_marks,
                    (SELECT COUNT(*) FROM students st
                      WHERE st.school = rs.school AND (rs.programme IS NULL OR st.programme = rs.programme)) AS student_count
             FROM result_sheets rs
             WHERE rs.lecturer_id = ?
             ORDER BY rs.created_at DESC`,
            [lecturer.lecturer_id]
        );
        res.json({ school: lecturer.school, sheets: rows.map(r => ({ ...r, published: publishedList(r) })) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch result sheets.');
    }
});

// CREATE a result sheet for a course
router.post('/sheets', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    const courseName = (req.body.course_name || '').trim();
    const period = (req.body.period || '').trim();
    const programme = (req.body.programme || '').trim() || null;

    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        if (!lecturer.school) return res.status(403).send('Choose your school in My Profile before recording results.');

        const school = findSchool(lecturer.school);
        if (!school) return res.status(400).send('Your school is not recognised. Contact the administrator.');
        if (!courseName || courseName.length > 150) return res.status(400).send('Enter the course or module name.');
        if (!period || period.length > 40) return res.status(400).send('Enter the semester, e.g. "2026 Semester 1".');
        if (programme && !school.programmes.some(p => p.name === programme)) {
            return res.status(403).send(`You can only record results for programmes in the ${lecturer.school}.`);
        }

        const [dupes] = await pool.query(
            `SELECT sheet_id FROM result_sheets
             WHERE lecturer_id = ? AND course_name = ? AND period = ? AND programme <=> ?`,
            [lecturer.lecturer_id, courseName, period, programme]
        );
        if (dupes.length) return res.status(409).send('You already have a result sheet for this course, programme and semester.');

        const [result] = await pool.query(
            'INSERT INTO result_sheets (lecturer_id, school, programme, course_name, period) VALUES (?, ?, ?, ?, ?)',
            [lecturer.lecturer_id, lecturer.school, programme, courseName, period]
        );
        res.status(201).json({ sheet_id: result.insertId, message: 'Result sheet created.' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create result sheet.');
    }
});

// GET one sheet with every student and their marks
router.get('/sheets/:id', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const sheet = await getMySheet(req.params.id, lecturer.lecturer_id);
        if (!sheet) return res.status(404).send('Result sheet not found.');

        const config = loadConfig();
        const students = await studentsForSheet(sheet);
        const [marks] = await pool.query('SELECT student_id, component, mark FROM result_marks WHERE sheet_id = ?', [sheet.sheet_id]);

        const byStudent = {};
        marks.forEach(m => { (byStudent[m.student_id] = byStudent[m.student_id] || {})[m.component] = Number(m.mark); });

        res.json({
            sheet: { ...sheet, published: publishedList(sheet) },
            students: students.map(s => {
                const studentMarks = byStudent[s.student_id] || {};
                return { ...s, marks: studentMarks, result: computeResult(studentMarks, config) };
            })
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch result sheet.');
    }
});

// SAVE marks: { marks: [{ student_id, component, mark }] } — mark null/'' clears it
router.put('/sheets/:id/marks', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    const entries = Array.isArray(req.body.marks) ? req.body.marks : [];
    if (entries.length === 0) return res.status(400).send('No marks to save.');
    if (entries.length > 5000) return res.status(400).send('Too many marks in one save.');

    let connection;
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const sheet = await getMySheet(req.params.id, lecturer.lecturer_id);
        if (!sheet) return res.status(404).send('Result sheet not found.');

        const validComponents = new Set(loadConfig().components.map(c => c.key));
        const validStudents = new Set((await studentsForSheet(sheet)).map(s => s.student_id));

        for (const e of entries) {
            if (!validComponents.has(e.component)) return res.status(400).send(`Unknown component "${e.component}".`);
            if (!validStudents.has(Number(e.student_id))) return res.status(400).send('One of the students is not on this sheet.');
            if (e.mark !== null && e.mark !== '' && e.mark !== undefined) {
                const n = Number(e.mark);
                if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).send('Marks must be between 0 and 100.');
            }
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        for (const e of entries) {
            if (e.mark === null || e.mark === '' || e.mark === undefined) {
                await connection.query(
                    'DELETE FROM result_marks WHERE sheet_id = ? AND student_id = ? AND component = ?',
                    [sheet.sheet_id, e.student_id, e.component]
                );
            } else {
                await connection.query(
                    `INSERT INTO result_marks (sheet_id, student_id, component, mark) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE mark = VALUES(mark)`,
                    [sheet.sheet_id, e.student_id, e.component, Math.round(Number(e.mark) * 100) / 100]
                );
            }
        }
        await connection.commit();
        res.send(`Saved ${entries.length} mark${entries.length === 1 ? '' : 's'}.`);
    } catch (err) {
        if (connection) await connection.rollback().catch(() => {});
        console.error(err);
        res.status(500).send('Failed to save marks.');
    } finally {
        if (connection) connection.release();
    }
});

// PUBLISH / UNPUBLISH one component: { component: 'mid', published: true }
router.put('/sheets/:id/publish', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    const { component } = req.body;
    const publish = Boolean(req.body.published);

    try {
        const config = loadConfig();
        const comp = config.components.find(c => c.key === component);
        if (!comp) return res.status(400).send('Unknown component.');

        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const sheet = await getMySheet(req.params.id, lecturer.lecturer_id);
        if (!sheet) return res.status(404).send('Result sheet not found.');

        const current = new Set(publishedList(sheet));
        if (publish) current.add(component); else current.delete(component);
        // keep the stored order the same as the config
        const stored = config.components.map(c => c.key).filter(k => current.has(k)).join(',');

        await pool.query('UPDATE result_sheets SET published = ? WHERE sheet_id = ?', [stored, sheet.sheet_id]);
        if (publish && !publishedList(sheet).includes(component)) {
            notify(await studentUserIds(sheet.school, sheet.programme), {
                category: 'results',
                title: `Results released: ${sheet.course_name} — ${comp.label}`,
                body: `${sheet.period}. See your Results tab.`,
                link: 'tab-results'
            });
        }
        res.send(publish ? `${comp.label} marks are now visible to students.` : `${comp.label} marks are hidden from students.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update publishing.');
    }
});

// DELETE a sheet and its marks
router.delete('/sheets/:id', verifyToken, checkRole(...LECTURER_ROLES), async (req, res) => {
    try {
        const lecturer = await getLecturer(req.user.id);
        if (!lecturer) return res.status(404).send('No lecturer record is linked to your account.');
        const sheet = await getMySheet(req.params.id, lecturer.lecturer_id);
        if (!sheet) return res.status(404).send('Result sheet not found.');

        await pool.query('DELETE FROM result_marks WHERE sheet_id = ?', [sheet.sheet_id]);
        await pool.query('DELETE FROM result_sheets WHERE sheet_id = ?', [sheet.sheet_id]);
        res.send('Result sheet deleted.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete result sheet.');
    }
});

// =====================================================================
// Student route — only published components are ever sent
// =====================================================================
router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const student = await getStudent(req.user.id);
        if (!student) return res.status(404).send('No student record is linked to your account.');
        const config = loadConfig();
        const { components, passMark, grades } = config;
        if (!student.school) return res.json({ config: { components, passMark, grades }, courses: [] });

        const [sheets] = await pool.query(
            `SELECT rs.sheet_id, rs.course_name, rs.period, rs.programme, rs.published, u.name AS lecturer_name
             FROM result_sheets rs
             JOIN LECTURERS l ON rs.lecturer_id = l.lecturer_id
             JOIN USERS u ON l.user_id = u.user_id
             WHERE rs.school = ? AND (rs.programme IS NULL OR rs.programme = ?) AND rs.published <> ''
             ORDER BY rs.period DESC, rs.course_name`,
            [student.school, student.programme]
        );

        const courses = [];
        for (const sheet of sheets) {
            const published = publishedList(sheet);
            const [rows] = await pool.query(
                'SELECT component, mark FROM result_marks WHERE sheet_id = ? AND student_id = ?',
                [sheet.sheet_id, student.student_id]
            );
            const marks = {};
            rows.forEach(r => { if (published.includes(r.component)) marks[r.component] = Number(r.mark); });

            courses.push({
                course_name: sheet.course_name,
                period: sheet.period,
                lecturer_name: sheet.lecturer_name,
                published,
                marks,
                // A final result only appears once every component is published and marked
                result: computeResult(marks, config)
            });
        }
        res.json({ config: { components, passMark, grades }, courses });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your results.');
    }
});

module.exports = router;
module.exports.computeResult = computeResult;
