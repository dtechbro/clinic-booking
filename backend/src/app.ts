import express from 'express';
import helmet from 'helmet';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = z.uuid();
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bookingInput = z.object({slot_id: uuid, patient_name: z.string().trim().min(2).max(100), patient_email: z.email().max(254).transform(s => s.toLowerCase())}).strict();
const positiveInt = (max: number, fallback: number) => z.coerce.number().int().min(1).max(max).default(fallback);
class ApiError extends Error {
 constructor(public status: number, public code: string, message: string) { super(message); }
}
function patientHash(req: express.Request) {
 const result = tokenSchema.safeParse(req.get('X-Patient-Token'));
 if (!result.success) throw new ApiError(401, 'patient_token_required', 'A valid X-Patient-Token is required.');
 return hash(result.data);
}
async function transaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>) {
 const db = await pool.connect();
 try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
 catch (error) { await db.query('ROLLBACK'); throw error; }
 finally { db.release(); }
}
export function createApp(pool: Pool, apiKey: string, options: {bookingLimit?: number} = {}) {
 if (apiKey.length < 32) throw new Error('API_KEY must be at least 32 characters');
 const app = express();
 app.disable('x-powered-by');
 app.set('trust proxy', 1); // Render runs behind one trusted ingress proxy.
 app.use(helmet());
 app.get('/health', async (_req, res) => {await pool.query('SELECT 1'); res.json({status:'ok'});});
 app.use('/api', (req, res, next) => {
  const actual = Buffer.from(hash(req.get('X-API-Key') ?? ''));
  if (!timingSafeEqual(actual, Buffer.from(hash(apiKey)))) return res.status(401).json({error:{code:'unauthorized',message:'A valid X-API-Key is required.'}});
  res.set('Cache-Control','no-store'); next();
 });
 app.use(express.json({limit:'8kb'}));
 app.get('/api/slots', async (req, res) => {
  const query = z.object({page:positiveInt(100000,1),limit:positiveInt(100,20),date:z.iso.date().optional()}).strict().parse(req.query);
  const values: unknown[] = [];
  let filter = `s.starts_at > now() AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed')`;
  if (query.date) { values.push(query.date); filter += ` AND (s.starts_at AT TIME ZONE 'UTC')::date = $1::date`; }
  values.push(query.limit + 1, (query.page - 1)*query.limit);
  const result = await pool.query(`SELECT s.* FROM slots s WHERE ${filter} ORDER BY starts_at, id LIMIT $${values.length-1} OFFSET $${values.length}`,values);
  res.json({data:result.rows.slice(0,query.limit),page:query.page,limit:query.limit,has_more:result.rows.length>query.limit});
 });
 app.post('/api/bookings', async (req, res) => {
  // Count attempts independently of booking transactions, including rejected submissions.
  const clientIP = req.get('X-Client-IP') || req.ip || 'unknown';
  for (const [key, limit] of [[`client:${hash(clientIP)}`,options.bookingLimit ?? 10],['global',100]] as const) {
   const counter = await pool.query(`INSERT INTO rate_limits(key,window_start,hits) VALUES ($1,date_trunc('minute',now()),1)
    ON CONFLICT (key) DO UPDATE SET
     hits=CASE WHEN rate_limits.window_start=date_trunc('minute',now()) THEN rate_limits.hits+1 ELSE 1 END,
     window_start=date_trunc('minute',now()) RETURNING hits`,[key]);
   if (counter.rows[0].hits > limit) throw new ApiError(429,'rate_limited','Too many booking attempts. Try again in one minute.');
  }
  const input = bookingInput.parse(req.body);
  const suppliedToken = req.get('X-Patient-Token');
  if (suppliedToken !== undefined) tokenSchema.parse(suppliedToken);
  const idempotencyKey = req.get('Idempotency-Key');
  if (idempotencyKey !== undefined) z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(idempotencyKey);
  const fingerprint = hash(JSON.stringify([input, suppliedToken ?? null]));
  const result = await transaction(pool, async db => {
   if (idempotencyKey) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[idempotencyKey]);
    const prior = await db.query('SELECT * FROM idempotency WHERE key=$1',[idempotencyKey]);
    if (prior.rowCount) {
     if (prior.rows[0].fingerprint !== fingerprint) throw new ApiError(409,'idempotency_conflict','This key was already used with different details.');
     return {body:prior.rows[0].response,replayed:true};
    }
   }
   const slot = await db.query('SELECT * FROM slots WHERE id=$1 FOR UPDATE',[input.slot_id]);
   if (!slot.rowCount) throw new ApiError(404,'slot_not_found','Slot not found.');
   if (new Date(slot.rows[0].starts_at) <= new Date()) throw new ApiError(409,'slot_unavailable','This slot has already started.');
   const token = suppliedToken ?? randomBytes(32).toString('hex');
   const booking = await db.query(`INSERT INTO bookings(slot_id,patient_name,patient_email,patient_token_hash)
    VALUES ($1,$2,$3,$4) RETURNING id,slot_id,patient_name,patient_email,status,created_at,cancelled_at`,[input.slot_id,input.patient_name,input.patient_email,hash(token)]);
   const body = {data:{...booking.rows[0],starts_at:slot.rows[0].starts_at,ends_at:slot.rows[0].ends_at},patient_token:token};
   if (idempotencyKey) await db.query('INSERT INTO idempotency(key,fingerprint,response) VALUES ($1,$2,$3)',[idempotencyKey,fingerprint,JSON.stringify(body)]);
   return {body,replayed:false};
  });
  if (result.replayed) res.set('Idempotency-Replayed','true');
  res.status(201).json(result.body);
 });
 app.get('/api/bookings', async (req,res) => {
  const tokenHash = patientHash(req);
  const {page,limit} = z.object({page:positiveInt(100000,1),limit:positiveInt(100,10)}).strict().parse(req.query);
  const rows = await pool.query(`SELECT b.id,b.slot_id,b.patient_name,b.patient_email,b.status,b.created_at,b.cancelled_at,s.starts_at,s.ends_at
   FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE patient_token_hash=$1 ORDER BY b.created_at DESC,b.id DESC LIMIT $2 OFFSET $3`,[tokenHash,limit+1,(page-1)*limit]);
  res.json({data:rows.rows.slice(0,limit),page,limit,has_more:rows.rows.length>limit});
 });
 app.get('/api/bookings/:id', async (req,res) => {
  const id=uuid.parse(req.params.id); const tokenHash=patientHash(req);
  const result=await pool.query(`SELECT b.id,b.slot_id,b.patient_name,b.patient_email,b.status,b.created_at,b.cancelled_at,s.starts_at,s.ends_at FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=$1 AND patient_token_hash=$2`,[id,tokenHash]);
  if (!result.rowCount) throw new ApiError(404,'booking_not_found','Booking not found.');
  res.json({data:result.rows[0]});
 });
 app.delete('/api/bookings/:id', async (req,res) => {
  const id=uuid.parse(req.params.id); const tokenHash=patientHash(req);
  const result=await pool.query(`UPDATE bookings SET status='cancelled',cancelled_at=COALESCE(cancelled_at,now()) WHERE id=$1 AND patient_token_hash=$2 RETURNING id,slot_id,status,cancelled_at`,[id,tokenHash]);
  if (!result.rowCount) throw new ApiError(404,'booking_not_found','Booking not found.');
  res.json({data:result.rows[0]});
 });
 app.use((_req,res) => res.status(404).json({error:{code:'not_found',message:'Route not found.'}}));
 app.use((error: any,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({error:{code:'validation_error',message:'Check your request details.',details:error.issues.map(i=>({field:i.path.join('.'),message:i.message}))}});
  if (error instanceof ApiError) {if(error.status===429)res.set('Retry-After','60');return res.status(error.status).json({error:{code:error.code,message:error.message}});}
  if(error.code==='23505') return res.status(409).json({error:{code:'slot_unavailable',message:'This slot has already been booked.'}});
  if(error.type==='entity.parse.failed') return res.status(400).json({error:{code:'invalid_json',message:'Request body must be valid JSON.'}});
  if(error.type==='entity.too.large') return res.status(413).json({error:{code:'body_too_large',message:'Request body is too large.'}});
  console.error('Request failed:',error.code ?? error.name);
  res.status(500).json({error:{code:'internal_error',message:'Something went wrong. Please try again.'}});
 });
 return app;
}
