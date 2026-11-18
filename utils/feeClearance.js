// Accounts clearance rule, shared by semester registration, exam clearance, the registration
// fee preview and fee reminders.
//
// A student is cleared when:
//   - everything billed BEFORE this semester (earlier semesters, one-off charges) is fully paid, and
//   - at least min % of THIS semester's fees is paid
//       40%  to register for the semester
//       75%  for the mid-semester test
//       100% for end-semester exams
// In one line: the balance still owed must be no more than (100 − min)% of this semester's fees.
// Money paid in advance (credit) counts toward it.
//
// "This semester's fees" are the charges billed by the student's semester registration (tuition, plus
// annual / admission fees when they were billed with it). If a student has no registration-linked
// charges (billed by hand before automatic billing), everything billed is treated as this semester's fees.
const cents = v => Math.round(Number(v || 0) * 100);
const kwacha = c => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

function feeStatus({ charged, paid, semesterCharged, minPct }) {
    const total = cents(charged);
    const paidC = cents(paid);
    let sem = cents(semesterCharged);
    const scoped = sem > 0;
    if (!scoped) sem = total;
    sem = Math.min(sem, total);

    const earlier = total - sem;                                   // billed before this semester
    const balance = total - paidC;                                 // still owed overall
    const allowedOwing = Math.floor((sem * (100 - minPct)) / 100);  // may still be owed and be cleared
    const neededC = Math.max(balance - allowedOwing, 0);
    const arrears = Math.max(earlier - paidC, 0);
    const towardSem = Math.min(Math.max(paidC - earlier, 0), sem);
    const pct = sem > 0 ? Math.floor((towardSem * 100) / sem) : 0;
    const cleared = total > 0 && neededC === 0;
    const of = scoped ? "this semester's fees" : 'your fees';

    let detail;
    if (total === 0) detail = 'No fees have been billed yet. The Accounts office must bill fees first (or clear this step manually).';
    else if (cleared) detail = `Paid ${pct}% of ${of} (needs ${minPct}%)`;
    else if (arrears > 0) detail = `K${kwacha(arrears)} is still owed from earlier semesters and must be paid in full, plus ${minPct}% of ${of}. Pay at least K${kwacha(Math.ceil(neededC / 100) * 100)} more.`;
    else detail = `Paid ${pct}% of ${of} — needs ${minPct}%. Pay at least K${kwacha(Math.ceil(neededC / 100) * 100)} more.`;

    return {
        cleared,
        paid_pct: pct,
        required_pct: minPct,
        charged: total / 100,
        paid: paidC / 100,
        semester_charged: sem / 100,
        arrears: arrears / 100,
        needed: Math.ceil(neededC / 100),      // whole kwacha, rounded up
        detail
    };
}

module.exports = { feeStatus };
