/* Data layer. Supabase when config.js has keys; otherwise a demo store in this browser. */
(function(){
"use strict";
const C=window.OUR_ADDIS||{};
const uid=()=>(crypto.randomUUID?crypto.randomUUID():"id-"+Date.now().toString(36)+Math.random().toString(36).slice(2));

/* ---------------- Supabase ---------------- */
function supa(){
  const sb=window.supabase.createClient(C.supabaseUrl,C.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const urlCache=new Map();
  const ok=({data,error})=>{if(error)throw new Error(error.message||"Something went wrong");return data;};
  return {
    mode:"supabase",
    async session(){const{data}=await sb.auth.getSession();return data.session?{id:data.session.user.id,email:data.session.user.email}:null;},
    onAuth(fn){sb.auth.onAuthStateChange((_e,s)=>fn(s?{id:s.user.id,email:s.user.email}:null));},
    async signIn(email,password){ok(await sb.auth.signInWithPassword({email,password}));},
    async signUp(email,password,name){const d=ok(await sb.auth.signUp({email,password,options:{data:{display_name:name},emailRedirectTo:location.origin+location.pathname}}));return {needsConfirm:!d.session};},
    async resetPassword(email){ok(await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname}));},
    async signOut(){await sb.auth.signOut();},
    async isMember(){const{data}=await sb.rpc("is_member");return data===true;},
    async loadAll(){
      const [m,p,v,ph]=await Promise.all([
        sb.from("members").select("*"),sb.from("places").select("*"),
        sb.from("visits").select("*").order("visited_on",{ascending:false}),sb.from("photos").select("*").order("created_at")]);
      return {members:ok(m),places:ok(p),visits:ok(v),photos:ok(ph)};
    },
    async savePlace(p){const row={...p};delete row.created_at;if(row.id)return ok(await sb.from("places").update(row).eq("id",row.id).select().single());delete row.id;return ok(await sb.from("places").insert(row).select().single());},
    async deletePlace(id){ok(await sb.from("places").delete().eq("id",id));},
    async saveVisit(v){const row={...v};delete row.created_at;if(row.id)return ok(await sb.from("visits").update(row).eq("id",row.id).select().single());delete row.id;return ok(await sb.from("visits").insert(row).select().single());},
    async deleteVisit(id,photos){if(photos.length)await sb.storage.from("memories").remove(photos.map(p=>p.path));ok(await sb.from("visits").delete().eq("id",id));},
    async addPhoto(visitId,blob,w,h){
      const path=visitId+"/"+uid()+".jpg";
      ok(await sb.storage.from("memories").upload(path,blob,{contentType:"image/jpeg",cacheControl:"31536000",upsert:false}));
      return ok(await sb.from("photos").insert({visit_id:visitId,path,width:w,height:h}).select().single());
    },
    async deletePhoto(p){await sb.storage.from("memories").remove([p.path]);ok(await sb.from("photos").delete().eq("id",p.id));},
    async photoUrls(photos){ // signed URLs, cached ~50 min
      const now=Date.now(),need=photos.filter(p=>{const c=urlCache.get(p.path);return !c||c.exp<now;}).map(p=>p.path);
      for(let i=0;i<need.length;i+=100){const {data}=await sb.storage.from("memories").createSignedUrls(need.slice(i,i+100),3600);
        for(const d of data||[])if(d.signedUrl)urlCache.set(d.path,{url:d.signedUrl,exp:now+50*6e4});}
      const out={};for(const p of photos){const c=urlCache.get(p.path);if(c)out[p.id]=c.url;}return out;
    },
    async rename(name){const s=await this.session();ok(await sb.from("members").update({display_name:name}).eq("user_id",s.id));},
    async recommend(payload){
      const {data,error}=await sb.functions.invoke("recommend",{body:payload});
      if(error){let msg=error.message,code="error";try{const j=await error.context.json();msg=j.error||msg;code=j.code||code;}catch{}const e=new Error(msg);e.code=code;throw e;}
      return data;
    },
    async recentRecs(){const{data}=await sb.from("recommendations").select("*").order("created_at",{ascending:false}).limit(5);return data||[];}
  };
}

/* ---------------- Demo (browser only) ---------------- */
function demo(){
  const K="our-addis-demo";
  const load=()=>{try{return JSON.parse(localStorage.getItem(K))||null;}catch{return null;}};
  let db=load()||{members:[{user_id:"me",display_name:"Kaleab"},{user_id:"her",display_name:"Abigya"}],places:[],visits:[],photos:[],blobs:{},recs:[],signedIn:false};
  const save=()=>{try{localStorage.setItem(K,JSON.stringify(db));}catch(e){throw new Error("This browser is out of space for demo photos. Connect Supabase to keep real memories.");}};
  let authFn=()=>{};
  const sess=()=>db.signedIn?{id:"me",email:"demo@our-addis"}:null;
  return {
    mode:"demo",
    async session(){return sess();},
    onAuth(fn){authFn=fn;},
    async signIn(){db.signedIn=true;save();authFn(sess());},
    async signUp(){db.signedIn=true;save();authFn(sess());return {needsConfirm:false};},
    async resetPassword(){},
    async signOut(){db.signedIn=false;save();authFn(null);},
    async isMember(){return true;},
    async loadAll(){return {members:db.members,places:db.places,visits:[...db.visits].sort((a,b)=>b.visited_on.localeCompare(a.visited_on)),photos:db.photos};},
    async savePlace(p){if(p.id){const i=db.places.findIndex(x=>x.id===p.id);db.places[i]={...db.places[i],...p};save();return db.places[i];}const r={...p,id:uid(),created_at:new Date().toISOString(),created_by:"me"};db.places.push(r);save();return r;},
    async deletePlace(id){db.places=db.places.filter(p=>p.id!==id);const vs=db.visits.filter(v=>v.place_id===id).map(v=>v.id);db.visits=db.visits.filter(v=>v.place_id!==id);db.photos=db.photos.filter(p=>!vs.includes(p.visit_id));save();},
    async saveVisit(v){if(v.id){const i=db.visits.findIndex(x=>x.id===v.id);db.visits[i]={...db.visits[i],...v};save();return db.visits[i];}const r={...v,id:uid(),created_at:new Date().toISOString(),created_by:"me"};db.visits.push(r);save();return r;},
    async deleteVisit(id){const ps=db.photos.filter(p=>p.visit_id===id);for(const p of ps)delete db.blobs[p.path];db.photos=db.photos.filter(p=>p.visit_id!==id);db.visits=db.visits.filter(v=>v.id!==id);save();},
    async addPhoto(visitId,blob,w,h){ // demo keeps small copies
      const small=await window.OurAddisImg.shrink(blob,900,.72);
      const dataUrl=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(small.blob);});
      const path=visitId+"/"+uid()+".jpg";db.blobs[path]=dataUrl;const row={id:uid(),visit_id:visitId,path,width:w,height:h,caption:"",created_at:new Date().toISOString()};db.photos.push(row);save();return row;
    },
    async deletePhoto(p){delete db.blobs[p.path];db.photos=db.photos.filter(x=>x.id!==p.id);save();},
    async photoUrls(photos){const o={};for(const p of photos)if(db.blobs[p.path])o[p.id]=db.blobs[p.path];return o;},
    async rename(name){db.members[0].display_name=name;save();},
    async recommend(){const e=new Error("Demo mode: AI picks need Supabase and the Anthropic key. Showing offline picks instead.");e.code="demo";throw e;},
    async recentRecs(){return [];}
  };
}

/* ---------------- images ---------------- */
window.OurAddisImg={
  async shrink(file,max=1600,q=.82){
    let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:"from-image"});}catch{bmp=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("That photo couldn't be read."));i.src=URL.createObjectURL(file);});}
    const s=Math.min(1,max/Math.max(bmp.width,bmp.height));const w=Math.round(bmp.width*s),h=Math.round(bmp.height*s);
    const c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(bmp,0,0,w,h);
    const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",q));return {blob,w,h};
  }
};

window.OurAddisStore=(C.supabaseUrl&&C.supabaseAnonKey&&window.supabase)?supa():demo();
})();
