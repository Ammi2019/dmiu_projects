// Database setup that runs ONCE when the server starts, BEFORE it accepts requests.
//
// Every step is safe to run again (it skips anything that already exists), and the steps run
// one after another — never at the same time — so MySQL can't deadlock on its own changes.
const pool = require('../db');
const ensureColumn = require('./ensureColumn');
const ensureEnumValues = require('./ensureEnumValues');

// MySQL error codes worth retrying: deadlock, lock wait timeout
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

async function withRetry(label, fn, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            if (RETRYABLE.has(err.code) && i < attempts) {
                console.warn(`  ${label}: ${err.code}, retrying (${i}/${attempts - 1})…`);
                await new Promise(r => setTimeout(r, 500 * i));
                continue;
            }
            throw err;
        }
    }
}

const STEPS = [
    // --- Every role the portal uses must be allowed by USERS.role (an ENUM in older databases) ---
    ['USERS.role values', () => ensureEnumValues('USERS', 'role', [
        'student', 'class_teacher', 'lecturer', 'head_of_department', 'administrator', 'principal',
        'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk'])],

    // --- Registration details on USERS ---
    ['USERS.account_type', () => ensureColumn('USERS', 'account_type', 'VARCHAR(20) NULL')],
    ['USERS.school', () => ensureColumn('USERS', 'school', 'VARCHAR(100) NULL')],
    ['USERS.programme', () => ensureColumn('USERS', 'programme', 'VARCHAR(150) NULL')],

    // --- Students: school/programme + editable profile ---
    ['students.school', () => ensureColumn('students', 'school', 'VARCHAR(100) NULL')],
    ['students.programme', () => ensureColumn('students', 'programme', 'VARCHAR(150) NULL')],
    ['student_profiles table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS student_profiles (
            profile_id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL UNIQUE,
            phone VARCHAR(20),
            address VARCHAR(255),
            next_of_kin_name VARCHAR(100),
            next_of_kin_phone VARCHAR(20),
            photo_path VARCHAR(255),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`)],

    // --- Lecturers: school + editable profile ---
    ['LECTURERS.school', () => ensureColumn('LECTURERS', 'school', 'VARCHAR(100) NULL')],
    ['lecturer_profiles table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS lecturer_profiles (
            profile_id INT AUTO_INCREMENT PRIMARY KEY,
            lecturer_id INT NOT NULL UNIQUE,
            phone VARCHAR(20),
            office VARCHAR(100),
            office_hours VARCHAR(100),
            qualification VARCHAR(150),
            specialization VARCHAR(150),
            bio TEXT,
            photo_path VARCHAR(255),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`)],

    // --- Applications: chosen programme ---
    ['applications.programme', () => ensureColumn('applications', 'programme', 'VARCHAR(150) NULL')],
    ['applications.school', () => ensureColumn('applications', 'school', 'VARCHAR(100) NULL')],

    // --- Assignments ---
    ['assignments table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS assignments (
            assignment_id INT AUTO_INCREMENT PRIMARY KEY,
            lecturer_id INT NOT NULL,
            school VARCHAR(100) NOT NULL,
            programme VARCHAR(150) NULL,
            course_name VARCHAR(150) NOT NULL,
            assignment_no TINYINT NOT NULL,
            title VARCHAR(200) NOT NULL,
            instructions TEXT,
            due_at DATETIME NOT NULL,
            file_path VARCHAR(255),
            file_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (school, programme),
            INDEX (lecturer_id)
        )`)],
    ['assignment_submissions table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS assignment_submissions (
            submission_id INT AUTO_INCREMENT PRIMARY KEY,
            assignment_id INT NOT NULL,
            student_id INT NOT NULL,
            file_path VARCHAR(255) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            comment VARCHAR(1000),
            is_late TINYINT(1) NOT NULL DEFAULT 0,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY one_per_student (assignment_id, student_id)
        )`)],

    // --- Results: one sheet per course + programme + semester, marks per student per component ---
    ['result_sheets table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS result_sheets (
            sheet_id INT AUTO_INCREMENT PRIMARY KEY,
            lecturer_id INT NOT NULL,
            school VARCHAR(100) NOT NULL,
            programme VARCHAR(150) NULL,
            course_name VARCHAR(150) NOT NULL,
            period VARCHAR(40) NOT NULL,
            published VARCHAR(100) NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (lecturer_id),
            INDEX (school, programme)
        )`)],
    ['result_marks table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS result_marks (
            sheet_id INT NOT NULL,
            student_id INT NOT NULL,
            component VARCHAR(10) NOT NULL,
            mark DECIMAL(5,2) NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (sheet_id, student_id, component),
            INDEX (student_id)
        )`)],

    // --- Application review: who decided, and staff notes ---
    ['applications.decided_by', () => ensureColumn('applications', 'decided_by', 'INT NULL')],
    ['applications.decided_at', () => ensureColumn('applications', 'decided_at', 'DATETIME NULL')],
    ['application_notes table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS application_notes (
            note_id INT AUTO_INCREMENT PRIMARY KEY,
            application_id INT NOT NULL,
            user_id INT NOT NULL,
            note VARCHAR(1000) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (application_id)
        )`)],

    // --- Fees: one ledger of charges (what a student owes) and payments (what they paid) ---
    ['fee_entries table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS fee_entries (
            entry_id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            entry_type VARCHAR(10) NOT NULL,
            description VARCHAR(200) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            reference VARCHAR(60) NULL,
            method VARCHAR(30) NULL,
            entry_date DATE NOT NULL,
            recorded_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (student_id),
            INDEX (reference)
        )`)],

    // --- Proof of payment uploaded by students, verified by the accountant ---
    ['payment_proofs table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS payment_proofs (
            proof_id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            reference VARCHAR(60) NOT NULL,
            method VARCHAR(30) NULL,
            payment_date DATE NOT NULL,
            note VARCHAR(500) NULL,
            file_path VARCHAR(255) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_type VARCHAR(100) NOT NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'pending',
            review_note VARCHAR(500) NULL,
            reviewed_by INT NULL,
            reviewed_at DATETIME NULL,
            entry_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (student_id),
            INDEX (status)
        )`)],

    // --- Course notes: up to 5 units per course, posted by lecturers ---
    ['course_notes table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS course_notes (
            note_id INT AUTO_INCREMENT PRIMARY KEY,
            lecturer_id INT NOT NULL,
            school VARCHAR(100) NOT NULL,
            programme VARCHAR(150) NULL,
            course_name VARCHAR(150) NOT NULL,
            unit_no TINYINT NOT NULL,
            title VARCHAR(200) NOT NULL,
            description VARCHAR(1000) NULL,
            file_path VARCHAR(255) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_type VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (school, programme),
            INDEX (lecturer_id)
        )`)],

    // --- Notifications (one row per person) + announcements sent by staff ---
    ['notifications table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            category VARCHAR(20) NOT NULL,
            title VARCHAR(200) NOT NULL,
            body VARCHAR(1500) NULL,
            link VARCHAR(60) NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (user_id, is_read),
            INDEX (created_at)
        )`)],
    ['announcements table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS announcements (
            announcement_id INT AUTO_INCREMENT PRIMARY KEY,
            sender_id INT NOT NULL,
            audience VARCHAR(20) NOT NULL,
            school VARCHAR(100) NULL,
            programme VARCHAR(150) NULL,
            title VARCHAR(200) NOT NULL,
            body VARCHAR(1500) NOT NULL,
            recipients INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`)],

    // --- Fee reminders: semester calendar, settings, and a log so nobody is reminded twice ---
    ['semesters table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS semesters (
            semester_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(40) NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL
        )`)],
    ['fee_reminder_settings table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS fee_reminder_settings (
            id TINYINT PRIMARY KEY,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            min_paid_pct TINYINT NOT NULL DEFAULT 50,
            lead_days SMALLINT NOT NULL DEFAULT 14
        )`)],
    ['fee_reminder_settings default row', () => pool.query(
        'INSERT IGNORE INTO fee_reminder_settings (id, enabled, min_paid_pct, lead_days) VALUES (1, 1, 50, 14)')],
    ['fee_reminders_sent table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS fee_reminders_sent (
            student_id INT NOT NULL,
            semester_id INT NOT NULL,
            kind VARCHAR(10) NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (student_id, semester_id, kind)
        )`)],

    // --- Exam eligibility (No Due Certificate) + Hall Tickets ---
    // Details printed on the hall ticket, kept by the registry
    ['students.reg_no', () => ensureColumn('students', 'reg_no', 'VARCHAR(30) NULL')],
    ['students.current_semester', () => ensureColumn('students', 'current_semester', 'VARCHAR(20) NULL')],
    ['students.hostel_resident', () => ensureColumn('students', 'hostel_resident', 'TINYINT(1) NOT NULL DEFAULT 0')],
    // An exam sitting, e.g. "Mid-Semester Test – October 2026"
    ['exam_sessions table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS exam_sessions (
            session_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            exam_type VARCHAR(10) NOT NULL DEFAULT 'mid',
            min_paid_pct TINYINT NOT NULL DEFAULT 75,
            centre_name VARCHAR(60) NOT NULL DEFAULT 'CHIPATA',
            centre_code VARCHAR(10) NOT NULL DEFAULT '33',
            is_open TINYINT(1) NOT NULL DEFAULT 1,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`)],
    // Exam timetable rows, per programme
    ['exam_timetable table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS exam_timetable (
            row_id INT AUTO_INCREMENT PRIMARY KEY,
            session_id INT NOT NULL,
            school VARCHAR(100) NOT NULL,
            programme VARCHAR(150) NOT NULL,
            exam_date DATE NOT NULL,
            start_time VARCHAR(10) NULL,
            module_code VARCHAR(20) NOT NULL,
            module_name VARCHAR(150) NOT NULL,
            INDEX (session_id, programme)
        )`)],
    // One clearance record per student per exam session.
    // Departments: accounts (automatic from fees, accountant may override), class advisor, hostel.
    // Final approvals, in order: HOD -> Dean of Students -> Dean (Academic). Last approval issues the ticket.
    ['exam_clearances table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS exam_clearances (
            session_id INT NOT NULL,
            student_id INT NOT NULL,
            accounts_status VARCHAR(10) NULL,  accounts_by INT NULL,  accounts_at DATETIME NULL,  accounts_note VARCHAR(300) NULL,
            advisor_status  VARCHAR(10) NULL,  advisor_by  INT NULL,  advisor_at  DATETIME NULL,  advisor_note  VARCHAR(300) NULL,
            hostel_status   VARCHAR(10) NULL,  hostel_by   INT NULL,  hostel_at   DATETIME NULL,  hostel_note   VARCHAR(300) NULL,
            hod_status      VARCHAR(10) NULL,  hod_by      INT NULL,  hod_at      DATETIME NULL,  hod_note      VARCHAR(300) NULL,
            dos_status      VARCHAR(10) NULL,  dos_by      INT NULL,  dos_at      DATETIME NULL,  dos_note      VARCHAR(300) NULL,
            academic_status VARCHAR(10) NULL,  academic_by INT NULL,  academic_at DATETIME NULL,  academic_note VARCHAR(300) NULL,
            ticket_no VARCHAR(30) NULL UNIQUE,
            issued_at DATETIME NULL,
            PRIMARY KEY (session_id, student_id),
            INDEX (student_id)
        )`)],
    // Module catalogue: which modules each programme takes in each semester (I, II, III …)
    ['programme_modules table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS programme_modules (
            module_id INT AUTO_INCREMENT PRIMARY KEY,
            school VARCHAR(100) NOT NULL,
            programme VARCHAR(150) NOT NULL,
            semester VARCHAR(5) NOT NULL,
            module_code VARCHAR(20) NOT NULL,
            module_name VARCHAR(150) NOT NULL,
            UNIQUE KEY programme_code (programme, module_code),
            INDEX (programme, semester)
        )`)],
    ['programme_modules starter list', async () => {
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM programme_modules');
        if (Number(n) > 0) return;
        const { modules } = require('../data/programme-modules.json');
        if (!modules.length) return;
        await pool.query(
            'INSERT IGNORE INTO programme_modules (school, programme, semester, module_code, module_name) VALUES ?',
            [modules.map(m => [m.school, m.programme, m.semester, m.module_code, m.module_name])]);
        console.log(`Loaded ${modules.length} starter programme modules.`);
    }],
    // Each timetable paper belongs to one semester of a programme
    ['exam_timetable.semester', () => ensureColumn('exam_timetable', 'semester', 'VARCHAR(5) NULL')],

    // --- Semester registration ---
    // Every student starts in Semester I; it moves up each time a semester registration is approved.
    ['students.current_semester default I', () => pool.query(
        "ALTER TABLE students MODIFY current_semester VARCHAR(20) NULL DEFAULT 'I'")],
    ['students without a semester start in I', () => pool.query(
        "UPDATE students SET current_semester = 'I' WHERE current_semester IS NULL OR current_semester = ''")],
    // A registration window, e.g. "January 2027 Registration", with its minimum fees paid (40% by default)
    ['registration_periods table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS registration_periods (
            period_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            min_paid_pct TINYINT NOT NULL DEFAULT 40,
            is_open TINYINT(1) NOT NULL DEFAULT 1,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`)],
    // One row per student per registration window = the student's registration history.
    // Approvals in order: Accounts (automatic from fees) -> Class Advisor -> HOD -> Dean of Students -> Dean (Academic)
    ['semester_registrations table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS semester_registrations (
            reg_id INT AUTO_INCREMENT PRIMARY KEY,
            period_id INT NOT NULL,
            student_id INT NOT NULL,
            semester VARCHAR(5) NOT NULL,
            prev_semester VARCHAR(5) NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'pending',
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at DATETIME NULL,
            accounts_status VARCHAR(10) NULL,  accounts_by INT NULL,  accounts_at DATETIME NULL,  accounts_note VARCHAR(300) NULL,
            advisor_status  VARCHAR(10) NULL,  advisor_by  INT NULL,  advisor_at  DATETIME NULL,  advisor_note  VARCHAR(300) NULL,
            hod_status      VARCHAR(10) NULL,  hod_by      INT NULL,  hod_at      DATETIME NULL,  hod_note      VARCHAR(300) NULL,
            dos_status      VARCHAR(10) NULL,  dos_by      INT NULL,  dos_at      DATETIME NULL,  dos_note      VARCHAR(300) NULL,
            academic_status VARCHAR(10) NULL,  academic_by INT NULL,  academic_at DATETIME NULL,  academic_note VARCHAR(300) NULL,
            UNIQUE KEY one_per_period (period_id, student_id),
            INDEX (student_id),
            INDEX (status)
        )`)],
    // Direct entry / exemptions: semesters a student does not have to take (e.g. Semesters I–II for a
    // direct-entry student who already holds a diploma). Registration skips exempted semesters.
    ['students.entry_type', () => ensureColumn('students', 'entry_type', "VARCHAR(10) NOT NULL DEFAULT 'regular'")],
    ['student_exemptions table', () => pool.query(`
        CREATE TABLE IF NOT EXISTS student_exemptions (
            exemption_id INT AUTO_INCREMENT PRIMARY KEY,
            student_id INT NOT NULL,
            from_semester VARCHAR(5) NOT NULL,
            to_semester VARCHAR(5) NOT NULL,
            reason VARCHAR(300) NOT NULL,
            granted_by INT NULL,
            granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (student_id)
        )`)]
];

// Runs every step in order. Returns the list of steps that failed (empty = all good).
async function migrate() {
    const failed = [];
    for (const [label, step] of STEPS) {
        try {
            await withRetry(label, step);
        } catch (err) {
            failed.push(label);
            console.error(`  Database setup failed at ${label}: ${err.message}`);
        }
    }
    if (failed.length === 0) console.log('Database ready.');
    return failed;
}

module.exports = migrate;
