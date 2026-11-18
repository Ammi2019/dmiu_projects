// Read-only check of fees and approval data. Run: node diagnose.js   (changes nothing)
const pool = require('./db');
const show = (title, rows) => { console.log('\n=== ' + title); console.table(rows); };

(async () => {
  try {
    show('fee entry types (should be only "charge" and "payment")', (await pool.query(
      `SELECT CONCAT('[', entry_type, ']') AS entry_type, COUNT(*) AS n, SUM(amount) AS total FROM fee_entries GROUP BY entry_type`))[0]);

    show('payments recorded against a student_id that does not exist', (await pool.query(
      `SELECT fe.entry_id, fe.student_id, fe.amount, fe.reference FROM fee_entries fe
       LEFT JOIN students s ON s.student_id = fe.student_id WHERE s.student_id IS NULL`))[0]);

    show('balance per student', (await pool.query(
      `SELECT s.student_id, u.name, s.school,
              COALESCE(SUM(CASE WHEN fe.entry_type='charge'  THEN fe.amount END),0) AS charged,
              COALESCE(SUM(CASE WHEN fe.entry_type='payment' THEN fe.amount END),0) AS paid,
              COALESCE(SUM(CASE WHEN fe.entry_type='charge' THEN fe.amount ELSE -fe.amount END),0) AS balance,
              SUM(fe.entry_type='payment') AS payments
       FROM students s JOIN USERS u ON u.user_id = s.user_id
       LEFT JOIN fee_entries fe ON fe.student_id = s.student_id
       GROUP BY s.student_id, u.name, s.school ORDER BY s.student_id`))[0]);

    show('charges billed more than once to the same student', (await pool.query(
      `SELECT student_id, description, COUNT(*) AS times, SUM(amount) AS total FROM fee_entries
       WHERE entry_type='charge' GROUP BY student_id, description HAVING COUNT(*) > 1`))[0]);

    show('payment proofs by status', (await pool.query(
      `SELECT pp.proof_id, pp.student_id, pp.amount, pp.reference, pp.status, pp.entry_id FROM payment_proofs pp ORDER BY pp.proof_id DESC LIMIT 30`))[0]);

    show('approvers and their school (lecturers use LECTURERS.school first)', (await pool.query(
      `SELECT u.user_id, u.name, u.role, CONCAT('[', COALESCE(l.school, u.school, 'NULL'), ']') AS school_used
       FROM USERS u LEFT JOIN LECTURERS l ON l.user_id = u.user_id
       WHERE u.status='approved' AND u.role IN ('lecturer','class_teacher','head_of_department','dean_of_students','dean_academic','accountant')
       ORDER BY u.role`))[0]);

    show('semester registrations and their steps', (await pool.query(
      `SELECT r.reg_id, r.period_id, rp.is_open, r.student_id, u.name, CONCAT('[', COALESCE(s.school,'NULL'), ']') AS student_school,
              r.semester, r.status, r.accounts_status, r.advisor_status, r.hod_status, r.dos_status, r.academic_status
       FROM semester_registrations r JOIN registration_periods rp ON rp.period_id = r.period_id
       JOIN students s ON s.student_id = r.student_id JOIN USERS u ON u.user_id = s.user_id
       ORDER BY r.reg_id DESC LIMIT 30`))[0]);
  } catch (e) {
    console.error('Diagnose failed:', e.message);
  } finally {
    await pool.end();
  }
})();
