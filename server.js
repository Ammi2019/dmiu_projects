const express = require('express');
const migrate = require('./utils/migrate');
require('dotenv').config();

if (!process.env.SECRET) {
    console.error('FATAL: SECRET is not set in .env — refusing to start.');
    process.exit(1);
}

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const courseRoutes = require('./routes/courses');
const lecturersRoutes = require('./routes/lecturers');
const studentsRoutes = require('./routes/students');
const sectionsRoutes = require('./routes/sections');
const enrollmentsRoutes = require('./routes/enrollments');
const adminRoutes = require('./routes/admin');
const applicationsRoutes = require('./routes/applications');
const profileRoutes = require('./routes/profile');
const programmesRoutes = require('./routes/programmes');
const assignmentsRoutes = require('./routes/assignments');
const resultsRoutes = require('./routes/results');
const staffRoutes = require('./routes/staff');
const feesRoutes = require('./routes/fees');
const notificationsRoutes = require('./routes/notifications');
const notesRoutes = require('./routes/notes');
const examsRoutes = require('./routes/exams');
const registrationRoutes = require('./routes/registration');
const { startReminderSchedule } = require('./utils/feeReminders');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the frontend (login pages, css/, js/) from public/
app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/lecturers', lecturersRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/sections', sectionsRoutes);
app.use('/api/enrollments', enrollmentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/programmes', programmesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/registration', registrationRoutes);

app.get('/', (req, res) => {
    res.send('University website running.');
});

const PORT = process.env.PORT || 3000;

// Set up the database first (one step at a time), then start accepting requests
migrate()
    .catch(err => console.error('Database setup error:', err.message))
    .finally(() => {
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
        startReminderSchedule(); // checks for due fee reminders every few hours
    });
