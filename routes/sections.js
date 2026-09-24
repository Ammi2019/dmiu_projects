// routes/sections.js
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET all sections — joined with course title and lecturer name
router.get('/', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sections.section_id, sections.course_id, sections.lecturer_id,
              sections.semester, sections.year, sections.room, sections.capacity,
              courses.title AS course_title,
              USERS.name AS lecturer_name
       FROM sections
       JOIN courses ON sections.course_id = courses.course_id
       JOIN LECTURERS ON sections.lecturer_id = LECTURERS.lecturer_id
       JOIN USERS ON LECTURERS.user_id = USERS.user_id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch sections.');
  }
});

// GET single section
router.get('/:id', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT sections.section_id, sections.course_id, sections.lecturer_id,
              sections.semester, sections.year, sections.room, sections.capacity,
              courses.title AS course_title,
              USERS.name AS lecturer_name
       FROM sections
       JOIN courses ON sections.course_id = courses.course_id
       JOIN LECTURERS ON sections.lecturer_id = LECTURERS.lecturer_id
       JOIN USERS ON LECTURERS.user_id = USERS.user_id
       WHERE sections.section_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Section not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch section.');
  }
});

// CREATE section — restricted to head_of_department
router.post('/', requireRole('head_of_department'), async (req, res) => {
  const { course_id, lecturer_id, semester, year, room, capacity } = req.body;

  if (!course_id || !lecturer_id || !semester || !year) {
    return res.status(400).send('Course, lecturer, semester, and year are required.');
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO sections (course_id, lecturer_id, semester, year, room, capacity) VALUES (?, ?, ?, ?, ?, ?)',
      [course_id, lecturer_id, semester, year, room || null, capacity || null]
    );
    res.status(201).json({ section_id: result.insertId, course_id, lecturer_id, semester, year, room, capacity });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create section.');
  }
});

// UPDATE section
router.put('/:id', requireRole('head_of_department'), async (req, res) => {
  const { course_id, lecturer_id, semester, year, room, capacity } = req.body;

  try {
    const [result] = await pool.query(
      'UPDATE sections SET course_id = ?, lecturer_id = ?, semester = ?, year = ?, room = ?, capacity = ? WHERE section_id = ?',
      [course_id, lecturer_id, semester, year, room, capacity, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Section not found.');
    }
    res.send('Section updated successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update section.');
  }
});

// DELETE section
router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM sections WHERE section_id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Section not found.');
    }
    res.send('Section deleted successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to delete section.');
  }
});

module.exports = router;

