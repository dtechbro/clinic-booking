import {after,before,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomBytes} from 'node:crypto';
import {makePool} from '../src/db.js';
import {schema} from '../src/schema.js';
import {createApp} from '../src/app.js';
const testURL=process.env.TEST_DATABASE_URL;
if(!testURL || new URL(testURL).pathname!=='/clinic_test')throw new Error('TEST_DATABASE_URL must point to a dedicated database named clinic_test. Tests erase its tables.');
const pool=makePool(testURL);
const key='test-api-key-that-is-at-least-32-characters';
const app=createApp(pool,key,{bookingLimit:100});
const auth={'X-API-Key':key};
const input=(id:string)=>({slot_id:id,patient_name:'Ada Okafor',patient_email:'ada@example.com'});
let slots:string[];
before(async()=>{await pool.query(schema);});
beforeEach(async()=>{
 await pool.query('TRUNCATE bookings,slots,idempotency,rate_limits CASCADE');
 const result=await pool.query(`INSERT INTO slots(starts_at,ends_at) SELECT now()+i*interval '1 day',now()+i*interval '1 day'+interval '30 minutes' FROM generate_series(1,25)i RETURNING id`);slots=result.rows.map(r=>r.id);
});
after(async()=>{await pool.end();});
test('Level 1: health, available slots, create and lookup a persisted booking',async()=>{
 await request(app).get('/health').expect(200,{status:'ok'});
 const available=await request(app).get('/api/slots').set(auth).expect(200);assert.equal(available.body.data.length,20);assert.equal(available.body.has_more,true);
 const created=await request(app).post('/api/bookings').set(auth).send(input(slots[0])).expect(201);
 assert.equal(created.body.data.status,'confirmed');assert.match(created.body.patient_token,/^[a-f0-9]{64}$/);
 const secondProcess=createApp(pool,key);
 const found=await request(secondProcess).get(`/api/bookings/${created.body.data.id}`).set(auth).set('X-Patient-Token',created.body.patient_token).expect(200);
 assert.equal(found.body.data.patient_name,'Ada Okafor');
 const remaining=await request(app).get('/api/slots?limit=100').set(auth).expect(200);assert.equal(remaining.body.data.length,24);
});
test('Level 2: missing and incorrect API keys are rejected on all booking routes',async()=>{
 for(const method of ['get','post','delete'] as const){const path=method==='delete'?`/api/bookings/${slots[0]}`:'/api/bookings';await request(app)[method](path).expect(401);}
 await request(app).get('/api/slots').set('X-API-Key','wrong').expect(401);
});
test('Level 2: reject missing fields, invalid email, UUID, short name and extra details',async()=>{
 for(const body of [{},{...input(slots[0]),patient_email:'bad'},{...input(slots[0]),slot_id:'nope'},{...input(slots[0]),patient_name:' '},{...input(slots[0]),role:'admin'}]){
  const response=await request(app).post('/api/bookings').set(auth).send(body).expect(400);assert.equal(response.body.error.code,'validation_error');
 }
 assert.equal((await pool.query('SELECT * FROM bookings')).rowCount,0);
});
test('Level 2: malformed JSON, invalid query and missing slot produce useful errors',async()=>{
 await request(app).post('/api/bookings').set(auth).set('Content-Type','application/json').send('{').expect(400);
 await request(app).get('/api/slots?limit=0').set(auth).expect(400);
 await request(app).get('/api/slots?date=2026-02-30').set(auth).expect(400);
 await request(app).post('/api/bookings').set(auth).send(input('00000000-0000-4000-8000-000000000000')).expect(404);
});
test('Level 3: twenty simultaneous requests can only create one booking',async()=>{
 const responses=await Promise.all(Array.from({length:20},()=>request(app).post('/api/bookings').set(auth).send(input(slots[0]))));
 assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(responses.filter(r=>r.status===409).length,19);
 assert.equal((await pool.query('SELECT * FROM bookings')).rowCount,1);
});
test('Level 3: cancellation is repeatable and makes the slot bookable again',async()=>{
 const created=await request(app).post('/api/bookings').set(auth).send(input(slots[0])).expect(201);
 const headers={...auth,'X-Patient-Token':created.body.patient_token};
 await request(app).delete(`/api/bookings/${created.body.data.id}`).set(headers).expect(200);
 await request(app).delete(`/api/bookings/${created.body.data.id}`).set(headers).expect(200);
 await request(app).post('/api/bookings').set(auth).send(input(slots[0])).expect(201);
});
test('Patient access codes protect lookup, cancellation and booking lists',async()=>{
 const created=await request(app).post('/api/bookings').set(auth).send(input(slots[0])).expect(201);
 await request(app).get('/api/bookings').set(auth).expect(401);
 const other={...auth,'X-Patient-Token':randomBytes(32).toString('hex')};
 await request(app).get(`/api/bookings/${created.body.data.id}`).set(other).expect(404);
 await request(app).delete(`/api/bookings/${created.body.data.id}`).set(other).expect(404);
 const listed=await request(app).get('/api/bookings').set(other).expect(200);assert.deepEqual(listed.body.data,[]);
});
test('Level 4: simultaneous retries return the same booking and access code',async()=>{
 const responses=await Promise.all(Array.from({length:12},()=>request(app).post('/api/bookings').set(auth).set('Idempotency-Key','retry-same-request').send(input(slots[0]))));
 for(const r of responses){assert.equal(r.status,201);assert.deepEqual(r.body,responses[0].body);}
 assert.equal((await pool.query('SELECT * FROM bookings')).rowCount,1);
 assert.equal(responses.filter(r=>r.headers['idempotency-replayed']==='true').length,11);
});
test('Level 4: reused keys reject changed requests and replay after cancellation',async()=>{
 const created=await request(app).post('/api/bookings').set(auth).set('Idempotency-Key','stable-request-key').send(input(slots[0])).expect(201);
 await request(app).post('/api/bookings').set(auth).set('Idempotency-Key','stable-request-key').send(input(slots[1])).expect(409);
 await request(app).delete(`/api/bookings/${created.body.data.id}`).set(auth).set('X-Patient-Token',created.body.patient_token).expect(200);
 const replay=await request(app).post('/api/bookings').set(auth).set('Idempotency-Key','stable-request-key').send(input(slots[0])).expect(201);assert.deepEqual(replay.body,created.body);
});
test('Level 4: patient bookings paginate without overlap and omit private hashes',async()=>{
 const token=randomBytes(32).toString('hex');const headers={...auth,'X-Patient-Token':token};
 for(const slot of slots.slice(0,3))await request(app).post('/api/bookings').set(headers).send(input(slot)).expect(201);
 const first=await request(app).get('/api/bookings?page=1&limit=2').set(headers).expect(200);
 const second=await request(app).get('/api/bookings?page=2&limit=2').set(headers).expect(200);
 assert.equal(first.body.has_more,true);assert.equal(second.body.has_more,false);
 assert.equal(new Set([...first.body.data,...second.body.data].map(b=>b.id)).size,3);
 assert.equal(first.body.data[0].patient_token_hash,undefined);
});
test('Level 5: limits survive across API instances and include invalid attempts',async()=>{
 const limited=createApp(pool,key,{bookingLimit:2});const other=createApp(pool,key,{bookingLimit:2});
 await request(limited).post('/api/bookings').set(auth).send({}).expect(400);
 await request(other).post('/api/bookings').set(auth).send(input(slots[0])).expect(201);
 const stopped=await request(limited).post('/api/bookings').set(auth).send(input(slots[1])).expect(429);assert.equal(stopped.headers['retry-after'],'60');
 await pool.query("UPDATE rate_limits SET window_start=now()-interval '2 minutes'");
 await request(limited).post('/api/bookings').set(auth).send(input(slots[1])).expect(201);
});
test('Level 5: global limit prevents bypass by rotating client IPs',async()=>{
 await pool.query("INSERT INTO rate_limits VALUES ('global',date_trunc('minute',now()),100)");
 await request(app).post('/api/bookings').set(auth).set('X-Client-IP','different-client').send(input(slots[0])).expect(429);
});
test('Past appointments cannot be booked and never appear in availability',async()=>{
 const past=await pool.query("INSERT INTO slots(starts_at,ends_at) VALUES (now()-interval '2 hours',now()-interval '1 hour') RETURNING id");
 await request(app).post('/api/bookings').set(auth).send(input(past.rows[0].id)).expect(409);
 const available=await request(app).get('/api/slots?limit=100').set(auth).expect(200);assert.equal(available.body.data.length,25);
});
