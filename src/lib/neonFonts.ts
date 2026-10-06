export type StrokePoint = [number,number];
export type StrokeGlyph = { advance:number; paths:StrokePoint[][] };
export type StrokeFont = { capHeight:number; glyphs:Record<string,StrokeGlyph> };
export const EXTERNAL_NEON_FONTS = [
  {id:'allure',label:'Allure',group:'Рукописные',file:'EMSAllure.svg'},
  {id:'casual',label:'Casual Hand',group:'Рукописные',file:'EMSCasualHand.svg'},
  {id:'pepita',label:'Pepita',group:'Рукописные',file:'EMSPepita.svg'},
  {id:'elfin',label:'Elfin',group:'Рукописные',file:'EMSElfin.svg'},
  {id:'script',label:'Hershey Script',group:'Рукописные',file:'HersheyScript1.svg'},
  {id:'swiss',label:'Swiss',group:'Рукописные',file:'EMSSwiss.svg'},
  {id:'league',label:'League',group:'Рукописные',file:'EMSLeague.svg'},
  {id:'tech',label:'Tech',group:'Современные',file:'EMSTech.svg'},
] as const;
const fonts=new Map<string,StrokeFont>(),requests=new Map<string,Promise<void>>();
const decode=(value:string)=>value.replace(/&#x([\da-f]+);/gi,(_a,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_a,n)=>String.fromCodePoint(+n)).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function attributes(tag:string) { return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])])); }
export function sampleStrokePath(d:string):StrokePoint[][] {
  const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[];
  const paths:StrokePoint[][]=[]; let path:StrokePoint[]=[],point:StrokePoint=[0,0],start:StrokePoint=[0,0],i=0,command='';
  const add=(p:StrokePoint)=>{if(!path.length||Math.hypot(p[0]-point[0],p[1]-point[1])>.001)path.push(p);point=p;};
  while(i<tokens.length) {
    if(/^[a-zA-Z]$/.test(tokens[i]))command=tokens[i++];
    const relative=command===command.toLowerCase(),cmd=command.toUpperCase(),origin=point;
    const number=()=>{const n=Number(tokens[i++]);if(!Number.isFinite(n))throw new Error('Поврежден однолинейный шрифт.');return n;};
    const pair=():StrokePoint=>[number()+(relative?origin[0]:0),number()+(relative?origin[1]:0)];
    if(cmd==='M') {if(path.length>1)paths.push(path);path=[];point=pair();start=point;path.push(point);command=relative?'l':'L';}
    else if(cmd==='L')add(pair());
    else if(cmd==='H')add([number()+(relative?origin[0]:0),origin[1]]);
    else if(cmd==='V')add([origin[0],number()+(relative?origin[1]:0)]);
    else if(cmd==='C'||cmd==='Q') {
      const a=pair(),b=pair(),c=cmd==='C'?pair():b;
      for(let step=1;step<=16;step++) {const t=step/16,u=1-t;add(cmd==='C'?[u*u*u*origin[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t*t*t*c[0],u*u*u*origin[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t*t*t*c[1]]:[u*u*origin[0]+2*u*t*a[0]+t*t*b[0],u*u*origin[1]+2*u*t*a[1]+t*t*b[1]]);}
    } else if(cmd==='Z'){add(start);command='';}
    else throw new Error('Неподдерживаемый контур однолинейного шрифта.');
  }
  if(path.length>1)paths.push(path);return paths;
}
export function registerNeonFont(id:string,svg:string) {
  const face=attributes(svg.match(/<font-face\b[^>]*>/)?.[0]??'');
  const defaultAdvance=Number(attributes(svg.match(/<font\b[^>]*>/)?.[0]??'')['horiz-adv-x'])||500;
  const glyphs:Record<string,StrokeGlyph>={};
  for(const tag of svg.match(/<glyph\b[^>]*\/?\s*>/g)??[]) {const a=attributes(tag);if(a.unicode?.length===1)glyphs[a.unicode]={advance:Number(a['horiz-adv-x'])||defaultAdvance,paths:a.d?sampleStrokePath(a.d):[]};}
  const reference=glyphs.H?.paths.flat();
  const capHeight=reference?.length?Math.max(...reference.map(p=>p[1]))-Math.min(...reference.map(p=>p[1])):Number(face['cap-height'])||500;
  if(!glyphs.A||!glyphs.a||!capHeight)throw new Error('Не удалось прочитать неоновый шрифт.');
  fonts.set(id,{capHeight,glyphs});
}
export const getNeonFont=(id:string)=>fonts.get(id);
export function loadNeonFont(id:string):Promise<void> {
  if(fonts.has(id))return Promise.resolve();
  const entry=EXTERNAL_NEON_FONTS.find(f=>f.id===id);if(!entry)return Promise.resolve();
  let request=requests.get(id);if(!request){request=fetch(import.meta.env.BASE_URL+'neon-fonts/'+entry.file).then(r=>{if(!r.ok)throw new Error('Шрифт не загрузился. Выберите другой или повторите позже.');return r.text();}).then(svg=>registerNeonFont(id,svg)).catch(error=>{requests.delete(id);throw error;});requests.set(id,request);}return request;
}
