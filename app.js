(function(){
"use strict";
const S=window.OurAddisStore, F=window.Fasting, IDEAS=window.IDEAS||[];
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeUrl=u=>/^https:\/\//i.test(String(u||""))?String(u):"";
const ADDIS=[9.0108,38.7613];
const AREAS=["Bole","Bole Atlas","Bole Medhanialem","Kazanchis","Piazza","Arat Kilo","Sidist Kilo","Megenagna","CMC","Sar Bet","Old Airport","Mexico","Sarbet","Gerji","Ayat","Lebu","Entoto","Merkato","Hayahulet","Gotera","Lideta","Summit"];
const KINDS={restaurant:"Restaurant",cafe:"Café",bar:"Bar / lounge",bakery:"Bakery",park:"Park / outdoors",culture:"Museum / culture",other:"Other"};
const PRICE=["","Cheap","Mid","Nice","Splurge"];
const todayStr=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};

let me=null, data={members:[],places:[],visits:[],photos:[]}, urls={}, tab="home", map=null, mini=null;

/* ---------------- utils ---------------- */
function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3400);}
const fmtDate=s=>new Date(s+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
const fmtShort=s=>new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"});
const birr=n=>n==null||n===""?"":Math.round(Number(n)).toLocaleString("en-US")+" birr";
const stars=n=>{n=Math.round(n||0);return '<span class="stars" aria-label="'+n+' out of 5">'+"★".repeat(n)+'<span style="opacity:.25">'+"★".repeat(5-n)+'</span></span>';};
function vAvg(v){const r=[v.r_food,v.r_vibe,v.r_service,v.r_value].filter(x=>x);return r.length?r.reduce((a,b)=>a+b,0)/r.length:null;}
function pStats(pid){const vs=data.visits.filter(v=>v.place_id===pid);const avgs=vs.map(vAvg).filter(x=>x!=null);const sp=vs.map(v=>Number(v.spent_birr)).filter(x=>x>0);
  return {n:vs.length,avg:avgs.length?avgs.reduce((a,b)=>a+b,0)/avgs.length:null,spent:sp.reduce((a,b)=>a+b,0),avgSpent:sp.length?sp.reduce((a,b)=>a+b,0)/sp.length:null,last:vs[0]?.visited_on||null,visits:vs};}
const tier=(p,st)=>st.n===0?(p.wishlist?"wish":"saved"):(st.avg!=null&&st.avg>=4.5&&st.n>=1)?"fav":st.n>=3?"regular":"visited";
const placeOf=id=>data.places.find(p=>p.id===id);
const photosOf=vid=>data.photos.filter(p=>p.visit_id===vid);
const who=uid=>data.members.find(m=>m.user_id===uid)?.display_name||"";
const gmaps=p=>"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(p.lat+","+p.lng);
async function refresh(){data=await S.loadAll();urls=await S.photoUrls(data.photos).catch(()=>({}));}
function setTab(t){tab=t;if(location.hash!=="#"+t)history.replaceState(null,"","#"+t);for(const b of document.querySelectorAll("nav.tabs [data-tab]"))b.setAttribute("aria-current",b.dataset.tab===t?"page":"false");render();window.scrollTo(0,0);}
document.querySelectorAll("nav.tabs [data-tab]").forEach(b=>b.onclick=()=>{if(b.dataset.tab==="log")draft=null;setTab(b.dataset.tab);});
window.addEventListener("hashchange",()=>{const t=location.hash.slice(1);if(t&&t!==tab&&VIEWS[t])setTab(t);});

/* ---------------- sheets & lightbox ---------------- */
function sheet(html,onMount){closeSheet();const back=document.createElement("div");back.className="sheet-back";back.innerHTML='<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>'+html+'</div>';
  back.addEventListener("click",e=>{if(e.target===back)closeSheet();});document.body.appendChild(back);document.body.style.overflow="hidden";onMount&&onMount(back.querySelector(".sheet"));}
function closeSheet(){document.querySelectorAll(".sheet-back").forEach(x=>x.remove());document.body.style.overflow="";}
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeSheet();document.querySelector(".lb")?.remove();}});
function lightbox(list,i){const lb=document.createElement("div");lb.className="lb";const show=()=>{const p=list[i];lb.innerHTML='<img alt="" src="'+esc(urls[p.id]||"")+'"><button class="x" aria-label="Close">✕</button>'+(list.length>1?'<button class="p" aria-label="Previous">‹</button><button class="n" aria-label="Next">›</button>':"")+'<div class="cap">'+(i+1)+' / '+list.length+'</div>';
  lb.querySelector(".x").onclick=()=>lb.remove();if(list.length>1){lb.querySelector(".p").onclick=()=>{i=(i-1+list.length)%list.length;show();};lb.querySelector(".n").onclick=()=>{i=(i+1)%list.length;show();};}};
  let sx=null;lb.addEventListener("touchstart",e=>sx=e.touches[0].clientX,{passive:true});lb.addEventListener("touchend",e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx;if(Math.abs(dx)>50&&list.length>1){i=(i+(dx<0?1:-1)+list.length)%list.length;show();}sx=null;});
  show();document.body.appendChild(lb);}
function photoGrid(ps,max=6){if(!ps.length)return "";const n=ps.length,shown=ps.slice(0,max);return '<div class="pgrid n'+Math.min(n,3)+'">'+shown.map((p,i)=>{const more=i===max-1&&n>max;return '<div class="'+(more?"more":"")+'"><img loading="lazy" alt="" data-ph="'+esc(p.id)+'" src="'+esc(urls[p.id]||"")+'">'+(more?'<span>+'+(n-max+1)+'</span>':"")+'</div>';}).join("")+'</div>';}
function wirePhotos(root,ps){root.querySelectorAll("img[data-ph]").forEach(img=>img.onclick=e=>{e.stopPropagation();lightbox(ps,ps.findIndex(p=>p.id===img.dataset.ph));});}

/* ---------------- auth ---------------- */
function authView(msg){
  $("#tabs").hidden=true;
  $("#app").innerHTML='<div class="auth"><div class="eyebrow">Kaleab & Abigya</div><h1>Our <em>Addis</em></h1><p class="muted">Every place we go, every plate we share, and where to go next.</p>'+
  '<div class="card"><div class="chips" role="tablist" style="margin-bottom:14px"><button class="chip" id="aIn" aria-pressed="true">Sign in</button><button class="chip" id="aUp" aria-pressed="false">Create account</button></div>'+
  '<form id="aForm" style="display:flex;flex-direction:column;gap:12px"><label class="f" id="aNameL" hidden>Your name<input class="inp" id="aName" autocomplete="given-name" placeholder="Abigya"></label>'+
  '<label class="f">Email<input class="inp" id="aEmail" type="email" autocomplete="email" required></label><label class="f">Password<input class="inp" id="aPw" type="password" autocomplete="current-password" minlength="8" required></label>'+
  '<button class="btn primary block" id="aGo">Sign in</button><p class="err" id="aErr">'+esc(msg||"")+'</p><button type="button" class="btn ghost" id="aForgot">Forgot password?</button></form></div>'+
  '<p class="small muted">Only the two of us can join. The first two accounts become the couple, and nobody else can see anything.</p></div>';
  let mode="in";const set=m=>{mode=m;$("#aIn").setAttribute("aria-pressed",String(m==="in"));$("#aUp").setAttribute("aria-pressed",String(m==="up"));$("#aNameL").hidden=m!=="up";$("#aGo").textContent=m==="up"?"Create account":"Sign in";$("#aPw").autocomplete=m==="up"?"new-password":"current-password";};
  $("#aIn").onclick=()=>set("in");$("#aUp").onclick=()=>set("up");
  $("#aForgot").onclick=async()=>{const e=$("#aEmail").value.trim();if(!e){$("#aErr").textContent="Type your email first.";return;}try{await S.resetPassword(e);$("#aErr").textContent="Check your email for a reset link.";}catch(x){$("#aErr").textContent=x.message;}};
  $("#aForm").onsubmit=async e=>{e.preventDefault();$("#aGo").disabled=true;$("#aErr").textContent="";
    try{if(mode==="up"){const r=await S.signUp($("#aEmail").value.trim(),$("#aPw").value,$("#aName").value.trim());if(r.needsConfirm){$("#aErr").textContent="Almost there: open the confirmation email, then come back and sign in.";set("in");}}
      else await S.signIn($("#aEmail").value.trim(),$("#aPw").value);}
    catch(x){$("#aErr").textContent=x.message;}finally{$("#aGo").disabled=false;}};
}
async function start(){
  me=await S.session();
  if(!me){if(S.mode==="demo"){await S.signIn();me=await S.session();}else return authView();}
  if(!(await S.isMember())){$("#tabs").hidden=true;$("#app").innerHTML='<div class="auth"><h1>Our <em>Addis</em></h1><p>This app is private to Kaleab and Abigya.</p><button class="btn" id="out">Sign out</button></div>';$("#out").onclick=()=>S.signOut();return;}
  $("#tabs").hidden=false;
  $("#app").innerHTML='<div class="view"><p class="muted">Loading our places…</p></div>';
  try{await refresh();}catch(e){$("#app").innerHTML='<div class="view"><p class="err">Couldn’t load: '+esc(e.message)+'</p><button class="btn" onclick="location.reload()">Try again</button></div>';return;}
  const t=location.hash.slice(1);setTab(VIEWS[t]?t:"home");
}
S.onAuth(s=>{if(!!s!==!!me){me=s;start();}});

/* ---------------- HOME ---------------- */
function fastCard(fi){
  const d=new Date();const e=fi.eth;
  const label=fi.fasting?(fi.total&&fi.total>1?esc(fi.name)+' · day '+fi.day+' of '+fi.total:esc(fi.name)):"Fisk day: eat anything";
  const sub=fi.fasting?(fi.key==="dihnet"?"Weekly fast. Fasting food (ye tsom) until the afternoon.":esc(fi.en)+(fi.endsOn?" · ends "+fmtShort(fi.endsOn):"")):(()=>{const n=F.nextFast(todayStr());return n?"Next fast: "+esc(n.name)+" from "+fmtShort(n.date):"";})();
  return '<div class="card today '+(fi.fasting?"fast":"fisk")+'"><div class="dot eth">'+(fi.fasting?"ጾ":"ፍ")+'</div><div><div class="eyebrow">'+d.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})+' · <span class="eth">'+esc(e.nameAm)+' '+e.day+', '+e.year+'</span></div><b>'+label+'</b> <span class="eth muted">'+esc(fi.nameAm)+'</span><div class="small muted">'+sub+'</div></div></div>';
}
function home(){
  const fi=F.info(todayStr());const names=data.members.map(m=>m.display_name).filter(Boolean);
  const vs=data.visits, spent=vs.reduce((a,v)=>a+Number(v.spent_birr||0),0), withSpend=vs.filter(v=>Number(v.spent_birr)>0);
  const placesVisited=new Set(vs.map(v=>v.place_id)).size;
  const recentPh=data.photos.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,12);
  const ranked=data.places.map(p=>({p,st:pStats(p.id)})).filter(x=>x.st.n>0);
  const regulars=ranked.slice().sort((a,b)=>b.st.n-a.st.n||(b.st.avg||0)-(a.st.avg||0)).slice(0,5);
  const favs=ranked.filter(x=>x.st.avg!=null).sort((a,b)=>b.st.avg-a.st.avg||b.st.n-a.st.n).slice(0,5);
  const months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");months.push({k,l:d.toLocaleDateString("en-GB",{month:"short"}),n:vs.filter(v=>v.visited_on.startsWith(k)).length,s:vs.filter(v=>v.visited_on.startsWith(k)).reduce((a,v)=>a+Number(v.spent_birr||0),0)});}
  const mx=Math.max(1,...months.map(m=>m.n));
  const cuis={};for(const v of vs){const c=(placeOf(v.place_id)?.cuisine||"").split(/[,&/]/)[0].trim().toLowerCase();if(c)cuis[c]=(cuis[c]||0)+1;}
  const topC=Object.entries(cuis).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>x[0]);
  const fastVisits=vs.filter(v=>v.fasting).length;
  const li=x=>'<button class="li" data-place="'+esc(x.p.id)+'"><span class="ic">'+x.st.n+'</span><span><b>'+esc(x.p.name)+'</b><small>'+esc(x.p.area||KINDS[x.p.kind]||"")+(x.st.avgSpent?' · ~'+birr(x.st.avgSpent):"")+'</small></span>'+(x.st.avg!=null?stars(x.st.avg):"")+'</button>';
  $("#app").innerHTML='<div class="view">'+
   (S.mode==="demo"?'<div class="card small" style="background:var(--gold-soft);border-color:transparent"><b>Demo mode.</b> Everything stays in this browser until the app is connected to its private database.</div>':"")+
   '<div class="hello"><div class="eyebrow">'+esc(names.join(" & ")||"Kaleab & Abigya")+'</div><h1 class="disp">Our <em>Addis</em></h1></div>'+
   fastCard(fi)+
   '<button class="btn gold block" id="goNext">✨ Where should we go next?</button>'+
   '<div class="stats"><div class="stat"><b class="num">'+vs.length+'</b><span>outings</span></div><div class="stat"><b class="num">'+placesVisited+'</b><span>places</span></div><div class="stat"><b class="num">'+(spent>=1e4?Math.round(spent/1000)+"k":Math.round(spent).toLocaleString())+'</b><span>birr together</span></div><div class="stat"><b class="num">'+(withSpend.length?Math.round(spent/withSpend.length).toLocaleString():"–")+'</b><span>birr per outing</span></div></div>'+
   (recentPh.length?'<section><div class="row between" style="margin-bottom:8px"><h2 class="disp" style="font-size:1.5rem">Latest memories</h2><button class="btn ghost small" data-go="memories">See all</button></div><div class="strip">'+recentPh.map(p=>{const v=data.visits.find(x=>x.id===p.visit_id);const pl=v&&placeOf(v.place_id);return '<button class="ph" data-visit="'+esc(p.visit_id)+'"><img loading="lazy" alt="" src="'+esc(urls[p.id]||"")+'"><span>'+esc(pl?.name||"")+'</span></button>';}).join("")+'</div></section>':"")+
   (vs.length?'<section class="card"><div class="eyebrow">Outings per month</div><div class="bars">'+months.map(m=>'<div title="'+m.n+' outings, '+birr(m.s)+'"><span class="num">'+(m.n||"")+'</span><i style="height:'+(m.n/mx*70)+'px"></i><span>'+m.l+'</span></div>').join("")+'</div>'+
     '<p class="small muted" style="margin:10px 0 0">'+(topC.length?"Your usual: "+esc(topC.join(", "))+". ":"")+fastVisits+' fasting-day outing'+(fastVisits===1?"":"s")+'.</p></section>':"")+
   (regulars.length?'<section class="card"><div class="eyebrow">Where we usually go</div><div class="list">'+regulars.map(li).join("")+'</div></section>':"")+
   (favs.length?'<section class="card"><div class="eyebrow">Our favourites</div><div class="list">'+favs.map(li).join("")+'</div></section>':"")+
   (!vs.length?'<div class="card empty"><h2 class="disp" style="font-size:1.6rem;color:var(--ink)">Your memory book is empty</h2><p>Log the first place you went together: the food, the vibe, a photo.</p><button class="btn primary" data-go="log">+ Log our first outing</button></div>':"")+
   '<div class="row between small muted"><span>Signed in'+(me?.email?" as "+esc(me.email):"")+'</span><span class="row"><button class="btn ghost small" id="rename">Change my name</button>'+(S.mode==="supabase"?'<button class="btn ghost small" id="signout">Sign out</button>':"")+'</span></div>'+
  '</div>';
  wireCommon();
  $("#goNext").onclick=()=>setTab("next");
  $("#rename").onclick=()=>sheet('<h2 class="disp" style="font-size:1.6rem">Your name</h2><input class="inp" id="nm" maxlength="40" value="'+esc(data.members.find(m=>m.user_id===me?.id)?.display_name||"")+'"><button class="btn primary block" id="nmSave">Save</button>',s=>{s.querySelector("#nmSave").onclick=async()=>{try{await S.rename(s.querySelector("#nm").value.trim());await refresh();closeSheet();render();}catch(e){toast(e.message);}};});
  if($("#signout"))$("#signout").onclick=()=>S.signOut();
}
function wireCommon(){
  document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{if(b.dataset.go==="log")draft=null;setTab(b.dataset.go);});
  document.querySelectorAll("[data-place]").forEach(b=>b.onclick=()=>placeSheet(b.dataset.place));
  document.querySelectorAll("[data-visit]").forEach(b=>b.onclick=()=>visitSheet(b.dataset.visit));
}

/* ---------------- MAP ---------------- */
let mapFilter="all", showIdeas=true;
function tiles(){const dark=matchMedia("(prefers-color-scheme: dark)").matches;return L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/"+(dark?"dark_all":"voyager")+"/{z}/{x}/{y}{r}.png",{maxZoom:19,subdomains:"abcd",attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'});}
function pinIcon(cls,label,size){return L.divIcon({className:"",html:'<div class="pin '+cls+'" style="width:'+size+'px;height:'+size+'px">'+label+'</div>',iconSize:[size,size],iconAnchor:[size/2,size/2]});}
function mapView(){
  $("#app").innerHTML='<div class="view full"><div id="map"></div><div class="mapbar"><div class="chips">'+[["all","All"],["fav","★ Favourites"],["regular","♥ Regulars"],["wish","Want to try"],["fast","Fasting-friendly"]].map(([k,l])=>'<button class="chip" data-f="'+k+'" aria-pressed="'+(mapFilter===k)+'">'+l+'</button>').join("")+'<button class="chip" id="ideasT" aria-pressed="'+showIdeas+'">Ideas</button></div></div>'+
   '<div class="legend"><span><i class="pin fav" style="width:12px;height:12px;border-width:1px"></i>Favourite</span><span><i class="pin regular" style="width:12px;height:12px;border-width:1px"></i>Regular</span><span><i class="pin visited" style="width:12px;height:12px;border-width:1px"></i>Been</span><span><i class="pin wish" style="width:12px;height:12px;border-width:1px"></i>Want to try</span>'+(showIdeas?'<span><i class="pin idea" style="width:10px;height:10px;border-width:1px"></i>Idea</span>':"")+'</div></div>';
  if(map){map.remove();map=null;}
  if(!window.L){$("#map").innerHTML='<div class="empty">The map couldn’t load. Check your connection.</div>';return;}
  map=L.map("map",{zoomControl:false,attributionControl:true}).setView(ADDIS,13);tiles().addTo(map);L.control.zoom({position:"bottomright"}).addTo(map);
  const pts=[];
  for(const p of data.places){const st=pStats(p.id),t=tier(p,st);
    if(mapFilter==="fav"&&t!=="fav")continue;if(mapFilter==="regular"&&t!=="regular"&&!(t==="fav"&&st.n>=3))continue;if(mapFilter==="wish"&&!p.wishlist)continue;if(mapFilter==="fast"&&!p.fasting_friendly)continue;
    const size=t==="wish"||t==="saved"?22:Math.min(40,24+st.n*3);const label=t==="fav"?"★":t==="regular"?"♥":st.n?st.n:"";
    L.marker([p.lat,p.lng],{icon:pinIcon(t==="saved"?"wish":t,label,size),zIndexOffset:st.n*10,title:p.name}).addTo(map).on("click",()=>placeSheet(p.id));pts.push([p.lat,p.lng]);}
  if(showIdeas&&mapFilter!=="wish"){const known=new Set(data.places.map(p=>p.name.toLowerCase()));
    for(const i of IDEAS){if(known.has(i.name.toLowerCase()))continue;if(mapFilter==="fast"&&!i.fasting)continue;if(mapFilter==="fav"||mapFilter==="regular")continue;
      L.marker([i.lat,i.lng],{icon:pinIcon("idea","",12),title:i.name}).addTo(map).bindPopup('<b>'+esc(i.name)+'</b><br><span class="small">'+esc(i.area)+' · '+esc(i.cuisine||KINDS[i.kind])+'</span><p style="margin:6px 0">'+esc(i.why)+'</p><button class="btn small" data-want="'+esc(i.name)+'">Want to try</button>');}}
  map.on("popupopen",e=>{const b=e.popup.getElement().querySelector("[data-want]");if(b)b.onclick=async()=>{const i=IDEAS.find(x=>x.name===b.dataset.want);await saveWish({name:i.name,area:i.area,kind:i.kind,cuisine:i.cuisine,lat:i.lat,lng:i.lng,fasting_friendly:i.fasting,price_level:i.price,notes:i.why+" (location approximate)"});map.closePopup();mapView();};});
  if(pts.length>1)map.fitBounds(pts,{paddingTopLeft:[40,120],paddingBottomRight:[40,80],maxZoom:15});else if(pts.length===1)map.setView(pts[0],15);
  document.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{mapFilter=b.dataset.f;mapView();});
  $("#ideasT").onclick=()=>{showIdeas=!showIdeas;mapView();};
}
async function saveWish(p){try{const r=await S.savePlace(Object.assign({wishlist:true,notes:""},p));await refresh();toast("Added "+p.name+" to want-to-try");return r;}catch(e){toast(e.message);}}

/* ---------------- PLACE & VISIT SHEETS ---------------- */
function placeSheet(id){
  const p=placeOf(id);if(!p)return;const st=pStats(id),t=tier(p,st);const ps=data.photos.filter(ph=>st.visits.some(v=>v.id===ph.visit_id));
  sheet('<div class="row between"><div><div class="eyebrow">'+esc(KINDS[p.kind]||"Place")+(p.area?' · '+esc(p.area):"")+'</div><h2 class="disp" style="font-size:2rem;line-height:1.05">'+esc(p.name)+'</h2></div></div>'+
   '<div class="row">'+(t==="fav"?'<span class="badge b-fav">★ Favourite</span>':"")+(t==="regular"?'<span class="badge b-new">♥ Regular</span>':"")+(p.wishlist?'<span class="badge b-wish">Want to try</span>':"")+(p.fasting_friendly?'<span class="badge b-fast">Fasting-friendly</span>':"")+(p.cuisine?'<span class="badge" style="background:var(--sunk)">'+esc(p.cuisine)+'</span>':"")+(p.price_level?'<span class="badge" style="background:var(--sunk)">'+PRICE[p.price_level]+'</span>':"")+'</div>'+
   (st.n?'<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><b class="num">'+st.n+'</b><span>visits</span></div><div class="stat"><b>'+(st.avg!=null?st.avg.toFixed(1):"–")+'</b><span>avg rating</span></div><div class="stat"><b class="num">'+(st.avgSpent?Math.round(st.avgSpent).toLocaleString():"–")+'</b><span>birr / visit</span></div></div>':'<p class="muted">We haven’t been here yet.</p>')+
   (p.notes?'<p class="small muted" style="margin:0">'+esc(p.notes)+'</p>':"")+
   photoGrid(ps,6)+
   (st.n?'<div class="card" style="padding:4px 14px"><div class="list">'+st.visits.map(v=>'<button class="li" data-v="'+esc(v.id)+'"><span class="ic">'+new Date(v.visited_on+"T12:00").getDate()+'</span><span><b>'+fmtDate(v.visited_on)+'</b><small>'+esc((v.ordered||v.food_review||"").slice(0,70))+'</small></span>'+(vAvg(v)!=null?stars(vAvg(v)):"")+'</button>').join("")+'</div></div>':"")+
   '<div class="grid2"><button class="btn primary" id="psLog">+ Log a visit</button><a class="btn" target="_blank" rel="noopener" href="'+esc(gmaps(p))+'">Directions ↗</a></div>'+
   '<div class="row"><button class="btn ghost" id="psWish">'+(p.wishlist?"Remove from want-to-try":"Add to want-to-try")+'</button><button class="btn ghost" id="psEdit">Edit place</button><button class="btn ghost danger" id="psDel">Delete</button></div>',
   s=>{wirePhotos(s,ps);s.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>visitSheet(b.dataset.v));
     s.querySelector("#psLog").onclick=()=>{closeSheet();draft=newDraft({placeId:id});setTab("log");};
     s.querySelector("#psWish").onclick=async()=>{await S.savePlace({id,wishlist:!p.wishlist});await refresh();closeSheet();render();};
     s.querySelector("#psEdit").onclick=()=>editPlaceSheet(p);
     let arm=false;s.querySelector("#psDel").onclick=async e=>{if(!arm){arm=true;e.target.textContent=st.n?"Delete place and "+st.n+" visit(s)?":"Tap again to delete";return;}await S.deletePlace(id);await refresh();closeSheet();render();toast("Deleted");};});
}
function editPlaceSheet(p){
  sheet('<h2 class="disp" style="font-size:1.7rem">Edit place</h2>'+placeFields(p)+'<button class="btn primary block" id="epSave">Save</button><p class="err" id="epErr"></p>',s=>{wirePlaceFields(s,p);s.querySelector("#epSave").onclick=async()=>{const v=readPlaceFields(s);if(!v.name){s.querySelector("#epErr").textContent="Give the place a name.";return;}try{await S.savePlace(Object.assign({id:p.id},v));await refresh();closeSheet();render();toast("Saved");}catch(e){s.querySelector("#epErr").textContent=e.message;}};});
}
function visitSheet(id){
  const v=data.visits.find(x=>x.id===id);if(!v)return;const p=placeOf(v.place_id)||{name:"?"};const ps=photosOf(id);const e=F.ethDate(v.visited_on);
  const rr=[["Food",v.r_food],["Vibe",v.r_vibe],["Service",v.r_service],["Value",v.r_value]].filter(x=>x[1]);
  sheet('<div><div class="eyebrow">'+fmtDate(v.visited_on)+' · <span class="eth">'+esc(e.nameAm)+' '+e.day+'</span>'+(v.created_by?' · logged by '+esc(who(v.created_by)):"")+'</div><h2 class="disp" style="font-size:2rem;line-height:1.05"><button class="btn ghost" style="padding:0;min-height:0;font:inherit;color:inherit" id="vsPlace">'+esc(p.name)+'</button></h2>'+(v.occasion?'<div class="muted">'+esc(v.occasion)+'</div>':"")+'</div>'+
   '<div class="row">'+(v.fasting?'<span class="badge b-fast">Fasting day</span>':"")+(v.spent_birr?'<span class="badge" style="background:var(--sunk)">'+birr(v.spent_birr)+'</span>':"")+'</div>'+
   photoGrid(ps,9)+
   (rr.length?'<div class="ratings">'+rr.map(([k,n])=>'<div><small>'+k+'</small><div>'+stars(n)+'</div></div>').join("")+'</div>':"")+
   (v.ordered?'<div><div class="eyebrow">What we had</div><p style="margin:4px 0 0">'+esc(v.ordered)+'</p></div>':"")+
   (v.food_review?'<div><div class="eyebrow">The food</div><p class="quote">'+esc(v.food_review)+'</p></div>':"")+
   (v.place_review?'<div><div class="eyebrow">The place</div><p class="quote">'+esc(v.place_review)+'</p></div>':"")+
   '<div class="row"><button class="btn primary" id="vsEdit">Edit</button><a class="btn" target="_blank" rel="noopener" href="'+esc(gmaps(p))+'">Map ↗</a><button class="btn ghost danger" id="vsDel">Delete</button></div>',
   s=>{wirePhotos(s,ps);s.querySelector("#vsPlace").onclick=()=>placeSheet(p.id);s.querySelector("#vsEdit").onclick=()=>{closeSheet();draft=newDraft({visit:v});setTab("log");};
     let arm=false;s.querySelector("#vsDel").onclick=async ev=>{if(!arm){arm=true;ev.target.textContent="Tap again to delete";return;}try{await S.deleteVisit(id,ps);await refresh();closeSheet();render();toast("Memory deleted");}catch(x){toast(x.message);}};});
}

/* ---------------- LOG / EDIT VISIT ---------------- */
let draft=null;
function newDraft(o={}){
  const v=o.visit;const date=v?.visited_on||todayStr();
  return {visitId:v?.id||null,placeId:v?.place_id||o.placeId||null,newPlace:null,date,fastTouched:!!v,fasting:v?v.fasting:F.info(date).fasting,
    occasion:v?.occasion||"",ordered:v?.ordered||"",food_review:v?.food_review||"",place_review:v?.place_review||"",
    r_food:v?.r_food||0,r_vibe:v?.r_vibe||0,r_service:v?.r_service||0,r_value:v?.r_value||0,spent:v?.spent_birr??"",files:[],removed:[]};
}
function placeFields(p={}){
  return '<label class="f">Name<input class="inp" id="pfName" maxlength="120" value="'+esc(p.name||"")+'"></label>'+
   '<div class="grid2"><label class="f">Area<input class="inp" id="pfArea" list="areas" value="'+esc(p.area||"")+'" placeholder="Bole"></label><label class="f">Type<select class="inp" id="pfKind">'+Object.entries(KINDS).map(([k,l])=>'<option value="'+k+'"'+((p.kind||"restaurant")===k?" selected":"")+'>'+l+'</option>').join("")+'</select></label></div>'+
   '<label class="f">Food / cuisine<input class="inp" id="pfCuisine" maxlength="60" value="'+esc(p.cuisine||"")+'" placeholder="Habesha, kitfo, pizza, coffee…"></label>'+
   '<div class="f" style="font-size:.8rem;font-weight:600;color:var(--muted)">Price<div class="chips" id="pfPrice" style="margin-top:6px">'+[1,2,3,4].map(n=>'<button type="button" class="chip" data-p="'+n+'" aria-pressed="'+(p.price_level===n)+'">'+PRICE[n]+'</button>').join("")+'</div></div>'+
   '<label class="toggle">Good fasting (ye tsom) menu<input type="checkbox" id="pfFast"'+(p.fasting_friendly?" checked":"")+'></label>'+
   '<datalist id="areas">'+AREAS.map(a=>'<option value="'+a+'">').join("")+'</datalist>';
}
function wirePlaceFields(root,p={}){let price=p.price_level||null;root.querySelectorAll("#pfPrice [data-p]").forEach(b=>b.onclick=()=>{price=+b.dataset.p===price?null:+b.dataset.p;root.querySelectorAll("#pfPrice [data-p]").forEach(x=>x.setAttribute("aria-pressed",String(+x.dataset.p===price)));});root._price=()=>price;}
function readPlaceFields(root){return {name:root.querySelector("#pfName").value.trim(),area:root.querySelector("#pfArea").value.trim(),kind:root.querySelector("#pfKind").value,cuisine:root.querySelector("#pfCuisine").value.trim(),price_level:root._price?root._price():null,fasting_friendly:root.querySelector("#pfFast").checked};}

function logView(){
  if(!draft)draft=newDraft();const d=draft;const p=d.placeId?placeOf(d.placeId):null;const existingPh=d.visitId?photosOf(d.visitId).filter(x=>!d.removed.includes(x.id)):[];
  const rate=(k,l)=>'<div><small>'+l+'</small><div class="rate" data-r="'+k+'">'+[1,2,3,4,5].map(n=>'<button type="button" data-n="'+n+'" class="'+(d[k]>=n?"on":"")+'" aria-label="'+l+' '+n+'">★</button>').join("")+'</div></div>';
  $("#app").innerHTML='<div class="view"><div><div class="eyebrow">'+(d.visitId?"Edit memory":"New memory")+'</div><h1 class="disp" style="font-size:2.2rem">'+(d.visitId?"Edit our visit":"Where did we go?")+'</h1></div>'+
   '<section class="card" style="display:flex;flex-direction:column;gap:12px">'+
    (p?'<div class="picked"><div><b>'+esc(p.name)+'</b><div class="small muted">'+esc([p.area,p.cuisine].filter(Boolean).join(" · "))+'</div></div><button class="btn ghost small" id="chg">Change</button></div>':
     d.newPlace?'<div class="picked"><div><b>New place</b><div class="small muted">'+(d.newPlace.lat?"Pinned on the map":"Choose a spot")+'</div></div><button class="btn ghost small" id="chg">Change</button></div><div id="newPlaceBox" style="display:flex;flex-direction:column;gap:12px">'+placeFields(d.newPlace)+'<div class="minimap" id="mini"></div><p class="small muted" style="margin:0">Tap the map to place the pin.</p></div>':
     '<label class="f">Find the place<input class="inp" id="q" placeholder="Search our places or anywhere in Addis" autocomplete="off"></label><div class="results" id="qr" hidden></div><button class="btn" id="pinNew" type="button">📍 Not listed? Drop a pin</button>')+
   '</section>'+
   '<section class="card" style="display:flex;flex-direction:column;gap:12px">'+
    '<div class="grid2"><label class="f">Date<input class="inp" type="date" id="vDate" value="'+esc(d.date)+'" max="'+todayStr()+'"></label><label class="f">We spent (birr)<input class="inp num" id="vSpent" inputmode="decimal" value="'+esc(d.spent)+'" placeholder="1,200"></label></div>'+
    '<label class="toggle" id="fastL">Fasting day <span class="small muted" id="fastHint" style="font-weight:500;flex:1">'+esc(F.info(d.date).fasting?F.info(d.date).name:"")+'</span><input type="checkbox" id="vFast"'+(d.fasting?" checked":"")+'></label>'+
    '<label class="f">Occasion<input class="inp" id="vOcc" maxlength="80" value="'+esc(d.occasion)+'" placeholder="Date night, Sunday brunch, her birthday…"></label>'+
    '<label class="f">What we ordered<textarea class="inp" id="vOrd" maxlength="500" placeholder="Beyaynetu, shiro, macchiato…">'+esc(d.ordered)+'</textarea></label>'+
    '<label class="f">Food review<textarea class="inp" id="vFood" maxlength="1500" placeholder="How was the food?">'+esc(d.food_review)+'</textarea></label>'+
    '<label class="f">Place review<textarea class="inp" id="vPlace" maxlength="1500" placeholder="The vibe, the service, the view…">'+esc(d.place_review)+'</textarea></label>'+
    '<div class="ratings">'+rate("r_food","Food")+rate("r_vibe","Vibe")+rate("r_service","Service")+rate("r_value","Value")+'</div>'+
   '</section>'+
   '<section class="card" style="display:flex;flex-direction:column;gap:10px"><div class="eyebrow">Photos</div><div class="thumbs" id="thumbs">'+
    existingPh.map(x=>'<div><img alt="" src="'+esc(urls[x.id]||"")+'"><button type="button" data-rm-old="'+esc(x.id)+'" aria-label="Remove photo">✕</button></div>').join("")+
    d.files.map((f,i)=>'<div><img alt="" src="'+esc(f.url)+'"><button type="button" data-rm-new="'+i+'" aria-label="Remove photo">✕</button></div>').join("")+
    '<label class="addph" aria-label="Add photos">+<input type="file" id="vPh" accept="image/*" multiple hidden></label></div></section>'+
   '<button class="btn primary block" id="vSave">'+(d.visitId?"Save changes":"Save this memory")+'</button><p class="err" id="vErr"></p>'+
   (d.visitId?'<button class="btn ghost" id="vCancel">Cancel</button>':"")+
  '</div>';
  const keep=()=>{d.date=$("#vDate").value;d.spent=$("#vSpent").value;d.fasting=$("#vFast").checked;d.occasion=$("#vOcc").value;d.ordered=$("#vOrd").value;d.food_review=$("#vFood").value;d.place_review=$("#vPlace").value;
    if(d.newPlace&&$("#pfName")){Object.assign(d.newPlace,readPlaceFields($("#newPlaceBox")));}};
  if($("#chg"))$("#chg").onclick=()=>{keep();d.placeId=null;d.newPlace=null;logView();};
  if($("#pinNew"))$("#pinNew").onclick=()=>{keep();d.newPlace={name:$("#q").value.trim(),lat:null,lng:null,kind:"restaurant"};logView();};
  if($("#q"))wireSearch();
  if(d.newPlace){wirePlaceFields($("#newPlaceBox"),d.newPlace);initMini();}
  $("#vDate").onchange=()=>{const fi=F.info($("#vDate").value||todayStr());$("#fastHint").textContent=fi.fasting?fi.name:"";if(!d.fastTouched)$("#vFast").checked=fi.fasting;};
  $("#vFast").onchange=()=>d.fastTouched=true;
  document.querySelectorAll(".rate").forEach(r=>r.querySelectorAll("button").forEach(b=>b.onclick=()=>{const k=r.dataset.r,n=+b.dataset.n;d[k]=d[k]===n?0:n;r.querySelectorAll("button").forEach(x=>x.classList.toggle("on",+x.dataset.n<=d[k]));}));
  $("#vPh").onchange=e=>{keep();for(const f of e.target.files)d.files.push({file:f,url:URL.createObjectURL(f)});logView();};
  document.querySelectorAll("[data-rm-new]").forEach(b=>b.onclick=()=>{keep();d.files.splice(+b.dataset.rmNew,1);logView();});
  document.querySelectorAll("[data-rm-old]").forEach(b=>b.onclick=()=>{keep();d.removed.push(b.dataset.rmOld);logView();});
  if($("#vCancel"))$("#vCancel").onclick=()=>{draft=null;setTab("memories");};
  $("#vSave").onclick=()=>{keep();saveDraft();};
}
function initMini(){
  if(mini){mini.remove();mini=null;}if(!window.L)return;const d=draft;
  mini=L.map("mini",{zoomControl:true,attributionControl:false}).setView(d.newPlace.lat?[d.newPlace.lat,d.newPlace.lng]:ADDIS,d.newPlace.lat?16:13);tiles().addTo(mini);
  let mk=d.newPlace.lat?L.marker([d.newPlace.lat,d.newPlace.lng],{icon:pinIcon("visited","",24)}).addTo(mini):null;
  mini.on("click",e=>{d.newPlace.lat=+e.latlng.lat.toFixed(6);d.newPlace.lng=+e.latlng.lng.toFixed(6);if(mk)mk.setLatLng(e.latlng);else mk=L.marker(e.latlng,{icon:pinIcon("visited","",24)}).addTo(mini);});
  setTimeout(()=>mini&&mini.invalidateSize(),150);
}
let searchT=null,searchAbort=null;
function wireSearch(){
  const q=$("#q"),out=$("#qr");
  const show=(local,remote,loading)=>{const rows=[];
    for(const p of local)rows.push('<button type="button" data-pick="'+esc(p.id)+'"><b>'+esc(p.name)+'</b><small>Ours · '+esc([p.area,p.cuisine].filter(Boolean).join(" · "))+'</small></button>');
    for(const [i,r] of remote.entries())rows.push('<button type="button" data-osm="'+i+'"><b>'+esc(r.name)+'</b><small>'+esc(r.sub)+'</small></button>');
    if(loading)rows.push('<button type="button" disabled><small>Searching Addis…</small></button>');
    out.innerHTML=rows.join("");out.hidden=!rows.length;
    out.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{draft.placeId=b.dataset.pick;logView();});
    out.querySelectorAll("[data-osm]").forEach(b=>b.onclick=()=>{const r=remote[+b.dataset.osm];draft.newPlace={name:r.name,lat:r.lat,lng:r.lng,area:r.area,kind:r.kind,cuisine:r.cuisine,osm_id:r.osm_id};logView();});};
  q.oninput=()=>{const t=q.value.trim().toLowerCase();clearTimeout(searchT);searchAbort?.abort();
    if(t.length<2){out.hidden=true;return;}
    const local=data.places.filter(p=>p.name.toLowerCase().includes(t)).slice(0,5);
    const ideas=IDEAS.filter(i=>i.name.toLowerCase().includes(t)&&!data.places.some(p=>p.name.toLowerCase()===i.name.toLowerCase())).map(i=>({name:i.name,sub:"Idea · "+i.area+" (approximate location)",lat:i.lat,lng:i.lng,area:i.area,kind:i.kind,cuisine:i.cuisine}));
    show(local,ideas,true);
    searchT=setTimeout(async()=>{searchAbort=new AbortController();
      try{const u="https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&bounded=1&viewbox=38.62,9.12,38.95,8.82&q="+encodeURIComponent(q.value.trim());
        const r=await (await fetch(u,{signal:searchAbort.signal,headers:{"Accept-Language":"en"}})).json();
        const rem=r.map(x=>{const a=x.address||{};const area=a.suburb||a.neighbourhood||a.quarter||a.city_district||"";return {name:x.name||x.display_name.split(",")[0],sub:[area,x.type&&x.type.replace(/_/g," ")].filter(Boolean).join(" · "),lat:+(+x.lat).toFixed(6),lng:+(+x.lon).toFixed(6),area,kind:{cafe:"cafe",bar:"bar",pub:"bar",bakery:"bakery",park:"park",museum:"culture"}[x.type]||(x.type==="restaurant"||x.type==="fast_food"?"restaurant":"other"),cuisine:(x.extratags&&x.extratags.cuisine)||"",osm_id:x.osm_type+"/"+x.osm_id};});
        show(local,ideas.concat(rem),false);}catch(e){if(e.name!=="AbortError")show(local,ideas,false);}},550);};
}
async function saveDraft(){
  const d=draft,btn=$("#vSave"),err=$("#vErr");err.textContent="";
  let placeId=d.placeId;
  if(!placeId&&!d.newPlace){err.textContent="Pick the place first.";return;}
  if(d.newPlace){if(!d.newPlace.name){err.textContent="Give the new place a name.";return;}if(d.newPlace.lat==null){err.textContent="Tap the map to pin where it is.";return;}}
  if(!d.date){err.textContent="Pick the date.";return;}
  const spent=d.spent===""?null:Number(String(d.spent).replace(/[, ]/g,""));if(spent!=null&&(isNaN(spent)||spent<0)){err.textContent="Spent should be a number of birr.";return;}
  btn.disabled=true;btn.textContent="Saving…";
  try{
    if(!placeId){const np=d.newPlace;const r=await S.savePlace({name:np.name,lat:np.lat,lng:np.lng,area:np.area||"",kind:np.kind||"restaurant",cuisine:np.cuisine||"",price_level:np.price_level||null,fasting_friendly:!!np.fasting_friendly,osm_id:np.osm_id||null,wishlist:false});placeId=r.id;}
    else{const pl=placeOf(placeId);if(pl&&pl.wishlist)await S.savePlace({id:placeId,wishlist:false});}
    const row={place_id:placeId,visited_on:d.date,occasion:d.occasion.trim(),ordered:d.ordered.trim(),food_review:d.food_review.trim(),place_review:d.place_review.trim(),
      r_food:d.r_food||null,r_vibe:d.r_vibe||null,r_service:d.r_service||null,r_value:d.r_value||null,spent_birr:spent,fasting:!!d.fasting};
    if(d.visitId)row.id=d.visitId;
    const v=await S.saveVisit(row);
    for(const pid of d.removed){const ph=data.photos.find(x=>x.id===pid);if(ph)await S.deletePhoto(ph);}
    for(let i=0;i<d.files.length;i++){btn.textContent="Uploading photo "+(i+1)+" of "+d.files.length+"…";const s=await window.OurAddisImg.shrink(d.files[i].file);await S.addPhoto(v.id,s.blob,s.w,s.h);}
    draft=null;await refresh();toast(d.visitId?"Saved":"Memory saved 💜");setTab("memories");
  }catch(e){err.textContent=e.message||"Couldn’t save. Try again.";btn.disabled=false;btn.textContent="Try again";}
}

/* ---------------- MEMORIES ---------------- */
let memFilter="all";
function memories(){
  let vs=data.visits.slice();
  if(memFilter==="photos")vs=vs.filter(v=>photosOf(v.id).length);if(memFilter==="fast")vs=vs.filter(v=>v.fasting);if(memFilter==="top")vs=vs.filter(v=>(vAvg(v)||0)>=4.5);
  const groups={};for(const v of vs){const k=v.visited_on.slice(0,7);(groups[k]=groups[k]||[]).push(v);}
  $("#app").innerHTML='<div class="view"><div><div class="eyebrow">'+data.visits.length+' memories</div><h1 class="disp" style="font-size:2.2rem">Our memory book</h1></div>'+
   '<div class="chips">'+[["all","All"],["photos","With photos"],["top","Loved it"],["fast","Fasting days"]].map(([k,l])=>'<button class="chip" data-m="'+k+'" aria-pressed="'+(memFilter===k)+'">'+l+'</button>').join("")+'</div>'+
   (vs.length?Object.keys(groups).sort().reverse().map(k=>{const sum=groups[k].reduce((a,v)=>a+Number(v.spent_birr||0),0);return '<section style="display:flex;flex-direction:column;gap:12px"><div class="row between"><h2 class="month">'+new Date(k+"-15T12:00").toLocaleDateString("en-GB",{month:"long",year:"numeric"})+'</h2><span class="small muted">'+groups[k].length+' outing'+(groups[k].length>1?"s":"")+(sum?' · '+birr(sum):"")+'</span></div>'+
     groups[k].map(v=>{const p=placeOf(v.place_id)||{name:"?"};const ps=photosOf(v.id);const a=vAvg(v);const txt=v.food_review||v.place_review||v.ordered;
       return '<div class="card mem" role="button" tabindex="0" data-visit="'+esc(v.id)+'"><div class="row between"><div><div class="eyebrow">'+fmtDate(v.visited_on)+(v.occasion?' · '+esc(v.occasion):"")+'</div><h3>'+esc(p.name)+'</h3></div>'+(a!=null?stars(a):"")+'</div>'+photoGrid(ps,6)+
       (txt?'<p class="quote" style="font-size:1.05rem">'+esc(txt.length>180?txt.slice(0,180)+"…":txt)+'</p>':"")+
       '<div class="row small muted">'+(v.fasting?'<span class="badge b-fast">Fasting</span>':"")+(v.spent_birr?'<span>'+birr(v.spent_birr)+'</span>':"")+(p.area?'<span>'+esc(p.area)+'</span>':"")+'</div></div>';}).join("")+'</section>';}).join(""):
    '<div class="card empty">'+(data.visits.length?"Nothing matches this filter.":"No memories yet. Tap + to log your first outing.")+'</div>')+
  '</div>';
  document.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{memFilter=b.dataset.m;memories();});
  document.querySelectorAll(".mem").forEach(c=>{const ps=photosOf(c.dataset.visit);wirePhotos(c,ps);c.onclick=()=>visitSheet(c.dataset.visit);c.onkeydown=e=>{if(e.key==="Enter")visitSheet(c.dataset.visit);};});
}

/* ---------------- NEXT (AI) ---------------- */
const MOODS=["Habesha / beyaynetu","Kitfo & meat","Pizza & Italian","Burgers","Coffee & cake","Brunch","Asian","Fine dining","Rooftop / view","Something outdoors"];
const BUDGETS=[["under 800 birr","Under 800"],["800–2,000 birr","800–2,000"],["2,000–5,000 birr","2,000–5,000"],["over 5,000 birr (splurge)","5,000+"]];
const NOVELTY=[["new","Somewhere new"],["mix","A mix"],["favourite","Our favourites"]];
let nextState={mood:"",budget:"800–2,000 birr",area:"",novelty:"mix",notes:"",result:null,loading:false,err:""},nextAbort=null;
function nextView(){
  const fi=F.info(todayStr()),ns=nextState;
  const chipset=(name,opts,val)=>'<div class="chips">'+opts.map(([v,l])=>'<button type="button" class="chip" data-'+name+'="'+esc(v)+'" aria-pressed="'+(val===v)+'">'+esc(l)+'</button>').join("")+'</div>';
  $("#app").innerHTML='<div class="view"><div><div class="eyebrow">Ask Claude</div><h1 class="disp" style="font-size:2.2rem">Where should we go next?</h1></div>'+fastCard(fi)+
   '<section class="card" style="display:flex;flex-direction:column;gap:14px">'+
    '<div><div class="eyebrow" style="margin-bottom:8px">In the mood for</div>'+chipset("mood",(fi.fasting?[["Fasting food (ye tsom)","Fasting food (ye tsom)"]]:[]).concat(MOODS.map(m=>[m,m])),ns.mood)+'</div>'+
    '<div><div class="eyebrow" style="margin-bottom:8px">Budget for two</div>'+chipset("budget",BUDGETS,ns.budget)+'</div>'+
    '<div><div class="eyebrow" style="margin-bottom:8px">New or familiar</div>'+chipset("nov",NOVELTY,ns.novelty)+'</div>'+
    '<div class="grid2"><label class="f">Area<input class="inp" id="nArea" list="areas2" value="'+esc(ns.area)+'" placeholder="Anywhere"></label><label class="f">Anything else?<input class="inp" id="nNotes" maxlength="200" value="'+esc(ns.notes)+'" placeholder="Quiet, live music, kid-free…"></label></div><datalist id="areas2">'+AREAS.map(a=>'<option value="'+a+'">').join("")+'</datalist>'+
    '<div class="grid2"><button class="btn primary" id="nGo"'+(ns.loading?" disabled":"")+'>✨ Recommend</button><button class="btn" id="nOff">Quick offline picks</button></div>'+
   '</section><div id="nOut"></div><div id="nHist"></div></div>';
  const rd=()=>{ns.area=$("#nArea").value.trim();ns.notes=$("#nNotes").value.trim();};
  document.querySelectorAll("[data-mood]").forEach(b=>b.onclick=()=>{rd();ns.mood=ns.mood===b.dataset.mood?"":b.dataset.mood;nextView();});
  document.querySelectorAll("[data-budget]").forEach(b=>b.onclick=()=>{rd();ns.budget=b.dataset.budget;nextView();});
  document.querySelectorAll("[data-nov]").forEach(b=>b.onclick=()=>{rd();ns.novelty=b.dataset.nov;nextView();});
  $("#nGo").onclick=()=>{rd();askAI(fi);};
  $("#nOff").onclick=()=>{rd();ns.result={summary:"Quick picks from your own places and our starter list (no internet search).",picks:offlinePicks(fi),offline:true};ns.err="";renderNext();};
  renderNext();
  if(S.mode==="supabase")S.recentRecs().then(rs=>{const h=$("#nHist");if(!h||!rs.length)return;h.innerHTML='<section class="card"><div class="eyebrow">Earlier suggestions</div><div class="list">'+rs.map((r,i)=>'<button class="li" data-rec="'+i+'"><span class="ic">✨</span><span><b>'+esc((r.result.picks||[]).map(p=>p.name).slice(0,3).join(", "))+'</b><small>'+new Date(r.created_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})+' · '+esc(r.request.mood||"anything")+'</small></span><span></span></button>').join("")+'</div></section>';
    h.querySelectorAll("[data-rec]").forEach(b=>b.onclick=()=>{ns.result=rs[+b.dataset.rec].result;ns.err="";renderNext();$("#nOut").scrollIntoView({behavior:"smooth"});});}).catch(()=>{});
}
function renderNext(){
  const o=$("#nOut");if(!o)return;const ns=nextState;
  if(ns.loading){o.innerHTML='<div class="card"><div class="think"><i></i><span>Claude is searching Addis food reviews for you. This takes 20–60 seconds…</span></div><button class="btn ghost" id="nStop" style="margin-top:8px">Stop</button></div>';$("#nStop").onclick=()=>{nextAbort?.abort();ns.loading=false;renderNext();};return;}
  if(!ns.result&&!ns.err){o.innerHTML="";return;}
  const r=ns.result;
  o.innerHTML=(ns.err?'<div class="card"><p class="err" style="margin:0">'+esc(ns.err)+'</p></div>':"")+(r?'<div style="display:flex;flex-direction:column;gap:12px">'+(r.summary?'<p class="quote">'+esc(r.summary)+'</p>':"")+
   r.picks.map((p,i)=>{const known=data.places.find(x=>x.name.toLowerCase()===String(p.name||"").toLowerCase());const src=(p.source_urls||[]).map(safeUrl).filter(Boolean).slice(0,3);
    return '<article class="card pick"><div class="row between"><div><div class="eyebrow">'+esc([p.area,p.cuisine||p.type].filter(Boolean).join(" · "))+'</div><h3>'+esc(p.name)+'</h3></div>'+(p.est_cost_birr_for_two?'<span class="badge" style="background:var(--gold-soft);color:var(--gold)">~'+birr(p.est_cost_birr_for_two)+'</span>':"")+'</div>'+
     '<div class="row">'+(p.fasting_ok?'<span class="badge b-fast">Fasting OK</span>':"")+(p.new_for_us&&!known?'<span class="badge b-new">New for us</span>':"")+(known&&pStats(known.id).n?'<span class="badge b-fav">Been '+pStats(known.id).n+'×</span>':"")+'</div>'+
     '<p style="margin:0">'+esc(p.why)+'</p>'+(p.order?'<p class="small" style="margin:0"><b>Order:</b> '+esc(p.order)+'</p>':"")+
     (src.length?'<div class="src">'+src.map(u=>{let h="";try{h=new URL(u).hostname.replace(/^www\./,"");}catch{}return '<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(h)+' ↗</a>';}).join("")+'</div>':"")+
     '<div class="row">'+(known?'<button class="btn small" data-open="'+esc(known.id)+'">Open</button>':'<button class="btn small" data-wish="'+i+'">♡ Want to try</button>')+'<a class="btn small ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent((p.name||"")+" "+(p.area||"")+" Addis Ababa")+'">Map ↗</a></div></article>';}).join("")+
   (r.offline?'':'<p class="small muted">Suggestions come from a web search and may be out of date. Check opening hours before you go.</p>')+'</div>':"");
  o.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>placeSheet(b.dataset.open));
  o.querySelectorAll("[data-wish]").forEach(b=>b.onclick=async()=>{const p=r.picks[+b.dataset.wish];b.disabled=true;b.textContent="Saving…";
    let lat=Number(p.lat),lng=Number(p.lng),approx=false;
    if(!(lat>8.7&&lat<9.25&&lng>38.55&&lng<39.05)){try{const g=await (await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=38.62,9.12,38.95,8.82&q="+encodeURIComponent(p.name))).json();if(g[0]){lat=+g[0].lat;lng=+g[0].lon;}else{lat=ADDIS[0];lng=ADDIS[1];approx=true;}}catch{lat=ADDIS[0];lng=ADDIS[1];approx=true;}}
    await saveWish({name:String(p.name).slice(0,120),area:p.area||"",kind:["restaurant","cafe","bar","bakery","park"].includes(p.type)?p.type:"other",cuisine:p.cuisine||"",lat,lng,fasting_friendly:!!p.fasting_ok,notes:String(p.why||"").slice(0,400)+(approx?" (location unknown, edit the pin)":"")});
    b.textContent="♥ Saved";});
}
async function askAI(fi){
  const ns=nextState;ns.loading=true;ns.err="";ns.result=null;renderNext();$("#nGo").disabled=true;
  nextAbort=new AbortController();const my=nextAbort;
  try{const r=await S.recommend({date:todayStr(),fasting:{fasting:fi.fasting,name:fi.name,day:fi.day,total:fi.total},mood:ns.mood,budget:ns.budget,area:ns.area,novelty:ns.novelty,notes:ns.notes});
    if(my.signal.aborted)return;ns.result=r;}
  catch(e){if(my.signal.aborted)return;ns.err=e.message+(e.code!=="limit"?" Here are some offline picks meanwhile.":"");ns.result={picks:offlinePicks(fi),offline:true,summary:""};}
  finally{if(!my.signal.aborted){ns.loading=false;if(tab==="next"){renderNext();const g=$("#nGo");if(g)g.disabled=false;}}}
}
function offlinePicks(fi){
  const ns=nextState;const bmax={"under 800 birr":1,"800–2,000 birr":2,"2,000–5,000 birr":3,"over 5,000 birr (splurge)":4}[ns.budget]||4;
  const mood=(ns.mood||"").toLowerCase(),area=(ns.area||"").toLowerCase();
  const cands=[];
  for(const p of data.places){const st=pStats(p.id);cands.push({name:p.name,area:p.area,cuisine:p.cuisine,type:p.kind,price:p.price_level||2,fasting:p.fasting_friendly,lat:p.lat,lng:p.lng,visits:st.n,avg:st.avg,why:st.n?"You've been "+st.n+"×"+(st.avg?" and rated it "+st.avg.toFixed(1)+"/5":"")+".":(p.wishlist?"On your want-to-try list.":p.notes||"Saved place."),spend:st.avgSpent});}
  for(const i of IDEAS)if(!cands.some(c=>c.name.toLowerCase()===i.name.toLowerCase()))cands.push({name:i.name,area:i.area,cuisine:i.cuisine,type:i.kind,price:i.price,fasting:i.fasting,lat:i.lat,lng:i.lng,visits:0,avg:null,why:i.why});
  const kw=mood.split(/[\s/&,()]+/).filter(w=>w.length>2&&!["and","food","something","the"].includes(w));
  const score=c=>{let s=0;const hay=(c.name+" "+c.cuisine+" "+c.type).toLowerCase();
    if(fi.fasting&&!c.fasting)return -99;if(c.price>bmax)s-=3;
    for(const w of kw)if(hay.includes(w)||(w==="habesha"&&/habesha|tsom|kitfo|gurage/.test(hay))||(w==="coffee"&&/cafe|coffee/.test(hay))||(w==="outdoors"&&c.type==="park"))s+=3;
    if(area&&(c.area||"").toLowerCase().includes(area))s+=2;
    if(ns.novelty==="new")s+=c.visits?-4:2;else if(ns.novelty==="favourite")s+=(c.avg||0)+(c.visits?2:-2);else s+=c.visits?(c.avg||3)/2:1;
    return s+Math.random()*.8;};
  return cands.map(c=>({c,s:score(c)})).filter(x=>x.s>-50).sort((a,b)=>b.s-a.s).slice(0,4).map(({c})=>({name:c.name,area:c.area,cuisine:c.cuisine,type:c.type,why:c.why,est_cost_birr_for_two:c.spend?Math.round(c.spend):[0,500,1500,3500,7000][c.price||2],fasting_ok:!!c.fasting,new_for_us:!c.visits,lat:c.lat,lng:c.lng}));
}

/* ---------------- render ---------------- */
const VIEWS={home,map:mapView,log:logView,memories,next:nextView};
function render(){if(tab!=="map"&&map){map.remove();map=null;}if(tab!=="log"&&mini){mini.remove();mini=null;}(VIEWS[tab]||home)();}
start();
})();
