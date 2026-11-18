// Fees charged when a student registers for a semester.
//
// Registering for a semester puts these charges on the student's fee statement:
//   - Tuition for that semester (the programme's fee, which is per semester)
//   - Annual fees, once per year of study (billed with the first semester registered in that year)
//   - Admission fees, once, with the student's first registration
// Payments are then deducted from these charges, so the balance shows what the student still owes.
//
// Each charge is billed only once per student (matched by its description), so running this again,
// or the Accounts office using "Bill students" for the same item, never double-charges anyone.
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { feeStatus } = require('./feeClearance');

const SEMESTERS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const PROGRAMMES_FILE = path.join(__dirname, '..', 'data', 'programmes.json');
const money = v => Math.round(Number(v) * 100) / 100;

function feeData() {
    const data = JSON.parse(fs.readFileSync(PROGRAMMES_FILE, 'utf8'));
    const tuition = {};
    data.schools.forEach(s => s.programmes.forEach(p => { tuition[p.name] = p.fee; }));
    return {
        tuition,
        annual: data.annualFees.reduce((t, f) => t + f.amount, 0),
        admission: data.admissionFees.reduce((t, f) => t + f.ug, 0)   // all programmes are undergraduate
    };
}

// Year of study for a semester: I–II = Year 1, III–IV = Year 2, ...
const yearOf = semester => Math.floor(SEMESTERS.indexOf(semester) / 2) + 1;

// The charges a semester registration brings, before checking what is already billed
function chargesFor(programme, semester) {
    const f = feeData();
    const items = [];
    if (f.tuition[programme]) items.push({ kind: 'tuition', description: `Tuition — Semester ${semester}`, amount: f.tuition[programme] });
    items.push({ kind: 'annual', description: `Annual fees — Year ${yearOf(semester)}`, amount: f.annual });
    items.push({ kind: 'admission', description: 'Admission fees (once off)', amount: f.admission });
    return items;
}

// Charges for this semester the student has NOT been billed yet. `db` is the pool or a transaction connection.
async function newChargesFor(db, studentId, programme, semester) {
    const items = chargesFor(programme, semester);
    const [have] = await db.query(
        "SELECT description FROM fee_entries WHERE student_id = ? AND entry_type = 'charge' AND description IN (?)",
        [studentId, items.map(i => i.description)]);
    const billed = new Set(have.map(r => r.description));
    return items.filter(i => !billed.has(i.description));
}

// What registering would add, plus the student's current totals (for the "before you register" summary)
async function previewFor(studentId, programme, semester, minPaidPct) {
    const items = await newChargesFor(pool, studentId, programme, semester);
    const [[t]] = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'charge' THEN amount END), 0) AS charged,
                COALESCE(SUM(CASE WHEN entry_type = 'payment' THEN amount END), 0) AS paid
         FROM fee_entries WHERE student_id = ?`, [studentId]);
    const newTotal = money(items.reduce((s, i) => s + i.amount, 0));
    const charged = money(Number(t.charged) + newTotal);
    const paid = money(t.paid);
    // Earlier semesters in full + min % of this semester's new fees
    const fee = feeStatus({ charged, paid, semesterCharged: newTotal, minPct: minPaidPct });
    return { items, new_total: newTotal, charged_after: charged, paid, balance_after: money(charged - paid), min_paid_pct: minPaidPct,
             min_to_pay: fee.needed, arrears: fee.arrears };
}

// Bill a registration. Returns the charges added. Safe to call more than once.
async function billRegistration(db, { regId, studentId, programme, semester, recordedBy = null }) {
    const items = await newChargesFor(db, studentId, programme, semester);
    for (const i of items) {
        await db.query(
            `INSERT INTO fee_entries (student_id, entry_type, description, amount, entry_date, recorded_by, reg_id)
             VALUES (?, 'charge', ?, ?, CURRENT_DATE, ?, ?)`,
            [studentId, i.description, i.amount, recordedBy, regId]);
    }
    return items;
}

// Remove the charges a registration added (used when the student withdraws it)
async function unbillRegistration(db, regId) {
    const [r] = await db.query("DELETE FROM fee_entries WHERE reg_id = ? AND entry_type = 'charge'", [regId]);
    return r.affectedRows;
}

// Bill every existing registration that was made before automatic billing (runs at server start)
async function billExistingRegistrations() {
    const [regs] = await pool.query(
        `SELECT r.reg_id, r.student_id, r.semester, s.programme
         FROM semester_registrations r JOIN students s ON s.student_id = r.student_id
         WHERE s.programme IS NOT NULL
         ORDER BY r.submitted_at, r.reg_id`);
    let added = 0;
    for (const r of regs) {
        added += (await billRegistration(pool, { regId: r.reg_id, studentId: r.student_id, programme: r.programme, semester: r.semester })).length;
    }
    if (added) console.log(`Billed ${added} semester fee charge${added === 1 ? '' : 's'} for existing registrations.`);
}

module.exports = { chargesFor, previewFor, billRegistration, unbillRegistration, billExistingRegistrations, yearOf };
