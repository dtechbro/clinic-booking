import { makePool } from './db.js';
import { schema } from './schema.js';
const pool = makePool();
try { await pool.query(schema); console.log('Database schema ready'); }
finally { await pool.end(); }
