// Adds a column to a table if it isn't there yet (safe to run on every server start).
const pool = require('../db');

async function ensureColumn(table, column, definition) {
    const [rows] = await pool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (rows.length === 0) {
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`Added column ${table}.${column}`);
    }
}

module.exports = ensureColumn;
