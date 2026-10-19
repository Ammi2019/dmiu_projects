// Fee payment reminders.
//
// A student is "below the acceptable amount" when they owe money AND have paid less than
// min_paid_pct % of everything billed to them (set by the Accountant; default 50%).
//
// Automatic reminders (checked every few hours by the server):
//   - "end"   : within lead_days BEFORE a semester's end date
//   - "start" : within lead_days BEFORE a semester's start date
// Each student gets each reminder at most once per semester (logged in fee_reminders_sent).
const pool = require('../db');
const { notify } = require('./notify');

const money = n => 'K' + (Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function getSettings() {
    const [[s]] = await pool.query('SELECT enabled, min_paid_pct, lead_days FROM fee_reminder_settings WHERE id = 1');
    return s ? { enabled: Boolean(s.enabled), min_paid_pct: Number(s.min_paid_pct), lead_days: Number(s.lead_days) }
             : { enabled: true, min_paid_pct: 50, lead_days: 14 };
}

// Students currently below the acceptable amount
async function studentsBelowThreshold(minPaidPct) {
    const [rows] = await pool.query(
        `SELECT s.student_id, s.user_id, u.name,
                COALESCE(SUM(CASE WHEN fe.entry_type = 'charge' THEN fe.amount END), 0) AS billed,
                COALESCE(SUM(CASE WHEN fe.entry_type = 'payment' THEN fe.amount END), 0) AS paid
         FROM students s
         JOIN USERS u ON u.user_id = s.user_id
         JOIN fee_entries fe ON fe.student_id = s.student_id
         WHERE u.status = 'approved'
         GROUP BY s.student_id, s.user_id, u.name`
    );
    return rows
        .map(r => {
            const billed = Number(r.billed), paid = Number(r.paid);
            const required = (billed * minPaidPct) / 100;
            return { ...r, billed, paid, balance: billed - paid, required, short: Math.max(required - paid, 0) };
        })
        .filter(r => r.balance > 0 && r.paid < r.required);
}

function messageFor(student, settings, context) {
    const lines = [
        `Your fee balance is ${money(student.balance)} (billed ${money(student.billed)}, paid ${money(student.paid)}).`,
        `Students should have paid at least ${settings.min_paid_pct}% of their fees. Please pay at least ${money(student.short)} more to reach this.`
    ];
    if (context) lines.unshift(context);
    lines.push('After paying, upload your receipt in the Fees tab so the Accounts office can update your balance.');
    return lines.join(' ');
}

// Automatic run. Returns a summary of what was sent.
async function runScheduledReminders() {
    const settings = await getSettings();
    if (!settings.enabled) return { sent: 0, skipped: 'Reminders are switched off.' };

    const today = localDate(new Date());
    const [semesters] = await pool.query(
        `SELECT semester_id, name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
                DATEDIFF(start_date, ?) AS days_to_start, DATEDIFF(end_date, ?) AS days_to_end
         FROM semesters`,
        [today, today]
    );

    const due = [];
    for (const s of semesters) {
        if (s.days_to_end >= 0 && s.days_to_end <= settings.lead_days) due.push({ ...s, kind: 'end' });
        if (s.days_to_start > 0 && s.days_to_start <= settings.lead_days) due.push({ ...s, kind: 'start' });
    }
    if (due.length === 0) return { sent: 0 };

    const students = await studentsBelowThreshold(settings.min_paid_pct);
    let sent = 0;
    for (const event of due) {
        const [already] = await pool.query(
            'SELECT student_id FROM fee_reminders_sent WHERE semester_id = ? AND kind = ?', [event.semester_id, event.kind]);
        const done = new Set(already.map(r => r.student_id));
        const when = event.kind === 'end'
            ? `${event.name} ends on ${event.end_date} (${event.days_to_end === 0 ? 'today' : `in ${event.days_to_end} day${event.days_to_end === 1 ? '' : 's'}`}).`
            : `${event.name} begins on ${event.start_date} (in ${event.days_to_start} day${event.days_to_start === 1 ? '' : 's'}).`;

        for (const st of students) {
            if (done.has(st.student_id)) continue;
            await notify([st.user_id], {
                category: 'reminder',
                title: event.kind === 'end' ? `Fee reminder: ${event.name} is ending` : `Fee reminder: ${event.name} is starting`,
                body: messageFor(st, settings, when),
                link: 'tab-fees'
            });
            await pool.query('INSERT IGNORE INTO fee_reminders_sent (student_id, semester_id, kind) VALUES (?, ?, ?)',
                [st.student_id, event.semester_id, event.kind]);
            sent++;
        }
    }
    if (sent) console.log(`Fee reminders: sent ${sent}.`);
    return { sent };
}

// "Send reminders now" from the Accountant — every student below the acceptable amount
async function sendRemindersNow() {
    const settings = await getSettings();
    const students = await studentsBelowThreshold(settings.min_paid_pct);
    for (const st of students) {
        await notify([st.user_id], {
            category: 'reminder',
            title: 'Fee payment reminder',
            body: messageFor(st, settings, null),
            link: 'tab-fees'
        });
    }
    return { sent: students.length };
}

// Runs once shortly after start-up, then every 6 hours
function startReminderSchedule() {
    const run = () => runScheduledReminders().catch(err => console.error('Fee reminder check failed:', err.message));
    setTimeout(run, 30 * 1000);
    setInterval(run, 6 * 60 * 60 * 1000);
}

module.exports = { getSettings, studentsBelowThreshold, runScheduledReminders, sendRemindersNow, startReminderSchedule };
