/* Ethiopian Orthodox Tewahedo fasting calendar + Ethiopian date, computed (no network).
   Rules used:
   - Fasika (Easter) = Julian-calendar Easter, shown in the Gregorian calendar.
   - Nineveh: Mon-Wed, 69-67 days before Fasika. Abiy Tsom (Hudade): 55 days before Fasika up to Easter eve.
   - Tsome Hawaryat: Monday after Pentecost (Fasika + 51) through Hamle 4.
   - Filseta: Nehase 1-15. Tsome Nebiyat: Hidar 15 - Tahsas 28. Gahad of Timket: Tir 10.
   - Wednesdays & Fridays (Tsome Dihnet) except the 50 days from Fasika to Pentecost and Genna to Timket.
*/
(function(g){
  const DAY=864e5;
  const utc=(y,m,d)=>Date.UTC(y,m-1,d);
  const ymd=ms=>new Date(ms).toISOString().slice(0,10);
  function fasika(y){ // Julian Easter -> Gregorian (valid 1900-2099)
    const a=y%4,b=y%7,c=y%19,d=(19*c+15)%30,e=(2*a+4*b-d+34)%7;
    const m=Math.floor((d+e+114)/31),day=((d+e+114)%31)+1;
    return utc(y,m,day)+13*DAY;
  }
  // Meskerem 1 in Gregorian year y (Sept 11, or Sept 12 when the next Gregorian year is a leap year)
  function enkutatash(y){const ny=y+1;const leap=(ny%4===0&&ny%100!==0)||ny%400===0;return utc(y,9,leap?12:11);}
  // Ethiopian date for a Gregorian day (ms at UTC midnight)
  const MONTHS=["Meskerem","Tikimt","Hidar","Tahsas","Tir","Yekatit","Megabit","Miyazya","Ginbot","Sene","Hamle","Nehase","Pagume"];
  const MONTHS_AM=["መስከረም","ጥቅምት","ኅዳር","ታኅሣሥ","ጥር","የካቲት","መጋቢት","ሚያዝያ","ግንቦት","ሰኔ","ሐምሌ","ነሐሴ","ጳጉሜ"];
  function ethDate(ms){
    const y=new Date(ms).getUTCFullYear();let ny=enkutatash(y),ey=y-7;
    if(ms<ny){ny=enkutatash(y-1);ey=y-8;}
    const n=Math.round((ms-ny)/DAY);const m=Math.floor(n/30);return {year:ey,month:m+1,day:n%30+1,name:MONTHS[m],nameAm:MONTHS_AM[m]};
  }
  function periods(y){ // fasting periods whose dates fall around Gregorian year y
    const out=[];
    const E=fasika(y);
    out.push({key:"nineveh",name:"Tsome Nenewe",nameAm:"ጾመ ነነዌ",en:"Fast of Nineveh",from:E-69*DAY,to:E-67*DAY});
    out.push({key:"abiy",name:"Abiy Tsom",nameAm:"ዐቢይ ጾም",en:"The Great Lent (Hudade)",from:E-55*DAY,to:E-1*DAY});
    const NYprev=enkutatash(y-1);
    const hamle4=NYprev+(10*30+3)*DAY;
    out.push({key:"hawaryat",name:"Tsome Hawaryat",nameAm:"ጾመ ሐዋርያት",en:"Fast of the Apostles",from:E+51*DAY,to:hamle4});
    out.push({key:"filseta",name:"Tsome Filseta",nameAm:"ጾመ ፍልሰታ",en:"Fast of the Assumption",from:NYprev+(11*30)*DAY,to:NYprev+(11*30+14)*DAY});
    for(const base of [enkutatash(y-1),enkutatash(y)]){
      out.push({key:"nebiyat",name:"Tsome Nebiyat",nameAm:"ጾመ ነቢያት",en:"Advent fast of the Prophets",from:base+74*DAY,to:base+117*DAY});
      out.push({key:"gahad",name:"Gahad of Timket",nameAm:"ገሀድ",en:"Eve of Epiphany",from:base+129*DAY,to:base+129*DAY});
    }
    return {list:out,E};
  }
  function info(date){ // date: Date or 'YYYY-MM-DD'
    const d=typeof date==="string"?Date.parse(date+"T00:00:00Z"):utc(date.getFullYear(),date.getMonth()+1,date.getDate());
    const y=new Date(d).getUTCFullYear();
    const all=[...periods(y-1).list,...periods(y).list,...periods(y+1).list];
    const hit=all.find(p=>d>=p.from&&d<=p.to);
    const eth=ethDate(d);
    if(hit){const day=Math.round((d-hit.from)/DAY)+1,total=Math.round((hit.to-hit.from)/DAY)+1;
      return {fasting:true,key:hit.key,name:hit.name,nameAm:hit.nameAm,en:hit.en,day,total,endsOn:ymd(hit.to),eth};}
    const dow=new Date(d).getUTCDay();
    if(dow===3||dow===5){
      const E1=periods(y).E;const inFifty=d>=E1&&d<=E1+49*DAY;
      const ny=enkutatash(y-1),ny2=enkutatash(y);
      const inGenna=(d>=ny+118*DAY&&d<=ny+130*DAY)||(d>=ny2+118*DAY&&d<=ny2+130*DAY);
      if(!inFifty&&!inGenna)return {fasting:true,key:"dihnet",name:dow===3?"Wednesday fast":"Friday fast",nameAm:"ጾመ ድኅነት",en:"Weekly fast (Wednesday & Friday)",eth};
    }
    return {fasting:false,key:"fisk",name:"Fisk day",nameAm:"ፍስክ",en:"Not a fasting day",eth};
  }
  function nextFast(date){const s=typeof date==="string"?date:ymd(utc(date.getFullYear(),date.getMonth()+1,date.getDate()));let d=Date.parse(s+"T00:00:00Z");for(let i=1;i<200;i++){const r=info(ymd(d+i*DAY));if(r.fasting&&r.key!=="dihnet")return Object.assign({date:ymd(d+i*DAY)},r);}return null;}
  g.Fasting={info,nextFast,fasika:y=>ymd(fasika(y)),ethDate:s=>ethDate(Date.parse(s+"T00:00:00Z"))};
})(typeof window!=="undefined"?window:globalThis);
