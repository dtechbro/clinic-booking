import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
type Slot={id:string;starts_at:string;ends_at:string};
type Booking=Slot&{slot_id:string;patient_name:string;patient_email:string;status:'confirmed'|'cancelled';created_at:string};
type Page<T>={data:T[];page:number;has_more:boolean};
const time=(value:string)=>new Date(value).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
const day=(value:string)=>new Date(value).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
const tokenKey='carewell-patient-token';
async function api(path:string,init:RequestInit={}){
 const token=localStorage.getItem(tokenKey);
 const response=await fetch(`/api${path}`,{...init,headers:{'Content-Type':'application/json',...(token?{'X-Patient-Token':token}:{}),...init.headers}});
 let body;
 try { body=await response.json(); }
 catch { throw new Error('The booking service returned an unexpected response. Please try again.'); }
 if(!response.ok)throw new Error(body.error?.message || 'Unable to complete your request.');
 return body;
}
function App(){
 const [tab,setTab]=useState<'book'|'bookings'>('book');
 const [slots,setSlots]=useState<Page<Slot>>({data:[],page:1,has_more:false});
 const [bookings,setBookings]=useState<Page<Booking>>({data:[],page:1,has_more:false});
 const [date,setDate]=useState('');const [slotPage,setSlotPage]=useState(1);const [bookingPage,setBookingPage]=useState(1);
 const [selected,setSelected]=useState<Slot|null>(null);const [confirmation,setConfirmation]=useState<Booking|null>(null);
 const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);const [refresh,setRefresh]=useState(0);
 const [name,setName]=useState('');const [email,setEmail]=useState('');const [pending,setPending]=useState<{body:string;key:string}|null>(null);
 const [lookup,setLookup]=useState('');const [recovery,setRecovery]=useState('');
 useEffect(()=>{
  let current=true;setLoading(true);setError('');
  const request=tab==='book'?api(`/slots?page=${slotPage}&limit=12${date?`&date=${date}`:''}`):localStorage.getItem(tokenKey)?api(`/bookings?page=${bookingPage}&limit=5`):Promise.resolve({data:[],page:1,has_more:false});
  request.then(result=>{if(current){if(tab==='book')setSlots(result);else setBookings(result);}}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;};
 },[tab,date,slotPage,bookingPage,refresh]);
 async function book(event:React.FormEvent){
  event.preventDefault();if(!selected)return;setBusy(true);setError('');
  try{
   const body=JSON.stringify({slot_id:selected.id,patient_name:name.trim(),patient_email:email.trim().toLowerCase()});
   // Keep the same key after a network failure, including a refresh of the page.
   const stored=JSON.parse(sessionStorage.getItem('carewell-pending') || 'null');
   const attempt=pending?.body===body?pending:stored?.body===body?stored:{body,key:crypto.randomUUID()};
   setPending(attempt);sessionStorage.setItem('carewell-pending',JSON.stringify(attempt));
   const result=await api('/bookings',{method:'POST',body,headers:{'Idempotency-Key':attempt.key}});
   localStorage.setItem(tokenKey,result.patient_token);setConfirmation(result.data);setSelected(null);setPending(null);sessionStorage.removeItem('carewell-pending');setRefresh(v=>v+1);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function cancel(id:string){
  if(!window.confirm('Cancel this appointment? The slot will become available to other patients.'))return;
  setBusy(true);setError('');try{await api(`/bookings/${id}`,{method:'DELETE'});setRefresh(v=>v+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function find(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{const result=await api(`/bookings/${encodeURIComponent(lookup.trim())}`);setConfirmation(result.data);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const activePage=tab==='book'?slots:bookings;
 return <><header><a className="brand" href="/" aria-label="Carewell home"><span className="brand-icon">+</span>carewell<span className="brand-dot">.</span></a><span className="header-label">YOUR HEALTH, YOUR TIME</span></header>
 <main><section className="intro"><span className="eyebrow"><span className="dot"/> CLINIC APPOINTMENTS</span><h1>A little time for <br/><em>better health.</em></h1><p>Find a time that works for you.<br/>Book your next clinic visit in a few simple steps.</p><div className="intro-note"><span>✦</span><p>Less waiting.<br/><strong>More time for you.</strong></p></div><span className="abstract" aria-hidden="true">+</span></section>
 <section className="workspace" aria-label="Appointment booking"><nav><button className={tab==='book'?'active':''} onClick={()=>{setTab('book');setConfirmation(null);}}>Book a visit</button><button className={tab==='bookings'?'active':''} onClick={()=>{setTab('bookings');setConfirmation(null);}}>My appointments</button></nav>
 {error&&<div className="error" role="alert">{error}<button onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>}
 {confirmation?<div className="confirmation" role="status"><span className="success-icon">✓</span><span className="eyebrow">{confirmation.status==='confirmed'?'YOU’RE ALL SET':'APPOINTMENT CANCELLED'}</span><h2>{confirmation.status==='confirmed'?'Your visit is booked.':'Your booking details.'}</h2><p>{confirmation.patient_name}, here are your appointment details.</p><div className="ticket"><strong>{day(confirmation.starts_at)}</strong><span>{time(confirmation.starts_at)} – {time(confirmation.ends_at)}</span><span>Clinic consultation</span><hr/><small>BOOKING REFERENCE</small><code>{confirmation.id}</code><span className={`badge ${confirmation.status}`}>{confirmation.status}</span></div><p className="hint">Save your booking reference. Your appointment access stays in this browser; no email is sent.</p><button className="primary" onClick={()=>{setConfirmation(null);setTab('bookings');}}>View my appointments →</button></div>:
 tab==='book'?<><div className="section-head"><div><span className="eyebrow">01 / CHOOSE YOUR TIME</span><h2>Make room for your health.</h2><p>Available appointments, in your local time.</p></div><span className="mini-cross" aria-hidden="true">✳</span></div><label className="date-label">Filter by date <span>(UTC)</span><input type="date" value={date} onChange={e=>{setDate(e.target.value);setSlotPage(1);setSelected(null);}}/></label>
 {loading?<p className="empty" role="status">Finding available times…</p>:slots.data.length?<div className="slots">{slots.data.map(s=><button className={`slot ${selected?.id===s.id?'selected':''}`} key={s.id} onClick={()=>{setSelected(s);setError('');}} aria-pressed={selected?.id===s.id}><span>{day(s.starts_at)}</span><strong>{time(s.starts_at)}</strong><small>30 min <span>{selected?.id===s.id?'✓':'↗'}</span></small></button>)}</div>:<p className="empty">No available appointments for this selection. Try another date.</p>}
 {selected&&<form className="details" onSubmit={book}><span className="eyebrow">02 / YOUR DETAILS</span><h3>Let’s put your name down.</h3><p>{day(selected.starts_at)} · {time(selected.starts_at)}</p><div className="fields"><label>Full name<input autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name"/></label><label>Email address<input autoComplete="email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label></div><button disabled={busy} className="primary">{busy?'Booking your visit…':'Confirm appointment →'}</button><small className="hint">Your details are used to manage this appointment.</small></form>}</>:
 <><div className="section-head"><div><span className="eyebrow">YOUR CARE, AT A GLANCE</span><h2>My appointments</h2><p>Review your visits or cancel a booking.</p></div></div>{loading?<p className="empty">Loading appointments…</p>:bookings.data.length?<div className="booking-list">{bookings.data.map(b=><article className="booking" key={b.id}><div><span className={`badge ${b.status}`}>{b.status}</span><h3>{day(b.starts_at)} · {time(b.starts_at)}</h3><p>{b.patient_name} · Clinic consultation</p><code>{b.id}</code></div>{b.status==='confirmed'&&<button className="cancel" disabled={busy} onClick={()=>cancel(b.id)}>Cancel visit</button>}</article>)}</div>:<p className="empty">No appointments saved in this browser yet.</p>}
 <form className="lookup" onSubmit={find}><label>Look up a booking<input value={lookup} onChange={e=>setLookup(e.target.value)} required placeholder="Booking reference"/></label><button className="secondary" disabled={busy}>Find booking</button></form><details className="recovery"><summary>Access appointments on another browser</summary><p className="hint">Your private access code is the key to your appointments. Keep it safe and only share it with a trusted device.</p><button className="secondary" onClick={()=>{setRecovery(localStorage.getItem(tokenKey)||'');}}>Show my access code</button>{recovery&&<code className="recovery-code">{recovery}</code>}<form onSubmit={e=>{e.preventDefault();if(!/^[a-f0-9]{64}$/.test(recovery)){setError('Enter a valid 64-character access code.');return;}localStorage.setItem(tokenKey,recovery);setBookingPage(1);setRefresh(v=>v+1);}}><label>Restore access<input value={recovery} onChange={e=>setRecovery(e.target.value)} placeholder="Private access code" autoComplete="off"/></label><button className="secondary">Restore appointments</button></form></details></>}
 {!confirmation&&<div className="pagination"><button className="secondary" disabled={loading||activePage.page<=1} onClick={()=>tab==='book'?setSlotPage(v=>v-1):setBookingPage(v=>v-1)}>← Previous</button><span>Page {tab==='book'?slotPage:bookingPage}</span><button className="secondary" disabled={loading||!activePage.has_more} onClick={()=>tab==='book'?setSlotPage(v=>v+1):setBookingPage(v=>v+1)}>Next →</button></div>}
 <div className="workspace-footer"><span className="dot"/> A simpler way to care for yourself.</div></section></main><footer><span>CAREWELL / APPOINTMENTS MADE SIMPLE</span><span>Take care. We’ll see you soon.</span></footer></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
