// Makes sure an ENUM column accepts the given values (safe to run on every server start).
// Keeps the column's existing values, NULL-ability and default; only appends what is missing.
// Does nothing if the column is not an ENUM (e.g. a plain VARCHAR already accepts anything).
const pool = require('../db');

async function ensureEnumValues(table, column, values) {
    const [[col]] = await pool.query(
        `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]);
    if (!col || !/^enum\(/i.test(col.COLUMN_TYPE)) return;

    // Parse enum('a','b','it''s') into ['a', 'b', "it's"]
    const existing = [...col.COLUMN_TYPE.slice(5, -1).matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));
    const missing = values.filter(v => !existing.includes(v));
    if (!missing.length) return;

    const all = [...existing, ...missing].map(v => pool.escape(v)).join(', ');
    const nullSql = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
    const defSql = col.COLUMN_DEFAULT === null ? '' : ` DEFAULT ${pool.escape(col.COLUMN_DEFAULT.replace(/^'(.*)'$/, '$1'))}`;
    await pool.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${all}) ${nullSql}${defSql}`);
    console.log(`Added ${missing.join(', ')} to ${table}.${column}`);
}

module.exports = ensureEnumValues;
