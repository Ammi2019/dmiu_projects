// Public list of schools, programmes and fees (source: data/programmes.json).
// Edit data/programmes.json to rename schools, move programmes or change fees —
// the Programmes tab and the application form both read from here.
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '..', 'data', 'programmes.json');

// Read fresh on each request so edits to the JSON show up without restarting
function loadProgrammes() {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Find a programme by its exact name; returns { programme, school } or null
function findProgramme(name) {
    for (const school of loadProgrammes().schools) {
        const programme = school.programmes.find(p => p.name === name);
        if (programme) return { programme, school };
    }
    return null;
}

// Find a school by its exact name; returns the school (with its programmes) or null
function findSchool(name) {
    return loadProgrammes().schools.find(s => s.name === name) || null;
}

router.get('/', (req, res) => {
    try {
        res.json(loadProgrammes());
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to load programmes.');
    }
});

module.exports = router;
module.exports.findProgramme = findProgramme;
module.exports.findSchool = findSchool;
