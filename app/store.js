/* Local-first data layer.
   Every change is written to this phone's IndexedDB first (works with no signal, or with the PC off),
   queued in an outbox, and synced both ways with the home PC (PocketBase, same origin) whenever it is reachable.
   Conflicts: the edit made most recently on a phone wins (client_ts); the server refuses older edits (409).
   Deletes are tombstones (deleted = true) so nothing is ever erased on the PC. */
(function(){
"use strict";
const COLLS=["places","visits","photos"];
const FIELDS={
  places:["name","lat","lng","area","kind","cuisine","fasting_friendly","price_level","notes","wishlist","osm_id"],
  visits:["place_id","visited_on","occasion","ordered","food_review","place_review","r_food","r_vibe","r_service","r_value","spent_birr","fasting"],
  photos:["visit_id","width","height","caption"]
};
const API="api/";
const newId=()=>{const a="abcdefghijklmnopqrstuvwxyz0123456789",b=crypto.getRandomValues(new Uint8Array(15));let s="";for(const x of b)s+=a[x%36];return s;};

/* ---------- IndexedDB ---------- */
let dbp=null;
function idb(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{const r=indexedDB.open("our-addis",1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore("records");d.createObjectStore("blobs");d.createObjectStore("outbox");d.createObjectStore("meta");};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return dbp;}
async function tx(store,mode,fn){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(store,mode);const s=t.objectStore(store);let out;const r=fn(s);if(r&&"onsuccess" in r)r.onsuccess=()=>{out=r.result;};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error("Storage error"));});}
const put=(st,k,v)=>tx(st,"readwrite",s=>s.put(v,k));
const get=(st,k)=>tx(st,"readonly",s=>s.get(k));
const del=(st,k)=>tx(st,"readwrite",s=>s.delete(k));
async function all(st){const d=await idb();return new Promise((res,rej)=>{const out=[];const t=d.transaction(st,"readonly");const c=t.objectStore(st).openCursor();c.onsuccess=()=>{const cur=c.result;if(cur){out.push([cur.key,cur.value]);cur.continue();}};t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);});}

/* ---------- in-memory mirror ---------- */
const mem={places:new Map(),visits:new Map(),photos:new Map()};
let outbox=new Map(), meta={}, ready=null;
async function load(){
  for(const [k,v] of await all("records")){const c=k.split(":")[0];if(mem[c])mem[c].set(v.id,v);}
  for(const [k,v] of await all("outbox"))outbox.set(k,v);
  for(const [k,v] of await all("meta"))meta[k]=v;
}
const setMeta=(k,v)=>{meta[k]=v;return put("meta",k,v);};
async function putRec(coll,rec){mem[coll].set(rec.id,rec);await put("records",coll+":"+rec.id,rec);}
async function queue(coll,rec){const k=coll+":"+rec.id;const op={coll,id:rec.id,ts:rec.client_ts};outbox.set(k,op);await put("outbox",k,op);emitStatus();scheduleSync(600);}

/* ---------- status & events ---------- */
let status={state:"idle",lastSync:null,pending:0,message:""};
const subs=new Set(),statusSubs=new Set();
function emit(){for(const f of subs)try{f();}catch(e){console.error(e);}}
function setStatus(state,message){status=Object.assign({},status,{state,message:message||""});emitStatus();}
function emitStatus(){status.pending=outbox.size;status.lastSync=meta.lastSync||null;for(const f of statusSubs)try{f(status);}catch(e){}}

/* ---------- HTTP to the home PC ---------- */
const auth=()=>meta.auth||null;
async function http(path,opts={},timeout=20000){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeout);
  const headers=Object.assign({},opts.headers||{});if(auth())headers.Authorization=auth().token;
  if(opts.json!==undefined){headers["Content-Type"]="application/json";opts.body=JSON.stringify(opts.json);}
  let r;try{r=await fetch(API+path,{method:opts.method||"GET",headers,body:opts.body,signal:ctl.signal,cache:"no-store"});}
  catch(e){const err=new Error("Can't reach the home PC.");err.net=true;throw err;}finally{clearTimeout(t);}
  let j=null;try{j=await r.json();}catch{}
  if(!r.ok){const err=new Error((j&&j.message)||("Error "+r.status));err.status=r.status;err.code=j&&j.code;err.data=j;throw err;}
  return j;
}
const pick=(coll,rec)=>{const o={client_ts:rec.client_ts||Date.now(),deleted:!!rec.deleted};for(const f of FIELDS[coll])if(rec[f]!==undefined)o[f]=rec[f];return o;};

/* ---------- sync ---------- */
let syncing=false,again=false,timer=null,downloading=false;
function scheduleSync(ms){clearTimeout(timer);timer=setTimeout(sync,ms);}
async function sync(){
  if(!auth())return;
  if(syncing){again=true;return;}
  syncing=true;
  try{
    if(!navigator.onLine){setStatus("offline");return;}
    try{await http("our/ping",{},8000);}catch(e){setStatus("unreachable");return;}
    setStatus("syncing");
    await refreshToken();
    const changedUp=await push();
    const changedDown=await pull();
    await fetchMembers();
    await setMeta("lastSync",Date.now());
    setStatus(outbox.size?"pending":"synced");
    if(changedUp||changedDown)emit();
    downloadPhotos();
  }catch(e){
    if(e.status===401||e.status===403&&/auth/i.test(e.message)){setStatus("auth","Sign in again to keep syncing.");}
    else if(e.net)setStatus("unreachable");
    else{console.error(e);setStatus("error",e.message);}
  }finally{syncing=false;if(again){again=false;scheduleSync(300);}}
}
async function refreshToken(){const a=auth();if(!a||Date.now()-(a.refreshed||0)<6e5)return;let r;try{r=await http("collections/users/auth-refresh",{method:"POST"});}catch(e){if(e.status>=400&&e.status<500&&!e.net)e.status=401;throw e;}await setMeta("auth",Object.assign({},a,{token:r.token,refreshed:Date.now()}));}
async function push(){
  let n=0;
  const ops=[...outbox.entries()].sort((a,b)=>COLLS.indexOf(a[1].coll)-COLLS.indexOf(b[1].coll)||a[1].ts-b[1].ts);
  for(const [k,op] of ops){
    const rec=mem[op.coll].get(op.id);if(!rec){outbox.delete(k);await del("outbox",k);continue;}
    try{
      if(op.coll==="photos"&&rec._needsUpload)await uploadPhoto(rec);
      else await upsert(op.coll,rec);
    }catch(e){
      if(e.status===409){/* the other phone has a newer edit: pull will bring it */}
      else if(e.status===400&&op.coll==="photos"&&rec._needsUpload&&!(await get("blobs",rec.id))){rec._needsUpload=false;rec._lost=true;await putRec("photos",rec);}
      else throw e;
    }
    const cur=mem[op.coll].get(op.id);
    if(!cur||cur.client_ts===op.ts){outbox.delete(k);await del("outbox",k);}
    n++;emitStatus();
  }
  return n>0;
}
async function upsert(coll,rec){
  const body=pick(coll,rec);
  try{await http("collections/"+coll+"/records/"+rec.id,{method:"PATCH",json:body});}
  catch(e){
    if(e.status!==404)throw e;
    try{await http("collections/"+coll+"/records",{method:"POST",json:Object.assign({id:rec.id},body)});}
    catch(e2){if(e2.status===400&&await exists(coll,rec.id))await http("collections/"+coll+"/records/"+rec.id,{method:"PATCH",json:body});else throw e2;}
  }
}
async function exists(coll,id){try{await http("collections/"+coll+"/records/"+id);return true;}catch(e){if(e.status===404)return false;throw e;}}
async function uploadPhoto(rec){
  const blob=await get("blobs",rec.id);
  if(!blob){throw Object.assign(new Error("photo file missing"),{status:400});}
  if(await exists("photos",rec.id)){rec._needsUpload=false;await putRec("photos",rec);return upsert("photos",rec);}
  const fd=new FormData();fd.append("id",rec.id);const b=pick("photos",rec);for(const k in b)fd.append(k,typeof b[k]==="boolean"?String(b[k]):b[k]);
  fd.append("image",blob.blob,"photo.jpg");
  const r=await http("collections/photos/records",{method:"POST",body:fd},120000);
  rec._needsUpload=false;rec.image=r.image;await putRec("photos",rec);
}
async function pull(){
  let changed=false;
  for(const coll of COLLS){
    let since=meta["since:"+coll]||"",page=1;
    for(;;){
      const q="collections/"+coll+"/records?perPage=200&page="+page+"&sort=updated,id&skipTotal=1"+(since?"&filter="+encodeURIComponent("updated>='"+since+"'"):"");
      const r=await http(q);const items=r.items||[];
      for(const s of items){if(await merge(coll,s))changed=true;}
      if(items.length)await setMeta("since:"+coll,items[items.length-1].updated);
      if(items.length<200)break;page++;
    }
  }
  return changed;
}
async function merge(coll,s){
  const k=coll+":"+s.id,local=mem[coll].get(s.id);
  if(local&&outbox.has(k)&&(local.client_ts||0)>(s.client_ts||0))return false;
  if(local&&local.client_ts===s.client_ts&&!!local.deleted===!!s.deleted&&(coll!=="photos"||local.image===s.image))return false;
  const rec={id:s.id,client_ts:s.client_ts,deleted:!!s.deleted,created_by:s.created_by,created_at:s.created};
  for(const f of FIELDS[coll])rec[f]=s[f];
  if(coll==="photos"){rec.image=s.image;rec._needsUpload=false;}
  await putRec(coll,rec);return true;
}
async function fetchMembers(){try{const r=await http("collections/users/records?fields=id,name,email&perPage=10");await setMeta("members",(r.items||[]).map(u=>({user_id:u.id,display_name:u.name||(u.email||"").split("@")[0]})));}catch(e){if(e.net)throw e;}}
async function downloadPhotos(){
  if(downloading||!auth()||!navigator.onLine)return;downloading=true;
  try{
    const need=[];for(const p of mem.photos.values())if(!p.deleted&&p.image&&!p._needsUpload&&!blobUrls.has(p.id)&&!(await get("blobs",p.id)))need.push(p);
    if(!need.length)return;
    const {token}=await http("files/token",{method:"POST"});
    let got=0;
    for(const p of need.slice(0,40)){
      try{const r=await fetch(API+"files/photos/"+p.id+"/"+encodeURIComponent(p.image)+"?thumb=800x0&token="+encodeURIComponent(token));if(!r.ok)continue;
        await put("blobs",p.id,{blob:await r.blob(),kind:"thumb"});got++;if(got%4===0)emit();}catch(e){break;}
    }
    if(got)emit();
  }catch(e){}finally{downloading=false;}
}

/* ---------- photos for display ---------- */
const blobUrls=new Map();
async function photoUrls(photos){const out={};for(const p of photos){let u=blobUrls.get(p.id);if(!u){const b=await get("blobs",p.id);if(b&&b.blob){u=URL.createObjectURL(b.blob);blobUrls.set(p.id,u);}}if(u)out[p.id]=u;}return out;}

/* ---------- public API used by app.js ---------- */
const live=coll=>[...mem[coll].values()].filter(r=>!r.deleted);
const S={
  mode:"local",
  async init(){if(!ready)ready=load();await ready;emitStatus();
    window.addEventListener("online",()=>scheduleSync(200));window.addEventListener("offline",()=>setStatus("offline"));
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleSync(200);});
    setInterval(()=>{if(!document.hidden)sync();},45000);
    if(auth())scheduleSync(50);},
  async session(){await ready;const a=auth();return a?{id:a.user.id,email:a.user.email}:null;},
  onAuth(){},
  onChange(fn){subs.add(fn);},
  onStatus(fn){statusSubs.add(fn);fn(status);},
  status:()=>status,
  syncNow:()=>sync(),
  async signIn(email,password){
    let r;try{r=await http("collections/users/auth-with-password",{method:"POST",json:{identity:email,password}});}
    catch(e){if(e.net)throw new Error("Can't reach the home PC. Open Tailscale on this phone and make sure the PC is on.");if(e.status===400)throw new Error("Wrong email or password.");throw e;}
    await setMeta("auth",{token:r.token,user:{id:r.record.id,email:r.record.email,name:r.record.name},refreshed:Date.now()});
    try{await navigator.storage?.persist?.();}catch{}
    await sync();
  },
  async signUp(email,password,name){
    try{await http("collections/users/records",{method:"POST",json:{email,password,passwordConfirm:password,name}});}
    catch(e){if(e.net)throw new Error("Can't reach the home PC. Open Tailscale on this phone and make sure the PC is on.");
      const d=e.data&&e.data.data;if(d&&d.email)throw new Error("That email can't be used (maybe it already has an account).");if(d&&d.password)throw new Error("Password must be at least 8 characters.");throw e;}
    await this.signIn(email,password);return {needsConfirm:false};
  },
  async signOut(){if(outbox.size)throw new Error(outbox.size+" change(s) haven't reached the home PC yet. Sync first, then sign out.");await setMeta("auth",null);location.reload();},
  async isMember(){return !!auth();},
  async loadAll(){await ready;return {members:meta.members||[{user_id:auth()?.user.id,display_name:auth()?.user.name||""}],places:live("places"),
    visits:live("visits").sort((a,b)=>String(b.visited_on).localeCompare(String(a.visited_on))||(b.client_ts-a.client_ts)),
    photos:live("photos").sort((a,b)=>(a.client_ts||0)-(b.client_ts||0))};},
  async savePlace(p){const cur=p.id?mem.places.get(p.id):null;const rec=Object.assign({},cur||{id:newId(),deleted:false,created_by:auth()?.user.id,created_at:new Date().toISOString()},p,{client_ts:Date.now()});await putRec("places",rec);await queue("places",rec);return rec;},
  async deletePlace(id){const now=Date.now();
    for(const v of mem.visits.values())if(v.place_id===id&&!v.deleted){for(const ph of mem.photos.values())if(ph.visit_id===v.id&&!ph.deleted){const r=Object.assign({},ph,{deleted:true,client_ts:now});await putRec("photos",r);await queue("photos",r);}const r=Object.assign({},v,{deleted:true,client_ts:now});await putRec("visits",r);await queue("visits",r);}
    const p=Object.assign({},mem.places.get(id),{deleted:true,client_ts:now});await putRec("places",p);await queue("places",p);},
  async saveVisit(v){const cur=v.id?mem.visits.get(v.id):null;const rec=Object.assign({},cur||{id:newId(),deleted:false,created_by:auth()?.user.id,created_at:new Date().toISOString()},v,{client_ts:Date.now()});await putRec("visits",rec);await queue("visits",rec);return rec;},
  async deleteVisit(id){const now=Date.now();for(const ph of mem.photos.values())if(ph.visit_id===id&&!ph.deleted){const r=Object.assign({},ph,{deleted:true,client_ts:now});await putRec("photos",r);await queue("photos",r);}
    const v=Object.assign({},mem.visits.get(id),{deleted:true,client_ts:now});await putRec("visits",v);await queue("visits",v);},
  async addPhoto(visitId,blob,w,h){const id=newId();await put("blobs",id,{blob,kind:"orig"});const rec={id,visit_id:visitId,width:w,height:h,caption:"",deleted:false,client_ts:Date.now(),_needsUpload:true,created_by:auth()?.user.id,created_at:new Date().toISOString()};await putRec("photos",rec);await queue("photos",rec);return rec;},
  async deletePhoto(p){const r=Object.assign({},mem.photos.get(p.id),{deleted:true,client_ts:Date.now()});await putRec("photos",r);await queue("photos",r);},
  photoUrls,
  async rename(name){const a=auth();await http("collections/users/records/"+a.user.id,{method:"PATCH",json:{name}});await setMeta("auth",Object.assign({},a,{user:Object.assign({},a.user,{name})}));await fetchMembers();},
  async recommend(payload){
    if(!navigator.onLine){const e=new Error("You're offline, so Claude can't search right now.");e.code="offline";throw e;}
    try{return await http("our/recommend",{method:"POST",json:payload},180000);}
    catch(e){if(e.net){const x=new Error("Can't reach the home PC right now.");x.code="unreachable";throw x;}const x=new Error(e.message);x.code=e.code||"error";throw x;}
  },
  async recentRecs(){try{const r=await http("collections/recommendations/records?sort=-created&perPage=5",{},8000);await setMeta("recs",r.items||[]);return r.items||[];}catch{return meta.recs||[];}}
};

/* ---------- images ---------- */
window.OurAddisImg={
  async shrink(file,max=1600,q=.82){
    let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:"from-image"});}catch{bmp=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("That photo couldn't be read."));i.src=URL.createObjectURL(file);});}
    const s=Math.min(1,max/Math.max(bmp.width,bmp.height));const w=Math.round(bmp.width*s),h=Math.round(bmp.height*s);
    const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(bmp,0,0,w,h);
    const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",q));return {blob,w,h};
  }
};
window.OurAddisStore=S;
})();
