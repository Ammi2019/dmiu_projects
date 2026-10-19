// Who can do what — one place for every staff permission.
const ROLES = {
    STAFF: ['administrator', 'principal', 'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk', 'head_of_department'],

    // Applications: view + add notes / accept or reject
    APP_VIEW: ['administrator', 'principal', 'registrar', 'registry_clerk', 'dean_of_students', 'head_of_department'],
    APP_DECIDE: ['administrator', 'principal', 'registrar'],

    // Student directory, and who also sees contact / next-of-kin details
    STUDENT_DIR: ['administrator', 'principal', 'registrar', 'registry_clerk', 'dean_of_students', 'head_of_department', 'accountant'],
    STUDENT_CONTACT: ['administrator', 'registrar', 'registry_clerk', 'dean_of_students'],

    // Lecturer list
    LECTURER_DIR: ['administrator', 'principal', 'head_of_department', 'registrar'],

    // Fees: record payments / bill students, or view only
    FEE_MANAGE: ['accountant', 'administrator'],
    FEE_VIEW: ['accountant', 'administrator', 'principal', 'registrar'],

    // Who can send announcements (a Head of Department only to their own school)
    ANNOUNCE: ['administrator', 'principal', 'registrar', 'dean_of_students', 'accountant', 'head_of_department'],

    // Exams: who sets up exam sessions + timetables, and who can see the clearance board
    EXAM_MANAGE: ['administrator', 'registrar', 'dean_academic'],
    EXAM_VIEW: ['administrator', 'principal', 'registrar', 'dean_academic', 'dean_of_students', 'head_of_department', 'accountant', 'registry_clerk'],
    // Who keeps the hall-ticket details (register no, semester) and who marks hostel residents
    EXAM_DETAILS: ['administrator', 'registrar', 'registry_clerk'],
    HOSTEL: ['administrator', 'dean_of_students'],

    // Roles limited to a single school
    SCHOOL_SCOPED: ['head_of_department']
};

const ROLE_LABELS = {
    administrator: 'Administrator',
    principal: 'Principal',
    dean_of_students: 'Dean of Students',
    dean_academic: 'Dean (Academic)',
    accountant: 'Accountant',
    registrar: 'Registrar',
    registry_clerk: 'Registry Clerk',
    head_of_department: 'Head of Department',
    lecturer: 'Lecturer',
    class_teacher: 'Class Teacher',
    student: 'Student'
};

module.exports = { ROLES, ROLE_LABELS };
