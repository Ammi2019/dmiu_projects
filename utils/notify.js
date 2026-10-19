// Creating notifications. Every feature that needs to tell someone something calls these.
// Notifications are best-effort: a failure here is logged but never breaks the action that caused it.
const pool = require('../db');

// notify([userId, ...], { category, title, body, link })
//   category: assignment | notes | results | fees | account | announcement | reminder | exams
//   link:     the dashboard tab to open when clicked, e.g. 'tab-fees'
async function notify(userIds, { category, title, body = null, link = null }) {
    const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
    if (ids.length === 0) return 0;
    try {
        // Insert in batches so a whole school doesn't become one huge query
        for (let i = 0; i < ids.length; i += 500) {
            const batch = ids.slice(i, i + 500);
            await pool.query(
                'INSERT INTO notifications (user_id, category, title, body, link) VALUES ?',
                [batch.map(id => [id, category, String(title).slice(0, 200), body ? String(body).slice(0, 1500) : null, link])]
            );
        }
        return ids.length;
    } catch (err) {
        console.error('Could not create notifications:', err.message);
        return 0;
    }
}

// User IDs of students in a school, optionally one programme (programme null = all in the school)
async function studentUserIds(school, programme = null) {
    const [rows] = await pool.query(
        'SELECT user_id FROM students WHERE school = ? AND (? IS NULL OR programme = ?)',
        [school, programme, programme]
    );
    return rows.map(r => r.user_id);
}

// User ID for a student_id
async function userIdForStudent(studentId) {
    const [rows] = await pool.query('SELECT user_id FROM students WHERE student_id = ?', [studentId]);
    return rows.length ? rows[0].user_id : null;
}

// Everyone an announcement should reach
//   audience: everyone | students | lecturers | staff ; school / programme narrow it down
async function audienceUserIds({ audience, school = null, programme = null }) {
    const STAFF = ['administrator', 'principal', 'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk', 'head_of_department'];
    const ids = new Set();

    if (audience === 'students' || audience === 'everyone') {
        const [rows] = await pool.query(
            `SELECT s.user_id FROM students s JOIN USERS u ON u.user_id = s.user_id
             WHERE u.status = 'approved' AND (? IS NULL OR s.school = ?) AND (? IS NULL OR s.programme = ?)`,
            [school, school, programme, programme]
        );
        rows.forEach(r => ids.add(r.user_id));
    }
    // Lecturers / staff are never narrowed by programme, only by school
    if (audience === 'lecturers' || audience === 'everyone') {
        const [rows] = await pool.query(
            `SELECT L.user_id FROM LECTURERS L JOIN USERS u ON u.user_id = L.user_id
             WHERE u.status = 'approved' AND (? IS NULL OR L.school = ?)`,
            [school, school]
        );
        rows.forEach(r => ids.add(r.user_id));
    }
    if (audience === 'staff' || audience === 'everyone') {
        const [rows] = await pool.query(
            `SELECT user_id FROM USERS WHERE status = 'approved' AND role IN (?)
             AND (? IS NULL OR school IS NULL OR school = ?)`,
            [STAFF, school, school]
        );
        rows.forEach(r => ids.add(r.user_id));
    }
    return [...ids];
}

module.exports = { notify, studentUserIds, userIdForStudent, audienceUserIds };
