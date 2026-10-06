export type StrokePoint = [number,number];
export type StrokeGlyph = { advance:number; paths:StrokePoint[][] };
export type StrokeFont = { capHeight:number; capTop:number; smooth:boolean; glyphs:Record<string,StrokeGlyph> };
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
function sampleCubic(controls:StrokePoint[],tolerance:number,add:(point:StrokePoint)=>void,depth=0) {
  const first=controls[0],last=controls[controls.length-1],dx=last[0]-first[0],dy=last[1]-first[1],chord=Math.hypot(dx,dy);
  const error=Math.max(...controls.slice(1,-1).map(point=>chord?Math.abs(dx*(first[1]-point[1])-(first[0]-point[0])*dy)/chord:Math.hypot(point[0]-first[0],point[1]-first[1])));
  const polygon=controls.reduce((sum,point,index)=>sum+(index?Math.hypot(point[0]-controls[index-1][0],point[1]-controls[index-1][1]):0),0);
  if(depth>=14||(error<=tolerance&&polygon-chord<=tolerance)){add(last);return;}
  const left:StrokePoint[]=[first],right:StrokePoint[]=[last];let level=controls;
  while(level.length>1){level=level.slice(0,-1).map((point,index)=>[(point[0]+level[index+1][0])/2,(point[1]+level[index+1][1])/2] as StrokePoint);left.push(level[0]);right.unshift(level[level.length-1]);}
  sampleCubic(left,tolerance,add,depth+1);sampleCubic(right,tolerance,add,depth+1);
}
export function smoothStrokePolyline(points:StrokePoint[],tolerance=.03):StrokePoint[] {
  const distance=(a:StrokePoint,b:StrokePoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const clean=points.filter((point,index)=>!index||distance(point,points[index-1])>.0001);
  if(clean.length<3)return clean.map(point=>[...point] as StrokePoint);
  const closed=distance(clean[0],clean[clean.length-1])<.001,input=closed?clean.slice(0,-1):clean;
  if(input.length<3)return clean.map(point=>[...point] as StrokePoint);
  const tangents=input.map((point,index):StrokePoint=>{
    if(!closed&&index===0){const next=input[1],d=distance(point,next);return [(next[0]-point[0])/d,(next[1]-point[1])/d];}
    if(!closed&&index===input.length-1){const previous=input[index-1],d=distance(point,previous);return [(point[0]-previous[0])/d,(point[1]-previous[1])/d];}
    const previous=input[(index+input.length-1)%input.length],next=input[(index+1)%input.length],a=distance(previous,point),b=distance(point,next);
    const incoming:StrokePoint=[(point[0]-previous[0])/a,(point[1]-previous[1])/a],outgoing:StrokePoint=[(next[0]-point[0])/b,(next[1]-point[1])/b];
    // A true reversal or pointed calligraphic cusp is a deliberate corner.
    // Gentle changes in pen direction are instead a single continuous curve.
    if(incoming[0]*outgoing[0]+incoming[1]*outgoing[1]<-.42)return [0,0];
    return [(incoming[0]*b+outgoing[0]*a)/(a+b),(incoming[1]*b+outgoing[1]*a)/(a+b)];
  });
  const result:StrokePoint[]=[[...input[0]] as StrokePoint];
  for(let index=0;index<input.length-(closed?0:1);index++) {
    const next=(index+1)%input.length,a=input[index],b=input[next],chord=distance(a,b);
    const c1:StrokePoint=[a[0]+tangents[index][0]*chord/3,a[1]+tangents[index][1]*chord/3];
    const c2:StrokePoint=[b[0]-tangents[next][0]*chord/3,b[1]-tangents[next][1]*chord/3];
    sampleCubic([a,c1,c2,b],Math.max(.0001,tolerance),point=>result.push([...point] as StrokePoint));
  }
  return result;
}
export function sampleStrokePath(d:string,tolerance=.15):StrokePoint[][] {
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
      sampleCubic(controls,Math.max(.0001,tolerance),add);
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
  const smooth=EXTERNAL_NEON_FONTS.some(font=>font.id===id&&font.group==='Рукописные');
  if(smooth)for(const glyph of Object.values(glyphs))glyph.paths=glyph.paths.map(path=>smoothStrokePolyline(path,capHeight*.000035));
  const finalReference=glyphs.H.paths.flat(),finalTop=Math.max(...finalReference.map(point=>point[1])),finalHeight=finalTop-Math.min(...finalReference.map(point=>point[1]));
  fonts.set(id,{capHeight:finalHeight,capTop:finalTop,smooth,glyphs});
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
