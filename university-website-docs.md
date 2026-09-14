# University Website — Backend Build Documentation

Project folder: `mini_project`
Stack: Node.js + Express + MySQL (`mysql2`), sessions via `express-session`, password hashing via `bcrypt`

---

## Database

MySQL database: `dmiseu_chipata_campus`

**Tables:**
- `USERS` — central identity/auth table: `user_id`, `name`, `email`, `password` (bcrypt hash), `role` (enum: `student`, `class_teacher`, `head_of_department`), `created_at`
- `LECTURERS` — extends `USERS` via `user_id`: `lecturer_id`, `user_id`, `department_id`, `hire_date`, `salary`
- `students` — extends `USERS` via `user_id`: `student_id`, `user_id`, `date_or_birth`, `enrollment_date`, `department_id`
- `departments` — `department_id`, `name`, `building`, `budget`, `head_lecturer_id` (FK → `LECTURERS`)
- `courses` — `course_id`, `course_code`, `title`, `credits`, `department_id`
- `sections` — a course offered in a term: `section_id`, `course_id`, `lecturer_id`, `semester`, `year`, `room`, `capacity`
- `enrollments` — join table: `enrollment_id`, `student_id`, `section_id`, `grade`, `enrollment` (date)

**Known cosmetic naming inconsistencies (not fixed yet, harmless):**
- `students.date_or_birth` should be `date_of_birth`
- `enrollments.enrollment` should be `enrollment_date`

Fix later with:
```sql
ALTER TABLE students CHANGE date_or_birth date_of_birth DATE;
ALTER TABLE enrollments CHANGE enrollment enrollment_date DATE NOT NULL DEFAULT (CURRENT_DATE);
```

---

## Project Setup

```bash
npm init -y
npm install express mysql2 dotenv bcrypt express-session
npm install --save-dev nodemon
```

- `express` — web framework / routing
- `mysql2` — MySQL driver (using the `/promise` variant for async/await)
- `dotenv` — loads secrets from `.env` into `process.env`
- `bcrypt` — password hashing
- `express-session` — login session management
- `nodemon` (dev only) — auto-restarts server on file changes

`package.json` has a `dev` script:
```json
"scripts": {
  "dev": "nodemon server.js"
}
```
Run the dev server with:
```bash
npm run dev
```

---

## `.env`

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=<your MySQL root password>
DB_NAME=dmiseu_chipata_campus
SESSION_SECRET=<random string>
PORT=3000
```

Never commit this file to version control. If building this as a git repo later, add `.env` to `.gitignore` immediately.

---

## `db.js` — MySQL connection pool

```javascript
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool;
```

A **pool** reuses a set of open connections instead of opening/closing one per request. `connectionLimit: 10` allows up to 10 simultaneous connections; `waitForConnections: true` queues requests instead of failing when all 10 are busy.

---

## `server.js` — main Express app

```javascript
const express = require('express');
const session = require('express-session');
require('dotenv').config();

const authRoutes = require('./routes/auth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

app.use('/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('University website running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

- `express.json()` / `express.urlencoded()` — parse incoming JSON / form data into `req.body`
- `session({...})` — enables `req.session`, backed by a signed cookie (signed using `SESSION_SECRET`, so it can't be forged)
- `app.use('/auth', authRoutes)` — mounts all routes from `routes/auth.js` under the `/auth` prefix

---

## `routes/auth.js` — registration, login, logout

```javascript
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');

const router = express.Router();

router.post('/register', async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).send('All fields are required.');
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO USERS (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, role]
        );

        res.status(201).send('User registered successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Registration failed.');
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send('Email and password are required.');
    }

    try {
        const [rows] = await pool.query(
            'SELECT * FROM USERS WHERE email = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).send('Invalid email or password.');
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).send('Invalid email or password.');
        }

        req.session.userId = user.user_id;
        req.session.role = user.role;

        res.status(200).send('Logged in successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Login failed.');
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Logout failed.');
        }
        res.status(200).send('Logged out successfully.');
    });
});

module.exports = router;
```

**How it works:**
- **Register** — validates input, hashes the password with `bcrypt.hash(password, 10)` (10 = salt rounds/cost factor), inserts into `USERS` using parameterized `?` placeholders (prevents SQL injection).
- **Login** — looks up the user by email, uses `bcrypt.compare(plainPassword, storedHash)` to verify without ever reversing the hash. Uses the same generic "Invalid email or password" message whether the email doesn't exist or the password is wrong — this deliberately avoids revealing which one was incorrect (security best practice, prevents account enumeration). On success, stores `userId` and `role` in `req.session`, which persists across requests via a cookie.
- **Logout** — destroys the session.

---

## `middleware/auth.js` — route protection

```javascript
function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to access this.');
    }
    next();
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).send('You must be logged in to access this.');
        }
        if (!allowedRoles.includes(req.session.role)) {
            return res.status(403).send('You do not have permission to access this.');
        }
        next();
    };
}

module.exports = { requireLogin, requireRole };
```

- `requireLogin` — blocks access (401) unless `req.session.userId` is set
- `requireRole('role1', 'role2', ...)` — blocks access unless the logged-in user's role is in the allowed list (401 if not logged in, 403 if logged in but wrong role)

Used in `server.js` like:
```javascript
app.get('/dashboard', requireLogin, (req, res) => { ... });
app.get('/admin', requireRole('head_of_department'), (req, res) => { ... });
```

Confirmed working: no-login → 401, logged in (wrong role) on admin route → 403, logged in on dashboard → 200.

---

## `routes/departments.js` — CRUD, role-gated

Full CRUD for `departments`. Any logged-in user can `GET` (list/single); only `head_of_department` can `POST`/`PUT`/`DELETE`.

```javascript
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM departments');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch departments.');
    }
});

router.get('/:id', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM departments WHERE department_id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Department not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch department.');
    }
});

router.post('/', requireRole('head_of_department'), async (req, res) => {
    const { name, building, budget } = req.body;

    if (!name) {
        return res.status(400).send('Department name is required.');
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO departments (name, building, budget) VALUES (?, ?, ?)',
            [name, building || null, budget || null]
        );
        res.status(201).json({ department_id: result.insertId, name, building, budget });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create department.');
    }
});

router.put('/:id', requireRole('head_of_department'), async (req, res) => {
    const { name, building, budget } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE departments SET name = ?, building = ?, budget = ? WHERE department_id = ?',
            [name, building, budget, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Department not found.');
        }
        res.send('Department updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update department.');
    }
});

router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM departments WHERE department_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Department not found.');
        }
        res.send('Department deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete department.');
    }
});

module.exports = router;
```

Confirmed working: list (200, []), create as head_of_department (201), permission model matches `/admin` test (student blocked).

---

## `routes/courses.js` — CRUD, role-gated, with JOIN

Same pattern as departments, but reads use a `LEFT JOIN` to `departments` so each course's response includes a human-readable `department_name`, not just the raw `department_id`.

```javascript
const express = require('express');
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT courses.*, departments.name AS department_name FROM courses LEFT JOIN departments ON courses.department_id = departments.department_id'
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch courses.');
    }
});

router.get('/:id', requireLogin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT courses.*, departments.name AS department_name FROM courses LEFT JOIN departments ON courses.department_id = departments.department_id WHERE courses.course_id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).send('Course not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to fetch course.');
    }
});

router.post('/', requireRole('head_of_department'), async (req, res) => {
    const { course_code, title, credits, department_id } = req.body;

    if (!course_code || !title) {
        return res.status(400).send('Course code and title are required.');
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO courses (course_code, title, credits, department_id) VALUES (?, ?, ?, ?)',
            [course_code, title, credits || 3, department_id || null]
        );
        res.status(201).json({ course_id: result.insertId, course_code, title, credits, department_id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to create course.');
    }
});

router.put('/:id', requireRole('head_of_department'), async (req, res) => {
    const { course_code, title, credits, department_id } = req.body;

    try {
        const [result] = await pool.query(
            'UPDATE courses SET course_code = ?, title = ?, credits = ?, department_id = ? WHERE course_id = ?',
            [course_code, title, credits, department_id, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Course not found.');
        }
        res.send('Course updated successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update course.');
    }
});

router.delete('/:id', requireRole('head_of_department'), async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM courses WHERE course_id = ?',
            [req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).send('Course not found.');
        }
        res.send('Course deleted successfully.');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to delete course.');
    }
});

module.exports = router;
```

**Note:** `courses.sections` has `ON DELETE CASCADE` back to `courses` — deleting a course silently deletes all its sections too. Worth being deliberate about before wiring up a delete button in any frontend.

**Note:** `course_code` is `UNIQUE` in the schema; inserting a duplicate currently falls through to a generic 500 error rather than a clear "already exists" message. Flagged as a possible improvement, not yet implemented.

Confirmed working: created CS101 (201), listed back with `department_name: "Computer Science"` correctly joined in.

---

## Testing commands used

**Register a user:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"testpass123","role":"student"}'
```

**Login (saves session cookie to `cookies.txt`):**
```bash
curl -i -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}' \
  -c cookies.txt
```

**Verify a user landed in the database:**
```bash
/usr/local/mysql/bin/mysql -u root -p dmiseu_chipata_campus -e "SELECT user_id, name, email, role FROM USERS;"
```

---

## Status as of this doc

✅ MySQL schema built (7 tables)
✅ Node ↔ MySQL connection pool working
✅ Express server running on port 3000
✅ `/auth/register`, `/auth/login`, `/auth/logout` — all working, tested
✅ `requireLogin` / `requireRole` middleware — working, tested
✅ `/departments` — full CRUD, role-gated (head_of_department for write), tested
✅ `/courses` — full CRUD, role-gated, JOIN to departments for readable output, tested

**Reminder:** sessions are in-memory (`express-session` default store). Every nodemon restart wipes all active sessions — re-login after any code change that triggers a restart.

## Next steps (not yet built)
1. Same CRUD pattern for `LECTURERS` and `students` (both link to `USERS` via `user_id` — creating one likely means creating/linking a USERS row too, worth designing that flow deliberately)
2. `sections` CRUD (course + lecturer + term)
3. Enrollment routes (student enrolls in a section; lecturer views roster; grade entry)
4. Frontend (views/templates or a separate frontend app) to actually use these API routes
5. Fix the two cosmetic column name typos in `students` and `enrollments` tables (see Database section above)
6. Possible improvement: friendlier error message for duplicate `course_code` on create (currently generic 500)
7. Before production: move sessions to a persistent store (e.g. MySQL-backed session table or Redis) so restarts don't log everyone out
