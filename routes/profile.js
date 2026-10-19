const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = express.Router();

const STAFF_ROLES = ['administrator', 'principal', 'dean_of_students', 'dean_academic', 'accountant', 'registrar', 'registry_clerk', 'head_of_department'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'profiles'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const allowedTypes = ['image/png', 'image/jpeg'];

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG and JPEG files are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

function handleUploadErrors(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('Photo is too large. Maximum size is 5MB.');
    }
    return res.status(400).send('Upload error: ' + err.message);
  } else if (err) {
    return res.status(400).send(err.message || 'Upload failed.');
  }
  next();
}

router.get('/', verifyToken, checkRole(...STAFF_ROLES), async (req, res) => {
  try {
    const [userRows] = await pool.query(
      'SELECT user_id, name, email, role FROM USERS WHERE user_id = ?',
      [req.user.id]
    );
    if (userRows.length === 0) return res.status(404).send('User not found.');

    const [profileRows] = await pool.query(
      'SELECT job_title, phone, office, photo_path FROM staff_profiles WHERE user_id = ?',
      [req.user.id]
    );

    const profile = profileRows[0] || { job_title: null, phone: null, office: null, photo_path: null };

    res.json({ ...userRows[0], ...profile });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch profile.');
  }
});

router.put('/', verifyToken, checkRole(...STAFF_ROLES), async (req, res) => {
  const { job_title, phone, office } = req.body;

  try {
    const [existing] = await pool.query(
      'SELECT profile_id FROM staff_profiles WHERE user_id = ?',
      [req.user.id]
    );

    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO staff_profiles (user_id, job_title, phone, office) VALUES (?, ?, ?, ?)',
        [req.user.id, job_title || null, phone || null, office || null]
      );
    } else {
      await pool.query(
        'UPDATE staff_profiles SET job_title = ?, phone = ?, office = ? WHERE user_id = ?',
        [job_title || null, phone || null, office || null, req.user.id]
      );
    }

    res.send('Profile updated successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to update profile.');
  }
});

router.post('/photo', verifyToken, checkRole(...STAFF_ROLES), (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return handleUploadErrors(err, req, res, next);
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No photo uploaded.');
  }

  try {
    const [existing] = await pool.query(
      'SELECT profile_id FROM staff_profiles WHERE user_id = ?',
      [req.user.id]
    );

    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO staff_profiles (user_id, photo_path) VALUES (?, ?)',
        [req.user.id, req.file.path]
      );
    } else {
      await pool.query(
        'UPDATE staff_profiles SET photo_path = ? WHERE user_id = ?',
        [req.file.path, req.user.id]
      );
    }

    res.send('Photo uploaded successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to upload photo.');
  }
});

router.get('/photo', verifyToken, checkRole(...STAFF_ROLES), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT photo_path FROM staff_profiles WHERE user_id = ?',
      [req.user.id]
    );
    if (rows.length === 0 || !rows[0].photo_path) {
      return res.status(404).send('No photo set.');
    }
    res.sendFile(rows[0].photo_path);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch photo.');
  }
});

module.exports = router;
