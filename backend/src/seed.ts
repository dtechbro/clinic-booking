import { makePool } from './db.js';
const pool = makePool();
try {
 const result = await pool.query(`INSERT INTO slots(starts_at, ends_at)
 SELECT t, t + interval '30 minutes' FROM (
 SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') + d * interval '1 day' + h * interval '1 hour') AT TIME ZONE 'UTC' AS t
 FROM generate_series(1,14) d CROSS JOIN generate_series(9,16) h
 ) times ON CONFLICT (starts_at) DO NOTHING`);
 console.log(`Added ${result.rowCount} demo slots (09:00–16:30 UTC over the next 14 days)`);
} finally { await pool.end(); }
