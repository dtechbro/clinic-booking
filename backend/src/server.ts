import { createApp } from './app.js';
import { makePool } from './db.js';
const pool=makePool();
const app=createApp(pool,process.env.API_KEY ?? '');
const server=app.listen(Number(process.env.PORT ?? 3001),'0.0.0.0',()=>console.log('Booking API started'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(()=>{void pool.end().then(()=>process.exit(0));}));
