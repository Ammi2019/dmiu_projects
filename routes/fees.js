// Fees: a simple ledger per student.
//   - "charge"  = something the student owes (tuition, annual fees, admission fees, other)
//   - "payment" = money received (with a receipt / bank reference)
//   Balance = charges − payments (positive means the student still owes).
//
// Accountant + Administrator can bill and record payments; Principal + Registrar can view.
// Students see only their own statement.
const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');
const { ROLES } = require('../utils/roles');
const { notify, userIdForStudent } = require('../utils/notify');
const reminders = require('../utils/feeReminders');

const multer = require('multer');

const router = express.Router();

// ----- Proof-of-payment uploads (photos or PDFs of receipts / deposit slips) -----
const PROOF_DIR = path.join(__dirname, '..', 'uploads', 'payment-proofs');
fs.mkdirSync(PROOF_DIR, { recursive: true });
const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const proofUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, PROOF_DIR),
        filename: (req, file, cb) => {
            const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[file.mimetype] || '';
            cb(null, `proof-${req.user.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (PROOF_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Upload a PDF, JPEG or PNG of your receipt.'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});
const removeProofFile = name => name && fs.unlink(path.join(PROOF_DIR, path.basename(name)), () => {});
const PAYMENT_METHODS = ['Bank deposit', 'Bank transfer', 'Mobile money', 'Cash', 'Other'];

const PROGRAMMES_FILE = path.join(__dirname, '..', 'data', 'programmes.json');
const loadFeeData = () => JSON.parse(fs.readFileSync(PROGRAMMES_FILE, 'utf8'));

const money = v => Math.round(Number(v) * 100) / 100;
const isMoney = v => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 1000000;
// Today's date on the server's own clock (local time), as YYYY-MM-DD
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function ledgerFor(studentId) {
    const [entries] = await pool.query(
        `SELECT fe.entry_id, fe.entry_type, fe.description, fe.amount, fe.reference, fe.method,
                DATE_FORMAT(fe.entry_date, '%Y-%m-%d') AS entry_date, u.name AS recorded_by
         FROM fee_entries fe LEFT JOIN USERS u ON fe.recorded_by = u.user_id
         WHERE fe.student_id = ?
         ORDER BY fe.entry_date, fe.entry_id`,
        [studentId]
    );
    let charged = 0, paid = 0;
    entries.forEach(e => {
        e.amount = Number(e.amount);
        if (e.entry_type === 'charge') charged += e.amount; else paid += e.amount;
    });
    return { entries, charged: money(charged), paid: money(paid), balance: money(charged - paid) };
}

// =====================================================================
// Staff
// =====================================================================

// LIST students with totals (?school=&programme=&q=&owing=1)
router.get('/students', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    try {
        const where = [];
        const params = [];
        if (req.query.school) { where.push('s.school = ?'); params.push(req.query.school); }
        if (req.query.programme) { where.push('s.programme = ?'); params.push(req.query.programme); }
        if (req.query.q) {
            where.push('(u.name LIKE ? OR u.email LIKE ? OR s.student_id = ?)');
            params.push(`%${req.query.q}%`, `%${req.query.q}%`, Number(req.query.q) || 0);
        }

        const [rows] = await pool.query(
            `SELECT s.student_id, u.name, u.email, s.school, s.programme,
                    COALESCE(SUM(CASE WHEN fe.entry_type = 'charge' THEN fe.amount END), 0) AS charged,
                    COALESCE(SUM(CASE WHEN fe.entry_type = 'payment' THEN fe.amount END), 0) AS paid
             FROM students s
             JOIN USERS u ON s.user_id = u.user_id
             LEFT JOIN fee_entries fe ON fe.student_id = s.student_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             GROUP BY s.student_id, u.name, u.email, s.school, s.programme
             ORDER BY u.name
             LIMIT 1000`,
            params
        );
        let students = rows.map(r => ({
            ...r,
            charged: money(r.charged),
            paid: money(r.paid),
            balance: money(Number(r.charged) - Number(r.paid))
        }));
        if (req.query.owing === '1') students = students.filter(s => s.balance > 0);
        res.json({ can_manage: ROLES.FEE_MANAGE.includes(req.user.role), students });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch fee balances.');
    }
});

// ONE student's statement
router.get('/students/:id', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.student_id, u.name, u.email, s.school, s.programme
             FROM students s JOIN USERS u ON s.user_id = u.user_id WHERE s.student_id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).send('Student not found.');
        res.json({ student: rows[0], ...(await ledgerFor(rows[0].student_id)), can_manage: ROLES.FEE_MANAGE.includes(req.user.role) });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch statement.');
    }
});

// RECORD a payment { amount, reference, method, date, note }
router.post('/students/:id/payments', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const reference = (req.body.reference || '').trim();
    const method = (req.body.method || '').trim() || null;
    const date = (req.body.date || '').trim() || today();
    const note = (req.body.note || '').trim();

    if (!isMoney(req.body.amount)) return res.status(400).send('Enter an amount greater than zero.');
    if (!reference) return res.status(400).send('Enter the receipt or bank reference number.');
    if (reference.length > 60) return res.status(400).send('Reference is too long.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return res.status(400).send('Enter a valid payment date (not in the future).');
    if (method && !['Bank deposit', 'Bank transfer', 'Mobile money', 'Cash', 'Other'].includes(method)) {
        return res.status(400).send('Choose a payment method from the list.');
    }

    try {
        const [students] = await pool.query('SELECT student_id FROM students WHERE student_id = ?', [req.params.id]);
        if (students.length === 0) return res.status(404).send('Student not found.');

        // The same receipt must not be recorded twice
        const [dupes] = await pool.query(
            "SELECT entry_id FROM fee_entries WHERE entry_type = 'payment' AND reference = ?", [reference]);
        if (dupes.length) return res.status(409).send(`Receipt ${reference} has already been recorded.`);

        await pool.query(
            `INSERT INTO fee_entries (student_id, entry_type, description, amount, reference, method, entry_date, recorded_by)
             VALUES (?, 'payment', ?, ?, ?, ?, ?, ?)`,
            [req.params.id, (note || 'Payment received').slice(0, 200), money(req.body.amount), reference, method, date, req.user.id]
        );
        notify([await userIdForStudent(req.params.id)], {
            category: 'fees',
            title: `Payment of K${money(req.body.amount).toLocaleString('en-US')} recorded`,
            body: `Receipt ${reference}. Check your Fees tab for your updated balance.`,
            link: 'tab-fees'
        });
        res.status(201).send(`Payment of K${money(req.body.amount).toLocaleString('en-US')} recorded.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to record payment.');
    }
});

// ADD a one-off charge { description, amount }
router.post('/students/:id/charges', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const description = (req.body.description || '').trim();
    if (!description || description.length > 200) return res.status(400).send('Enter what the charge is for.');
    if (!isMoney(req.body.amount)) return res.status(400).send('Enter an amount greater than zero.');

    try {
        const [students] = await pool.query('SELECT student_id FROM students WHERE student_id = ?', [req.params.id]);
        if (students.length === 0) return res.status(404).send('Student not found.');
        await pool.query(
            `INSERT INTO fee_entries (student_id, entry_type, description, amount, entry_date, recorded_by)
             VALUES (?, 'charge', ?, ?, ?, ?)`,
            [req.params.id, description, money(req.body.amount), today(), req.user.id]
        );
        res.status(201).send('Charge added.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to add charge.');
    }
});

// BILL many students at once from the fee structure
// { item: 'tuition' | 'annual' | 'admission', period, school?, programme? }
router.post('/bill', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const item = req.body.item;
    const period = (req.body.period || '').trim();
    const school = (req.body.school || '').trim() || null;
    const programme = (req.body.programme || '').trim() || null;

    if (!['tuition', 'annual', 'admission'].includes(item)) return res.status(400).send('Choose what to bill.');
    if (item !== 'admission' && !period) return res.status(400).send('Enter the semester or year being billed.');
    if (period.length > 40) return res.status(400).send('Period is too long.');

    try {
        const data = loadFeeData();
        const feeOf = {};
        data.schools.forEach(s => s.programmes.forEach(p => { feeOf[p.name] = p.fee; }));
        const annualTotal = data.annualFees.reduce((t, f) => t + f.amount, 0);
        // All listed programmes are undergraduate (diploma / bachelor)
        const admissionTotal = data.admissionFees.reduce((t, f) => t + f.ug, 0);

        const description = {
            tuition: `Tuition — ${period}`,
            annual: `Annual fees — ${period}`,
            admission: 'Admission fees (once off)'
        }[item];

        const where = [];
        const params = [];
        if (school) { where.push('school = ?'); params.push(school); }
        if (programme) { where.push('programme = ?'); params.push(programme); }
        const [students] = await pool.query(
            `SELECT student_id, programme FROM students ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);

        const [already] = await pool.query(
            "SELECT student_id FROM fee_entries WHERE entry_type = 'charge' AND description = ?", [description]);
        const done = new Set(already.map(r => r.student_id));

        let billed = 0, skipped = 0, noProgramme = 0, total = 0;
        for (const s of students) {
            if (done.has(s.student_id)) { skipped++; continue; }
            let amount;
            if (item === 'tuition') {
                amount = feeOf[s.programme];
                if (!amount) { noProgramme++; continue; }
            } else {
                amount = item === 'annual' ? annualTotal : admissionTotal;
            }
            await pool.query(
                `INSERT INTO fee_entries (student_id, entry_type, description, amount, entry_date, recorded_by)
                 VALUES (?, 'charge', ?, ?, ?, ?)`,
                [s.student_id, description, amount, today(), req.user.id]
            );
            billed++;
            total += amount;
        }

        const parts = [`Billed ${billed} student${billed === 1 ? '' : 's'} (K${total.toLocaleString('en-US')} in total) for "${description}".`];
        if (skipped) parts.push(`${skipped} already had this charge and ${skipped === 1 ? 'was' : 'were'} skipped.`);
        if (noProgramme) parts.push(`${noProgramme} ${noProgramme === 1 ? 'has' : 'have'} no programme recorded, so no tuition could be worked out.`);
        res.json({ billed, skipped, noProgramme, total, message: parts.join(' ') });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to bill students.');
    }
});

// REMOVE an entry recorded by mistake
router.delete('/entries/:id', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM fee_entries WHERE entry_id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).send('Entry not found.');
        // If this payment came from a student's uploaded proof, send the proof back for verification
        const [back] = await pool.query(
            "UPDATE payment_proofs SET status = 'pending', entry_id = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE entry_id = ?",
            [req.params.id]);
        res.send(back.affectedRows ? 'Entry removed. The student\'s uploaded proof is back in the verification queue.' : 'Entry removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove entry.');
    }
});


// =====================================================================
// Staff — proofs of payment uploaded by students
// =====================================================================

// LIST proofs (?status=pending|verified|rejected, default pending)
router.get('/proofs', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    const status = ['pending', 'verified', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    try {
        const [rows] = await pool.query(
            `SELECT pp.proof_id, pp.student_id, u.name AS student_name, s.programme,
                    pp.amount, pp.reference, pp.method, DATE_FORMAT(pp.payment_date, '%Y-%m-%d') AS payment_date,
                    pp.note, pp.file_name, pp.file_type, pp.status, pp.review_note,
                    DATE_FORMAT(pp.created_at, '%Y-%m-%d %H:%i') AS uploaded_at,
                    rv.name AS reviewed_by, DATE_FORMAT(pp.reviewed_at, '%Y-%m-%d %H:%i') AS reviewed_at,
                    EXISTS(SELECT 1 FROM fee_entries fe WHERE fe.entry_type = 'payment' AND fe.reference = pp.reference) AS reference_used
             FROM payment_proofs pp
             JOIN students s ON pp.student_id = s.student_id
             JOIN USERS u ON s.user_id = u.user_id
             LEFT JOIN USERS rv ON pp.reviewed_by = rv.user_id
             WHERE pp.status = ?
             ORDER BY pp.created_at ${status === 'pending' ? 'ASC' : 'DESC'}
             LIMIT 300`,
            [status]
        );
        rows.forEach(r => { r.amount = Number(r.amount); r.reference_used = Boolean(Number(r.reference_used)); });
        res.json({ can_manage: ROLES.FEE_MANAGE.includes(req.user.role), proofs: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch payment proofs.');
    }
});

// VIEW the uploaded file
router.get('/proofs/:id/file', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT file_path, file_name, file_type FROM payment_proofs WHERE proof_id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).send('Proof not found.');
        res.setHeader('Content-Type', rows[0].file_type);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`);
        res.sendFile(path.join(PROOF_DIR, path.basename(rows[0].file_path)), err => {
            if (err && !res.headersSent) res.status(404).send('The uploaded file is missing.');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch file.');
    }
});

// VERIFY → records the payment on the student's statement. Optional { amount, reference } corrections.
router.put('/proofs/:id/verify', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM payment_proofs WHERE proof_id = ? FOR UPDATE', [req.params.id]);
        const proof = rows[0];
        if (!proof) { await connection.rollback(); return res.status(404).send('Proof not found.'); }
        if (proof.status !== 'pending') { await connection.rollback(); return res.status(409).send('This proof has already been reviewed.'); }

        // The accountant may correct the amount or reference to match the bank / receipt book
        const amount = req.body.amount !== undefined && req.body.amount !== '' ? req.body.amount : proof.amount;
        const reference = (req.body.reference || proof.reference || '').trim();
        if (!isMoney(amount)) { await connection.rollback(); return res.status(400).send('Enter an amount greater than zero.'); }
        if (!reference || reference.length > 60) { await connection.rollback(); return res.status(400).send('Enter a valid reference.'); }

        const [dupes] = await connection.query(
            "SELECT entry_id FROM fee_entries WHERE entry_type = 'payment' AND reference = ?", [reference]);
        if (dupes.length) {
            await connection.rollback();
            return res.status(409).send(`A payment with reference ${reference} is already recorded. Reject this proof if it is a duplicate.`);
        }

        const [entry] = await connection.query(
            `INSERT INTO fee_entries (student_id, entry_type, description, amount, reference, method, entry_date, recorded_by)
             VALUES (?, 'payment', 'Payment received (proof uploaded by student)', ?, ?, ?, ?, ?)`,
            [proof.student_id, money(amount), reference, proof.method, proof.payment_date, req.user.id]
        );
        await connection.query(
            `UPDATE payment_proofs SET status = 'verified', reviewed_by = ?, reviewed_at = NOW(), entry_id = ?,
                    amount = ?, reference = ?, review_note = NULL
             WHERE proof_id = ?`,
            [req.user.id, entry.insertId, money(amount), reference, proof.proof_id]
        );
        await connection.commit();
        notify([await userIdForStudent(proof.student_id)], {
            category: 'fees',
            title: `Receipt verified: K${money(amount).toLocaleString('en-US')}`,
            body: `Your payment with reference ${reference} has been verified and added to your statement.`,
            link: 'tab-fees'
        });
        res.send(`Verified — K${money(amount).toLocaleString('en-US')} added to the student's statement.`);
    } catch (err) {
        if (connection) await connection.rollback().catch(() => {});
        console.error(err);
        res.status(500).send('Failed to verify payment.');
    } finally {
        if (connection) connection.release();
    }
});

// REJECT with a reason the student will see { reason }
router.put('/proofs/:id/reject', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const reason = (req.body.reason || '').trim();
    if (!reason) return res.status(400).send('Give the student a reason so they know what to fix.');
    if (reason.length > 500) return res.status(400).send('Reason must be 500 characters or fewer.');
    try {
        const [result] = await pool.query(
            `UPDATE payment_proofs SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = NOW()
             WHERE proof_id = ? AND status = 'pending'`,
            [reason, req.user.id, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(409).send('This proof was not found or has already been reviewed.');
        const [[pf]] = await pool.query('SELECT student_id, reference FROM payment_proofs WHERE proof_id = ?', [req.params.id]);
        notify([await userIdForStudent(pf.student_id)], {
            category: 'fees',
            title: 'Receipt not accepted',
            body: `Your receipt ${pf.reference} was not accepted: ${reason}`,
            link: 'tab-fees'
        });
        res.send('Proof rejected. The student will see your reason.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to reject proof.');
    }
});


// =====================================================================
// Reports — Accountant, Administrator, Principal, Registrar
//   GET /api/fees/reports/:type?from=YYYY-MM-DD&to=YYYY-MM-DD&school=&programme=
//   types: collections | outstanding | by-programme | billing
// =====================================================================
router.get('/reports/:type', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    const type = req.params.type;
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    const from = isDate(req.query.from) ? req.query.from : null;
    const to = isDate(req.query.to) ? req.query.to : null;
    if (from && to && from > to) return res.status(400).send('The "from" date must be before the "to" date.');

    // Student filters (school / programme)
    const sWhere = [];
    const sParams = [];
    if (req.query.school) { sWhere.push('s.school = ?'); sParams.push(req.query.school); }
    if (req.query.programme) { sWhere.push('s.programme = ?'); sParams.push(req.query.programme); }
    // Entry date filters
    const dWhere = [];
    const dParams = [];
    if (from) { dWhere.push('fe.entry_date >= ?'); dParams.push(from); }
    if (to) { dWhere.push('fe.entry_date <= ?'); dParams.push(to); }

    try {
        const [[me]] = await pool.query('SELECT name FROM USERS WHERE user_id = ?', [req.user.id]);
        const meta = {
            type,
            from, to,
            school: req.query.school || null,
            programme: req.query.programme || null,
            generated_by: me ? me.name : null,
            generated_at: new Date().toISOString()
        };

        if (type === 'collections') {
            const where = ["fe.entry_type = 'payment'", ...dWhere, ...sWhere];
            const [rows] = await pool.query(
                `SELECT DATE_FORMAT(fe.entry_date, '%Y-%m-%d') AS date, s.student_id, u.name AS student, s.school, s.programme,
                        fe.reference, COALESCE(fe.method, 'Not stated') AS method, fe.amount, rb.name AS recorded_by
                 FROM fee_entries fe
                 JOIN students s ON fe.student_id = s.student_id
                 JOIN USERS u ON s.user_id = u.user_id
                 LEFT JOIN USERS rb ON fe.recorded_by = rb.user_id
                 WHERE ${where.join(' AND ')}
                 ORDER BY fe.entry_date, fe.entry_id`,
                [...dParams, ...sParams]
            );
            rows.forEach(r => { r.amount = money(r.amount); });
            const byMethod = {};
            const byDate = {};
            rows.forEach(r => {
                byMethod[r.method] = money((byMethod[r.method] || 0) + r.amount);
                byDate[r.date] = money((byDate[r.date] || 0) + r.amount);
            });
            const total = money(rows.reduce((t, r) => t + r.amount, 0));
            return res.json({
                meta,
                summary: { total, payments: rows.length, students: new Set(rows.map(r => r.student_id)).size },
                by_method: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
                by_date: Object.entries(byDate).map(([date, amount]) => ({ date, amount })),
                rows
            });
        }

        if (type === 'outstanding') {
            // Balance as at the "to" date (or today)
            const asAt = to ? ' AND fe.entry_date <= ?' : '';
            const [rows] = await pool.query(
                `SELECT s.student_id, u.name AS student, u.email, s.school, s.programme,
                        COALESCE(SUM(CASE WHEN fe.entry_type = 'charge' THEN fe.amount END), 0) AS billed,
                        COALESCE(SUM(CASE WHEN fe.entry_type = 'payment' THEN fe.amount END), 0) AS paid,
                        MAX(CASE WHEN fe.entry_type = 'payment' THEN fe.entry_date END) AS last_payment
                 FROM students s
                 JOIN USERS u ON s.user_id = u.user_id
                 LEFT JOIN fee_entries fe ON fe.student_id = s.student_id${asAt}
                 ${sWhere.length ? 'WHERE ' + sWhere.join(' AND ') : ''}
                 GROUP BY s.student_id, u.name, u.email, s.school, s.programme`,
                [...(to ? [to] : []), ...sParams]
            );
            const owing = rows
                .map(r => ({
                    ...r,
                    billed: money(r.billed),
                    paid: money(r.paid),
                    balance: money(Number(r.billed) - Number(r.paid)),
                    last_payment: r.last_payment ? new Date(r.last_payment).toLocaleDateString('en-CA') : null
                }))
                .filter(r => r.balance > 0)
                .sort((a, b) => b.balance - a.balance);
            meta.from = null; // an "as at" report, not a period
            return res.json({
                meta,
                summary: {
                    total_outstanding: money(owing.reduce((t, r) => t + r.balance, 0)),
                    students_owing: owing.length,
                    students_checked: rows.length
                },
                rows: owing
            });
        }

        if (type === 'by-programme') {
            const dateOn = dWhere.length ? ' AND ' + dWhere.join(' AND ') : '';
            const [rows] = await pool.query(
                `SELECT COALESCE(s.school, 'No school recorded') AS school, COALESCE(s.programme, 'No programme recorded') AS programme,
                        COUNT(DISTINCT s.student_id) AS students,
                        COALESCE(SUM(CASE WHEN fe.entry_type = 'charge' THEN fe.amount END), 0) AS billed,
                        COALESCE(SUM(CASE WHEN fe.entry_type = 'payment' THEN fe.amount END), 0) AS paid
                 FROM students s
                 LEFT JOIN fee_entries fe ON fe.student_id = s.student_id${dateOn}
                 ${sWhere.length ? 'WHERE ' + sWhere.join(' AND ') : ''}
                 GROUP BY s.school, s.programme
                 ORDER BY school, programme`,
                [...dParams, ...sParams]
            );
            const out = rows.map(r => {
                const billed = money(r.billed), paid = money(r.paid);
                return { school: r.school, programme: r.programme, students: Number(r.students), billed, paid,
                         outstanding: money(billed - paid), collected_pct: billed ? Math.round((paid / billed) * 1000) / 10 : null };
            });
            const t = out.reduce((a, r) => ({ students: a.students + r.students, billed: a.billed + r.billed, paid: a.paid + r.paid }), { students: 0, billed: 0, paid: 0 });
            return res.json({
                meta,
                summary: { students: t.students, billed: money(t.billed), paid: money(t.paid), outstanding: money(t.billed - t.paid),
                           collected_pct: t.billed ? Math.round((t.paid / t.billed) * 1000) / 10 : null },
                rows: out
            });
        }

        if (type === 'billing') {
            const where = ["fe.entry_type = 'charge'", ...dWhere, ...sWhere];
            const [rows] = await pool.query(
                `SELECT fe.description, COUNT(DISTINCT fe.student_id) AS students, COUNT(*) AS charges,
                        SUM(fe.amount) AS total, MIN(fe.entry_date) AS first_date, MAX(fe.entry_date) AS last_date
                 FROM fee_entries fe
                 JOIN students s ON fe.student_id = s.student_id
                 WHERE ${where.join(' AND ')}
                 GROUP BY fe.description
                 ORDER BY MIN(fe.entry_date), fe.description`,
                [...dParams, ...sParams]
            );
            const out = rows.map(r => ({
                description: r.description, students: Number(r.students), charges: Number(r.charges), total: money(r.total),
                first_date: r.first_date ? new Date(r.first_date).toLocaleDateString('en-CA') : null
            }));
            return res.json({
                meta,
                summary: { total_billed: money(out.reduce((t, r) => t + r.total, 0)), items: out.length },
                rows: out
            });
        }

        res.status(400).send('Unknown report type.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to generate report.');
    }
});


// =====================================================================
// Fee reminders — semester calendar, settings, preview, send now
// =====================================================================

// GET settings + semesters + how many students are currently below the acceptable amount
router.get('/reminders', verifyToken, checkRole(...ROLES.FEE_VIEW), async (req, res) => {
    try {
        const settings = await reminders.getSettings();
        const [semesters] = await pool.query(
            `SELECT semester_id, name, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
             FROM semesters ORDER BY start_date`);
        const below = await reminders.studentsBelowThreshold(settings.min_paid_pct);
        res.json({
            settings,
            semesters,
            can_manage: ROLES.FEE_MANAGE.includes(req.user.role),
            below_count: below.length,
            below_total_short: money(below.reduce((t, s) => t + s.short, 0))
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load reminder settings.');
    }
});

// SAVE settings { enabled, min_paid_pct, lead_days }
router.put('/reminders/settings', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const pct = Number(req.body.min_paid_pct);
    const lead = Number(req.body.lead_days);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return res.status(400).send('Acceptable amount must be a percentage from 1 to 100.');
    if (!Number.isInteger(lead) || lead < 1 || lead > 90) return res.status(400).send('Days before must be between 1 and 90.');
    try {
        await pool.query(
            `INSERT INTO fee_reminder_settings (id, enabled, min_paid_pct, lead_days) VALUES (1, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), min_paid_pct = VALUES(min_paid_pct), lead_days = VALUES(lead_days)`,
            [req.body.enabled ? 1 : 0, pct, lead]
        );
        res.send('Reminder settings saved.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to save settings.');
    }
});

// ADD a semester { name, start_date, end_date }
router.post('/semesters', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    const name = (req.body.name || '').trim();
    const start = req.body.start_date, end = req.body.end_date;
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    if (!name || name.length > 40) return res.status(400).send('Enter the semester name, e.g. "2027 Semester 1".');
    if (!isDate(start) || !isDate(end)) return res.status(400).send('Enter both the start and end dates.');
    if (start >= end) return res.status(400).send('The semester must end after it starts.');
    try {
        const [dupes] = await pool.query('SELECT 1 FROM semesters WHERE name = ?', [name]);
        if (dupes.length) return res.status(409).send(`${name} is already in the calendar.`);
        await pool.query('INSERT INTO semesters (name, start_date, end_date) VALUES (?, ?, ?)', [name, start, end]);
        res.status(201).send(`${name} added.`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to add semester.');
    }
});

// REMOVE a semester
router.delete('/semesters/:id', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM semesters WHERE semester_id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).send('Semester not found.');
        await pool.query('DELETE FROM fee_reminders_sent WHERE semester_id = ?', [req.params.id]);
        res.send('Semester removed.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to remove semester.');
    }
});

// SEND reminders now to everyone below the acceptable amount
router.post('/reminders/send-now', verifyToken, checkRole(...ROLES.FEE_MANAGE), async (req, res) => {
    try {
        const { sent } = await reminders.sendRemindersNow();
        res.send(sent ? `Reminder sent to ${sent} student${sent === 1 ? '' : 's'}.` : 'No students are below the acceptable amount — nothing to send.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to send reminders.');
    }
});

// =====================================================================
// Student — my own statement
// =====================================================================
async function myStudentId(userId) {
    const [rows] = await pool.query('SELECT student_id FROM students WHERE user_id = ?', [userId]);
    return rows.length ? rows[0].student_id : null;
}

router.get('/mine', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await myStudentId(req.user.id);
        if (!studentId) return res.status(404).send('No student record is linked to your account.');
        const [proofs] = await pool.query(
            `SELECT proof_id, amount, reference, method, DATE_FORMAT(payment_date, '%Y-%m-%d') AS payment_date,
                    file_name, status, review_note, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS uploaded_at
             FROM payment_proofs WHERE student_id = ? ORDER BY created_at DESC`,
            [studentId]
        );
        proofs.forEach(p => { p.amount = Number(p.amount); });
        res.json({ ...(await ledgerFor(studentId)), proofs, payment: loadFeeData().payment });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch your fees.');
    }
});

// UPLOAD proof of payment (file field "file")
router.post('/mine/proofs', verifyToken, checkRole('student'), (req, res, next) => {
    proofUpload.single('file')(req, res, err => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(400).send('File is too large. Maximum size is 5MB.');
        return res.status(400).send(err.message || 'Upload failed.');
    });
}, async (req, res) => {
    const discard = () => req.file && removeProofFile(req.file.filename);
    const reference = (req.body.reference || '').trim();
    const method = (req.body.method || '').trim() || null;
    const date = (req.body.date || '').trim();
    const note = (req.body.note || '').trim();

    if (!req.file) return res.status(400).send('Attach a photo or PDF of your receipt.');
    if (!isMoney(req.body.amount)) { discard(); return res.status(400).send('Enter the amount you paid.'); }
    if (!reference || reference.length > 60) { discard(); return res.status(400).send('Enter the receipt or bank reference number.'); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) { discard(); return res.status(400).send('Enter the date you paid (not in the future).'); }
    if (method && !PAYMENT_METHODS.includes(method)) { discard(); return res.status(400).send('Choose a payment method from the list.'); }
    if (note.length > 500) { discard(); return res.status(400).send('Note must be 500 characters or fewer.'); }

    try {
        const studentId = await myStudentId(req.user.id);
        if (!studentId) { discard(); return res.status(404).send('No student record is linked to your account.'); }

        // Same receipt already recorded, or already waiting for verification?
        const [used] = await pool.query("SELECT 1 FROM fee_entries WHERE entry_type = 'payment' AND reference = ?", [reference]);
        if (used.length) { discard(); return res.status(409).send(`A payment with reference ${reference} has already been recorded.`); }
        const [waiting] = await pool.query("SELECT 1 FROM payment_proofs WHERE reference = ? AND status = 'pending'", [reference]);
        if (waiting.length) { discard(); return res.status(409).send(`A proof with reference ${reference} is already waiting for verification.`); }

        await pool.query(
            `INSERT INTO payment_proofs (student_id, amount, reference, method, payment_date, note, file_path, file_name, file_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [studentId, money(req.body.amount), reference, method, date, note || null, req.file.filename, req.file.originalname, req.file.mimetype]
        );
        res.status(201).send('Proof uploaded. The Accounts office will verify it and update your balance.');
    } catch (err) {
        console.error(err);
        discard();
        res.status(500).send('Failed to upload proof.');
    }
});

// WITHDRAW one of my proofs that hasn't been reviewed yet
router.delete('/mine/proofs/:id', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await myStudentId(req.user.id);
        const [rows] = await pool.query(
            "SELECT file_path FROM payment_proofs WHERE proof_id = ? AND student_id = ? AND status = 'pending'",
            [req.params.id, studentId]
        );
        if (rows.length === 0) return res.status(404).send('Only proofs still awaiting verification can be withdrawn.');
        await pool.query('DELETE FROM payment_proofs WHERE proof_id = ?', [req.params.id]);
        removeProofFile(rows[0].file_path);
        res.send('Proof withdrawn.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to withdraw proof.');
    }
});

// VIEW my own uploaded file
router.get('/mine/proofs/:id/file', verifyToken, checkRole('student'), async (req, res) => {
    try {
        const studentId = await myStudentId(req.user.id);
        const [rows] = await pool.query(
            'SELECT file_path, file_name, file_type FROM payment_proofs WHERE proof_id = ? AND student_id = ?',
            [req.params.id, studentId]
        );
        if (rows.length === 0) return res.status(404).send('Proof not found.');
        res.setHeader('Content-Type', rows[0].file_type);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].file_name)}`);
        res.sendFile(path.join(PROOF_DIR, path.basename(rows[0].file_path)), err => {
            if (err && !res.headersSent) res.status(404).send('The uploaded file is missing.');
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch file.');
    }
});

module.exports = router;
