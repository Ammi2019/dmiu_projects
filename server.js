const express = require('express');
const session = require('express-session');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const departmentRoutes = require('./routes/departments');
const courseRoutes = require('./routes/courses');
const lecturersRoutes = require('./routes/lecturers');
const studentsRoutes = require('./routes/students');
const sectionsRoutes = require('./routes/sections');
const enrollmentsRoutes = require('./routes/enrollments');
const { requireLogin, requireRole } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// Serve the frontend (login.html, register.html, css/, js/) from public/
app.use(express.static('public'));

app.use('/auth', authRoutes);
app.use('/departments', departmentRoutes);
app.use('/courses', courseRoutes);
app.use('/lecturers', lecturersRoutes);
app.use('/students', studentsRoutes);
app.use('/sections', sectionsRoutes);
app.use('/enrollments', enrollmentsRoutes);

app.get('/', (req, res) => {
    res.send('University website running.');
});

app.get('/dashboard', requireLogin, (req, res) => {
    res.send(`Welcome, user ${req.session.userId}. Your role is ${req.session.role}.`);
});

app.get('/admin', requireRole('head_of_department'), (req, res) => {
    res.send('Welcome to the admin panel.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
