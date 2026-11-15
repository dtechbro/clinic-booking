// Local smoke-test server for the built page and the actual Vercel proxy function.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import slotsHandler from '../frontend/api/slots.js';
import bookingsHandler from '../frontend/api/bookings.js';
import bookingHandler from '../frontend/api/bookings/[id].js';
const root=resolve('frontend/dist');
createServer(async(req,res)=>{
 try{
  const path=new URL(req.url??'/','http://local').pathname;
  if(path.startsWith('/api/')){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){res.statusCode=413;res.end();return;}}
   const handler=path==='/api/slots'?slotsHandler:path==='/api/bookings'?bookingsHandler:/^\/api\/bookings\/[^/]+$/.test(path)?bookingHandler:null;
   if(!handler){res.statusCode=404;res.end('The page could not be found');return;}
   await handler(Object.assign(req,{body:body?JSON.parse(body):undefined}),res);return;
  }
  const file=resolve(root,`.${path==='/'?'/index.html':path}`);
  if(!file.startsWith(root+'/')){res.statusCode=404;res.end();return;}
  const types:Record<string,string>={'.html':'text/html','.css':'text/css','.js':'text/javascript'};
  res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.statusCode=500;res.end('Preview request failed');}
}).listen(4173,'127.0.0.1',()=>console.log('Production smoke-test server listening'));
