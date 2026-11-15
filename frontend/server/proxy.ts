import type { IncomingMessage,ServerResponse } from 'node:http';
// Only this server-side function has the API key. Never use a VITE_ variable for secrets.
export default async function handler(req:IncomingMessage & {body?:unknown},res:ServerResponse) {
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url ?? '/', 'https://local.invalid');
 // Vercel injects dynamic route parameters into the query string.
 // It is routing metadata, not an API query parameter.
 url.searchParams.delete('...path');
 if (/^\/api\/bookings\/[0-9a-f-]{36}$/.test(url.pathname)) url.searchParams.delete('id');
 if(!/^\/api\/(slots|bookings)(\/[0-9a-f-]{36})?$/.test(url.pathname) || !['GET','POST','DELETE'].includes(req.method ?? '')) {
  res.statusCode=404;res.end(JSON.stringify({error:{message:'Route not found.'}}));return;
 }
 if(!process.env.API_URL || !process.env.API_KEY){res.statusCode=503;res.end(JSON.stringify({error:{message:'Booking service is not configured.'}}));return;}
 const headers:Record<string,string>={'X-API-Key':process.env.API_KEY,'Content-Type':'application/json'};
 for(const key of ['x-patient-token','idempotency-key'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
 const ip=req.headers['x-vercel-forwarded-for'];
 headers['X-Client-IP']=typeof ip==='string'?ip.split(',')[0].trim():req.socket.remoteAddress ?? 'unknown';
 try {
  const response=await fetch(`${process.env.API_URL.replace(/\/$/,'')}${url.pathname}${url.search}`,{method:req.method,headers,body:req.method==='POST'?JSON.stringify(req.body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
  res.statusCode=response.status;
  res.setHeader('Content-Type','application/json');
  for(const name of ['retry-after','idempotency-replayed']){const value=response.headers.get(name);if(value)res.setHeader(name,value);}
  res.end(await response.text());
 }catch{res.statusCode=502;res.end(JSON.stringify({error:{message:'Booking service is temporarily unavailable. Please retry.'}}));}
}
