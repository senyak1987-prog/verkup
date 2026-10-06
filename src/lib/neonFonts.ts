export type StrokePoint = [number,number];
export type StrokeGlyph = { advance:number; paths:StrokePoint[][] };
export type StrokeFont = { capHeight:number; capTop:number; glyphs:Record<string,StrokeGlyph> };
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
function attributes(tag:string) { return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decode(m[2]??m[3])])); }
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
      // Subdivide according to curvature: a long straight stem needs two points,
      // while a small handwriting loop must not turn into sixteen sharp chords.
      const controls:StrokePoint[]=cmd==='C'?[origin,a,b,c]:[origin,a,b];
      const flatten=(points:StrokePoint[],depth:number)=>{
        const first=points[0],last=points[points.length-1],dx=last[0]-first[0],dy=last[1]-first[1],chord=Math.hypot(dx,dy);
        const error=Math.max(...points.slice(1,-1).map(p=>chord?Math.abs(dx*(first[1]-p[1])-(first[0]-p[0])*dy)/chord:Math.hypot(p[0]-first[0],p[1]-first[1])));
        const polygon=points.reduce((sum,p,index)=>sum+(index?Math.hypot(p[0]-points[index-1][0],p[1]-points[index-1][1]):0),0);
        if(depth>=12||(error<=.15&&polygon-chord<=.15)){add(last);return;}
        const left:StrokePoint[]=[first],right:StrokePoint[]=[last];let level=points;
        while(level.length>1){level=level.slice(0,-1).map((p,index)=>[(p[0]+level[index+1][0])/2,(p[1]+level[index+1][1])/2] as StrokePoint);left.push(level[0]);right.unshift(level[level.length-1]);}
        flatten(left,depth+1);flatten(right,depth+1);
      };
      flatten(controls,0);
    } else if(cmd==='Z'){add(start);command='';}
    else throw new Error('Неподдерживаемый контур однолинейного шрифта.');
  }
  if(path.length>1)paths.push(path);return paths;
}
export function registerNeonFont(id:string,svg:string) {
  if(!/<svg\b/.test(svg))throw new Error('Не удалось прочитать неоновый шрифт. Повторите загрузку.');
  const face=attributes(svg.match(/<font-face\b[^>]*>/)?.[0]??'');
  const rawAdvance=Number(attributes(svg.match(/<font\b[^>]*>/)?.[0]??'')['horiz-adv-x']);
  const defaultAdvance=Number.isFinite(rawAdvance)&&rawAdvance>0?rawAdvance:500;
  const glyphs:Record<string,StrokeGlyph>={};
  for(const tag of svg.match(/<glyph\b[^>]*\/?\s*>/g)??[]) {
    const a=attributes(tag);
    if(!a.unicode||Array.from(a.unicode).length!==1)continue;
    const advance=a['horiz-adv-x']===undefined?defaultAdvance:Number(a['horiz-adv-x']);
    const paths=a.d?sampleStrokePath(a.d):[];
    if(!Number.isFinite(advance)||advance<=0||(!/^\s$/u.test(a.unicode)&&!paths.length))throw new Error('Не удалось прочитать контуры неонового шрифта. Повторите загрузку.');
    glyphs[a.unicode]={advance,paths};
  }
  const reference=glyphs.H?.paths.flat();
  const capTop=reference?.length?Math.max(...reference.map(p=>p[1])):Number(face['cap-height']);
  const capHeight=reference?.length?capTop-Math.min(...reference.map(p=>p[1])):Number(face['cap-height']);
  // SVG cap-height metadata differs from the converted centerlines. Their
  // actual top is needed to place a capital at y=0, even with negative stems.
  if(!glyphs.A?.paths.length||!glyphs.a?.paths.length||!glyphs.H?.paths.length||!Number.isFinite(capHeight)||capHeight<=0||!Number.isFinite(capTop))throw new Error('Не удалось прочитать неоновый шрифт.');
  fonts.set(id,{capHeight,capTop,glyphs});
}
export const getNeonFont=(id:string)=>fonts.get(id);
export function loadNeonFont(id:string):Promise<void> {
  if(fonts.has(id))return Promise.resolve();
  const entry=EXTERNAL_NEON_FONTS.find(f=>f.id===id);if(!entry)return Promise.resolve();
  let request=requests.get(id);
  if(!request) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    request=fetch(import.meta.env.BASE_URL+'neon-fonts/'+entry.file,{signal:controller.signal})
      .then(r=>{if(!r.ok)throw new Error('Шрифт не загрузился. Выберите другой или повторите позже.');return r.text();})
      .then(svg=>registerNeonFont(id,svg))
      .catch(error=>{requests.delete(id);throw error instanceof Error&&error.name==='AbortError'?new Error('Загрузка шрифта заняла слишком долго. Повторите попытку.'):error;})
      .finally(()=>clearTimeout(timeout));
    requests.set(id,request);
  }
  return request;
}
