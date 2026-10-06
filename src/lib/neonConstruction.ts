import { EXTERNAL_NEON_FONTS, getNeonFont, sampleStrokePath } from './neonFonts';
import { HANDWRITTEN_GLYPHS, HANDWRITTEN_LATIN } from './neonHandwriting';
export const NEON_FONTS = [
  {id:'rounded',label:'Геометрический',group:'Современные',cyrillic:true},
  {id:'soft',label:'Мягкий округлый',group:'Современные',cyrillic:true},
  {id:'slanted',label:'Наклонный',group:'Современные',cyrillic:true},
  {id:'narrow',label:'Узкий',group:'Современные',cyrillic:true},
  {id:'handwritten',label:'Пропись',group:'Рукописные',cyrillic:true},
  {id:'signature',label:'Автограф',group:'Рукописные',cyrillic:true},
  ...EXTERNAL_NEON_FONTS.map(font=>({...font,cyrillic:false})),
] as const;
export type NeonPoint = [number, number];
export type NeonLineBounds={index:number;x:number;y:number;width:number;height:number};
export type NeonDesignOptions={lineFonts?:readonly string[];lineColors?:readonly string[];lineScales?:readonly number[];lineOffsets?:readonly {x:number;y:number}[];icon?:string;targetWidth?:number};
export type NeonDesign = { width: number; height: number; paths: NeonPoint[][]; cuts: { visibleMm: number; cutMm: number; hiddenTailMm: number }[]; radius: number;pathColors?:(string|undefined)[];pathLineIndices?:number[];lines?:NeonLineBounds[];iconBounds?:NeonLineBounds;anchorX?:number;anchorY?:number };
// Single centerlines, deliberately designed for tubing rather than outlined print fonts.
const glyphs: Record<string, string> = {
  А: '0,100 35,0 70,100|13,65 57,65', Б: '70,0 0,0 0,100 48,100 70,82 70,62 48,48 0,48',
  В: '0,100 0,0 48,0 70,17 70,30 48,48 0,48|48,48 70,65 70,82 48,100 0,100',
  Г: '0,100 0,0 70,0', Д: '0,100 15,100 25,0 60,0 70,100 85,100|0,115 0,100 85,100 85,115',
  Е: '70,0 0,0 0,100 70,100|0,50 55,50', Ё: '70,0 0,0 0,100 70,100|0,50 55,50|15,-16 15,-6|55,-16 55,-6',
  Ж: '0,0 35,50 0,100|35,0 35,100|70,0 35,50 70,100', З: '0,10 25,0 50,0 70,18 70,30 50,50 25,50|50,50 70,68 70,82 50,100 25,100 0,90',
  И: '0,0 0,100 70,0 70,100', Й: '0,0 0,100 70,0 70,100|20,-18 35,-10 50,-18',
  К: '0,0 0,100|70,0 0,55 70,100', Л: '0,100 20,0 70,0 70,100', М: '0,100 0,0 35,55 70,0 70,100',
  Н: '0,0 0,100|70,0 70,100|0,50 70,50', О: '@', П: '0,100 0,0 70,0 70,100',
  Р: '0,100 0,0 50,0 70,18 70,35 50,50 0,50', С: '70,15 50,0 20,0 0,20 0,80 20,100 50,100 70,85',
  Т: '0,0 70,0|35,0 35,100', У: '0,0 35,60 70,0|35,60 15,100', Ф: '35,0 35,100|35,15 15,15 0,35 0,65 15,85 55,85 70,65 70,35 55,15 35,15',
  Х: '0,0 70,100|70,0 0,100', Ц: '0,0 0,100 70,100 70,0|70,100 80,100 80,115',
  Ч: '0,0 0,45 20,55 70,55|70,0 70,100', Ш: '0,0 0,100 35,100 35,0|35,100 70,100 70,0',
  Щ: '0,0 0,100 35,100 35,0|35,100 70,100 70,0|70,100 80,100 80,115',
  Ъ: '0,0 20,0 20,100 55,100 70,80 70,65 55,50 20,50', Ы: '0,0 0,100 35,100 50,80 50,65 35,50 0,50|70,0 70,100',
  Ь: '0,0 0,100 50,100 70,80 70,65 50,50 0,50', Э: '0,15 20,0 50,0 70,20 70,80 50,100 20,100 0,85|30,50 70,50',
  Ю: '0,0 0,100|0,50 30,50|55,0 35,15 30,35 30,65 35,85 55,100 75,85 80,65 80,35 75,15 55,0',
  Я: '70,100 70,0 20,0 0,20 0,35 20,55 70,55|35,55 0,100',
  '0': '@', '1': '10,20 35,0 35,100|10,100 60,100', '2': '0,20 20,0 50,0 70,20 70,35 0,100 70,100',
  '3': '0,0 70,0 35,45 60,45 70,65 70,80 50,100 20,100 0,85',
  '4': '55,100 55,0 0,65 70,65', '5': '70,0 0,0 0,45 50,45 70,65 70,80 50,100 20,100 0,85',
  '6': '65,10 45,0 20,0 0,25 0,80 20,100 50,100 70,80 70,65 50,45 20,45 0,65',
  '7': '0,0 70,0 20,100', '8': '35,0 10,0 0,20 10,40 60,60 70,80 60,100 10,100 0,80 10,60 60,40 70,20 60,0 35,0',
  '9': '70,35 50,55 20,55 0,35 0,20 20,0 50,0 70,20 70,75 50,100 20,100 0,90',
  '-': '10,50 60,50', '.': '30,90 30,100', '!': '35,0 35,70|35,90 35,100',
  '?': '0,20 20,0 50,0 70,20 70,35 35,60 35,70|35,90 35,100',
  '/': '0,100 70,0', '&': '70,100 10,30 10,15 25,0 45,0 60,15 60,30 0,75 0,85 15,100 45,100 70,60',
  J: '70,0 70,80 50,100 20,100 0,80', U: '0,0 0,80 20,100 50,100 70,80 70,0',
  G: '70,15 50,0 20,0 0,20 0,80 20,100 50,100 70,80 70,55 40,55',
  R: '0,100 0,0 50,0 70,18 70,35 50,50 0,50|35,50 70,100',
  S: '70,15 50,0 20,0 0,20 0,35 20,50 50,50 70,65 70,80 50,100 20,100 0,85',
  V: '0,0 35,100 70,0', W: '0,0 15,100 35,45 55,100 70,0', Y: '0,0 35,50 70,0|35,50 35,100',
  Z: '0,0 70,0 0,100 70,100', Q: '@|40,70 80,110', D: '0,100 0,0 35,0 70,25 70,75 35,100 0,100',
  L: '0,0 0,100 70,100', F: '0,100 0,0 70,0|0,50 55,50', I: '0,0 70,0|35,0 35,100|0,100 70,100',
  N: '0,100 0,0 70,100 70,0',
};
const latin: Record<string, string> = { A:'А', B:'В', C:'С', E:'Е', H:'Н', K:'К', M:'М', O:'О', P:'Р', T:'Т', X:'Х' };
const length = (a: NeonPoint, b: NeonPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function roundNeonCorners(points: NeonPoint[], radius: number): NeonPoint[] {
  const closed = points.length > 2 && length(points[0], points[points.length - 1]) < 0.001;
  const input = closed ? points.slice(0, -1) : points;
  const output: NeonPoint[] = [];
  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (!closed && (i === 0 || i === input.length - 1)) { output.push(b); continue; }
    const a = input[(i - 1 + input.length) % input.length], c = input[(i + 1) % input.length];
    const la = length(a,b), lc = length(c,b);
    const u = [(a[0]-b[0])/la,(a[1]-b[1])/la], v = [(c[0]-b[0])/lc,(c[1]-b[1])/lc];
    const angle = Math.acos(Math.max(-1, Math.min(1, u[0]*v[0]+u[1]*v[1])));
    if (!la || !lc || angle < .02 || Math.PI-angle < .008) { output.push(b); continue; }
    const tangent = radius / Math.tan(angle / 2);
    if (tangent > Math.min(la,lc) + .001) throw new Error('Увеличьте высоту неоновой надписи для этого изгиба.');
    const start: NeonPoint = [b[0]+u[0]*tangent,b[1]+u[1]*tangent];
    const end: NeonPoint = [b[0]+v[0]*tangent,b[1]+v[1]*tangent];
    const bisector = [u[0]+v[0], u[1]+v[1]], norm = Math.hypot(...bisector);
    const distance = radius / Math.sin(angle / 2);
    const center: NeonPoint = [b[0]+bisector[0]/norm*distance,b[1]+bisector[1]/norm*distance];
    const from = Math.atan2(start[1]-center[1],start[0]-center[0]);
    let sweep = Math.atan2(end[1]-center[1],end[0]-center[0])-from;
    while(sweep > Math.PI) sweep-=Math.PI*2; while(sweep < -Math.PI) sweep+=Math.PI*2;
    const steps=Math.max(3,Math.ceil(Math.abs(sweep)/(Math.PI/48)));
    for(let step=0;step<=steps;step++) { const theta=from+sweep*step/steps; output.push([center[0]+radius*Math.cos(theta),center[1]+radius*Math.sin(theta)]); }
  }
  if(closed && output.length) output.push([...output[0]] as NeonPoint);
  return output;
}
function simplifyStroke(points:NeonPoint[],tolerance:number):NeonPoint[] {
  if(points.length<3)return points;
  const a=points[0],b=points[points.length-1],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  let max=0,index=0;
  for(let i=1;i<points.length-1;i++){const p=points[i],t=l2?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)):0,d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d>max){max=d;index=i;}}
  if(max<=tolerance)return [a,b];
  return [...simplifyStroke(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyStroke(points.slice(index),tolerance)];
}
function adaptTubeStroke(raw:NeonPoint[],radius:number):NeonPoint[][] {
  const clean=raw.filter((point,index)=>!index||length(point,raw[index-1])>.0001);
  if(clean.length<3)return [clean];
  const closed=length(clean[0],clean[clean.length-1])<.001;
  const simplified=simplifyStroke(clean,radius*.05);
  const input=closed?simplified.slice(0,-1):simplified;
  const tangentAt=(index:number)=>{
    if(!closed&&(index===0||index===input.length-1))return 0;
    const b=input[index],a=input[(index+input.length-1)%input.length],c=input[(index+1)%input.length];
    const la=length(a,b),lc=length(c,b);
    if(la<.0001||lc<.0001)return Infinity;
    const cosine=((a[0]-b[0])*(c[0]-b[0])+(a[1]-b[1])*(c[1]-b[1]))/(la*lc);
    const angle=Math.acos(Math.max(-1,Math.min(1,cosine)));
    return Math.PI-angle<.008?0:radius/Math.tan(angle/2);
  };
  // Source SVG curves contain many short adjacent chords. Reserve room for a
  // full-radius bend across those chords instead of cutting the visible stroke.
  // Tiny cusps are softened locally; genuine pen lifts remain separate paths.
  while(input.length>(closed?3:2)) {
    const tangents=input.map((_,index)=>tangentAt(index));let remove=-1,worst=1;
    for(let index=0;index<input.length-(closed?0:1);index++) {
      const next=(index+1)%input.length,available=length(input[index],input[next]);
      const ratio=(tangents[index]+tangents[next])/(available||.0001);
      if(ratio<=worst)continue;
      const removableA=closed||index>0,removableB=closed||next<input.length-1;
      const candidate=removableA&&(!removableB||tangents[index]>=tangents[next])?index:removableB?next:-1;
      if(candidate>=0){remove=candidate;worst=ratio;}
    }
    if(remove<0)break;
    input.splice(remove,1);
  }
  const rounded=roundNeonCorners(closed?[...input,input[0]]:input,radius);
  return [rounded.filter((point,index)=>!index||length(point,rounded[index-1])>.0001)];
}
const SOFT_GLYPHS:Record<string,string>={
  В:'M0 100V0H35C82 0 82 48 35 48H0M35 48C85 48 85 100 35 100H0',
  Б:'M65 0H0V100H35C84 100 84 48 35 48H0',
  С:'M68 15C35 -15 0 3 0 50C0 97 35 115 68 85',
  З:'M0 15C25 -12 72 -2 65 27C62 47 41 50 28 50M28 50C83 42 84 105 36 100C17 100 6 95 0 85',
  Р:'M0 100V0H35C83 0 83 50 35 50H0',
  Э:'M0 15C35 -15 70 3 70 50C70 97 35 115 0 85M30 50H70',
  U:'M0 0V68C0 111 70 111 70 68V0',
  S:'M68 14C25 -20 -15 20 8 40C28 58 64 42 70 71C80 110 25 117 0 86',
  R:'M0 100V0H35C83 0 83 50 35 50H0M35 50L70 100',
};
const NEON_ICONS:Record<string,string>={
  heart:'M50 92C15 69 -4 42 8 22C19 3 39 8 50 28C61 8 81 3 92 22C104 42 85 69 50 92Z',
  star:'M50 5L61 36L95 38L68 59L78 91L50 72L22 91L32 59L5 38L39 36Z',
  bolt:'M60 4L18 58H47L39 96L83 42H54Z',
  cup:'M12 26H70V58C70 87 12 87 12 58V26M70 32C99 26 104 64 70 64M4 91H84M31 7C17 12 41 17 29 22M51 4C37 9 61 14 49 19',
  music:'M31 77V21L78 10V66M31 29L78 18M31 77C10 66 4 93 21 92C32 92 36 81 31 77M78 66C57 55 51 82 68 81C79 81 83 70 78 66',
  infinity:'M50 50C29 16 1 17 1 50C1 83 29 84 50 50C71 16 99 17 99 50C99 83 71 84 50 50Z',
};
export function createNeonDesign(text: string, height: number, diameter: number, font: string, align='center',options:NeonDesignOptions={}): NeonDesign {
  const paths: NeonPoint[][]=[],pathRows:number[]=[],pathColors:(string|undefined)[]=[];
  const textLines=text.normalize('NFC').split('\n').slice(0,3).map(line=>line.trim()),lineWidths:number[]=[];
  const icon=NEON_ICONS[options.icon??'none'],iconScale=height*.8/100,textOrigin=icon?height*.8+Math.max(diameter*3,height*.18):0;
  let rowY=0;
  for(let row=0;row<textLines.length;row++) {
    const rowFont=options.lineFonts?.[row]||font,external=EXTERNAL_NEON_FONTS.some(f=>f.id===rowFont),data=getNeonFont(rowFont);
    if(external&&!data)throw new Error('Шрифт загружается.');
    const handwritten=rowFont==='handwritten'||rowFont==='signature',rowScale=Math.max(.5,Math.min(2,options.lineScales?.[row]??1)),rowHeight=height*rowScale;
    const sx=rowHeight/100*(rowFont==='narrow'?.72:rowFont==='signature'?.85:1),sy=rowHeight/100;
    const gap=Math.max(diameter*2,rowHeight*(handwritten?.03:.16));
    let x=textOrigin;const rowPaths:NeonPoint[][]=[];
    for(const char of textLines[row]) {
      if(char===' '){x+=rowHeight*.4;continue;}
      let strokes:NeonPoint[][]=[],advance=70,scaleX=sx,scaleY=sy;
      if(data) {
        const glyph=data.glyphs[char];
        if(!glyph)throw new Error(`Этот шрифт не содержит «${char}». Выберите шрифт с кириллицей или измените текст.`);
        strokes=glyph.paths.map(path=>path.map(([px,py])=>[px,data.capHeight-py] as NeonPoint));
        advance=glyph.advance;scaleX=scaleY=rowHeight/data.capHeight;
      } else if(handwritten&&/^[\p{L}]$/u.test(char)) {
        const lower=char.toLowerCase(),key=HANDWRITTEN_LATIN[lower]??lower;
        if(!HANDWRITTEN_GLYPHS[key])throw new Error(`Неоновый шрифт не содержит «${char}».`);
        strokes=sampleStrokePath(HANDWRITTEN_GLYPHS[key]);advance=Math.max(50,...strokes.flat().map(p=>p[0]));
      } else {
        const key=latin[char.toUpperCase()]??char.toUpperCase();
        const soft=rowFont==='soft'?SOFT_GLYPHS[key]:undefined;
        const definition=glyphs[key];
        if(!definition)throw new Error(`Неоновый шрифт не содержит «${char}». Используйте русские, латинские буквы и цифры.`);
        if(soft)strokes=sampleStrokePath(soft);
        else for(const stroke of definition.split('|')) strokes.push(stroke==='@'?Array.from({length:65},(_,i)=>[35+35*Math.cos(i*Math.PI/32),50+50*Math.sin(i*Math.PI/32)] as NeonPoint):stroke.split(' ').map(pair=>pair.split(',').map(Number) as NeonPoint));
        advance=Math.max(70,...strokes.flat().map(p=>p[0]));
      }
      for(const points of strokes) {
        const physical=points.map(([px,py])=>[x+px*scaleX+((rowFont==='slanted'||rowFont==='signature')?(100-py)*sy*.18:0),py*scaleY+rowY] as NeonPoint);
        rowPaths.push(...adaptTubeStroke(physical,diameter/2));
      }
      x+=advance*scaleX+gap;
    }
    lineWidths.push(Math.max(1,x-gap-textOrigin));paths.push(...rowPaths);pathRows.push(...rowPaths.map(()=>row));
    const rowColor=options.lineColors?.[row];pathColors.push(...rowPaths.map(()=>rowColor&&/^#[\da-f]{6}$/i.test(rowColor)?rowColor:undefined));
    rowY+=rowHeight*1.55;
  }
  const longest=Math.max(...lineWidths);
  paths.forEach((path,index)=>path.forEach(point=>{const space=longest-lineWidths[pathRows[index]];point[0]+=align==='left'?0:align==='right'?space:space/2;}));
  if(icon)for(const stroke of sampleStrokePath(icon)) {
    paths.push(...adaptTubeStroke(stroke.map(([x,y])=>[x*iconScale,y*iconScale+height*.1] as NeonPoint),diameter/2));
    pathRows.push(-1);pathColors.push(undefined);
  }
  if(options.targetWidth&&options.targetWidth>diameter) {
    const points=paths.flat(),min=Math.min(0,...points.map(p=>p[0])),max=Math.max(1,...points.map(p=>p[0]));
    const stretch=(options.targetWidth-diameter)/(max-min||1);
    for(let index=0;index<paths.length;index++)paths[index]=adaptTubeStroke(paths[index].map(([x,y])=>[(x-min)*stretch,y] as NeonPoint),diameter/2)[0];
  }
  const base=paths.flat(),baseMinX=Math.min(0,...base.map(p=>p[0])),baseMaxX=Math.max(1,...base.map(p=>p[0]));
  const baseMinY=Math.min(0,...base.map(p=>p[1])),baseMaxY=Math.max(height,...base.map(p=>p[1]));
  paths.forEach((path,index)=>{const offset=options.lineOffsets?.[pathRows[index]];if(offset)path.forEach(point=>{point[0]+=Number.isFinite(offset.x)?offset.x:0;point[1]+=Number.isFinite(offset.y)?offset.y:0;});});
  const flat=paths.flat();
  const minX=Math.min(0,...flat.map(p=>p[0])),maxX=Math.max(1,...flat.map(p=>p[0]));
  const minY=Math.min(0,...flat.map(p=>p[1])),maxY=Math.max(height,...flat.map(p=>p[1]));
  const width=maxX-minX+diameter,totalHeight=maxY-minY+diameter;
  for(const path of paths)for(const point of path){point[0]+=diameter/2-minX;point[1]+=diameter/2-minY;}
  const bounds=(index:number):NeonLineBounds|undefined=>{const points=paths.filter((_,pathIndex)=>pathRows[pathIndex]===index).flat();if(!points.length)return;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs)-diameter/2,y=Math.min(...ys)-diameter/2;return {index,x,y,width:Math.max(...xs)+diameter/2-x,height:Math.max(...ys)+diameter/2-y};};
  const lines=textLines.map((_,index)=>bounds(index)).filter((line):line is NeonLineBounds=>!!line);
  const cuts=paths.map(path=>{const visibleMm=path.reduce((sum,p,i)=>sum+(i?length(path[i-1],p):0),0),cutMm=Math.ceil((visibleMm-1e-7)/10)*10;return {visibleMm,cutMm,hiddenTailMm:cutMm-visibleMm};});
  return {width,height:totalHeight,paths,cuts,radius:diameter/2,pathColors,pathLineIndices:pathRows,lines,iconBounds:bounds(-1),anchorX:(baseMinX+baseMaxX)/2+diameter/2-minX,anchorY:(baseMinY+baseMaxY)/2+diameter/2-minY};
}
export function neonDesignPlacement(design:NeonDesign,width:number,height:number) {return {x:width/2-(design.anchorX??design.width/2),y:height/2-(design.anchorY??design.height/2)};}
export function neonRequiredBacker(design:NeonDesign,padding=30) {const x=design.anchorX??design.width/2,y=design.anchorY??design.height/2;return {width:Math.ceil(2*Math.max(x,design.width-x)+padding*2),height:Math.ceil(2*Math.max(y,design.height-y)+padding*2)};}
export function neonBackerOutline(design:NeonDesign,width:number,height:number,shape:string):NeonPoint[] {
  if(shape!=='contour') {
    const radius=shape==='rounded'?Math.min(45,width/4,height/4):0;
    if(!radius)return [[0,0],[width,0],[width,height],[0,height]];
    return [[width-radius,radius],[width-radius,height-radius],[radius,height-radius],[radius,radius]].flatMap(([cx,cy],corner)=>Array.from({length:9},(_,i)=>{const angle=-Math.PI/2+corner*Math.PI/2+i*Math.PI/16;return [cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)] as NeonPoint;}));
  }
  const placement=neonDesignPlacement(design,width,height);
  const centerlines=design.paths.flat().map(([x,y])=>[placement.x+x,placement.y+y] as NeonPoint);
  const xs=centerlines.map(p=>p[0]),ys=centerlines.map(p=>p[1]);
  const padX=Math.max(design.radius+2,Math.min(Math.min(...xs),width-Math.max(...xs))),padY=Math.max(design.radius+2,Math.min(Math.min(...ys),height-Math.max(...ys)));
  const points=centerlines.flatMap(([x,y])=>[[-padX,-padY],[padX,-padY],[padX,padY],[-padX,padY]].map(([dx,dy])=>[Math.max(0,Math.min(width,x+dx)),Math.max(0,Math.min(height,y+dy))] as NeonPoint));
  // Keep requested overall dimensions even when the text is moved away from
  // the center, while the convex envelope still encloses every visible tube.
  points.push([0,height/2],[width,height/2],[width/2,0],[width/2,height]);
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(points.length<3)return [[0,0],[width,0],[width,height],[0,height]];
  const cross=(a:NeonPoint,b:NeonPoint,c:NeonPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(items:NeonPoint[])=>{const hull:NeonPoint[]=[];for(const p of items){while(hull.length>1&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();hull.push(p);}hull.pop();return hull;};
  const hull=[...half(points),...half([...points].reverse())];
  return hull;
}
export function neonHolderPositions(outline:NeonPoint[],width:number,height:number):NeonPoint[] {
  return [[0,0],[width,0],[width,height],[0,height]].map(corner=>{const nearest=outline.reduce((a,b)=>length(a,corner as NeonPoint)<length(b,corner as NeonPoint)?a:b);const dx=width/2-nearest[0],dy=height/2-nearest[1],d=Math.hypot(dx,dy);return [nearest[0]+dx/d*28,nearest[1]+dy/d*28] as NeonPoint;});
}
export type NeonPreviewOptions={lightsOn?:boolean;backerColor?:'clear'|'white'|'black';installMode?:'standoffs'|'hanging'};
export function neonSvg(design: NeonDesign, backerWidth: number, backerHeight: number, diameter: number, color: string, night: boolean, dimensions: boolean, shape="rectangle", brightness=85,options:NeonPreviewOptions={}) {
  const pad=Math.max(80,backerHeight*.2), width=backerWidth+pad*2, height=backerHeight+pad*2;
  const placement=neonDesignPlacement(design,backerWidth,backerHeight),x=pad+placement.x,y=pad+placement.y;
  const outline=neonBackerOutline(design,backerWidth,backerHeight,shape),holders=neonHolderPositions(outline,backerWidth,backerHeight);
  const backerPath=outline.map((p,i)=>`${i?'L':'M'}${p[0]+pad} ${p[1]+pad}`).join(' ')+'Z';
  const power=brightness/100,lightsOn=options.lightsOn!==false,backerColor=options.backerColor??'clear';
  const strokes=(individual=false)=>design.paths.map((points,index)=>`<path${individual&&design.pathColors?.[index]?` stroke="${design.pathColors[index]}"`:''} d="${points.map((p,i)=>`${i?'L':'M'}${p.map(n=>n.toFixed(2)).join(' ')}`).join(' ')}"/>`).join('');
  const backerFill=backerColor==='black'?'#171a20':backerColor==='white'?'#f5f4ef':'#f4fbff';
  const hardware=options.installMode==='hanging'?holders.slice(0,2).map(([cx,cy])=>`<path d="M${pad+cx} ${pad+cy}V${Math.max(8,pad*.12)}" stroke="#939ca6" stroke-width="1.5"/><circle cx="${pad+cx}" cy="${pad+cy}" r="5" fill="none" stroke="#bac3cb" stroke-width="2"/>`).join(''):holders.map(([cx,cy])=>`<circle cx="${pad+cx}" cy="${pad+cy}" r="7" fill="#9ba3aa" stroke="#f5faf8" stroke-width="2"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Неоновая вывеска" data-lights-on="${lightsOn}"><defs><filter id="neon-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${diameter*2}"/></filter></defs><path d="${backerPath}" fill="${backerFill}" fill-opacity="${backerColor==='clear'?'.07':'1'}" stroke="${night?'#bac7d0':'#85909b'}" stroke-opacity=".65" stroke-width="2"/>${hardware}<g transform="translate(${x} ${y})" fill="none" stroke-linejoin="round" stroke-linecap="round">${lightsOn?`<g data-neon-glow="true" stroke="${color}" stroke-width="${diameter*2}" opacity="${power*(night?.62:.15)}" filter="url(#neon-bloom)">${strokes(true)}</g>`:''}<g stroke="#1c2026" stroke-width="${diameter+2}" opacity=".18" transform="translate(2 4)">${strokes()}</g><g stroke="${color}" stroke-width="${diameter}">${strokes(true)}</g><g stroke="#fff9f0" stroke-opacity="${lightsOn?power*(night?.87:.55):'.16'}" stroke-width="${diameter*.35}">${strokes()}</g></g>${dimensions?`<g data-dimensions="true" fill="${night?'#e2e8f0':'#334155'}" stroke="${night?'#e2e8f0':'#334155'}" font-family="Arial" font-size="24"><path d="M${pad} ${height-pad/2}H${width-pad}M${width-pad/2} ${pad}V${height-pad}"/><text x="${width/2}" y="${height-pad/4}" text-anchor="middle" stroke="none">${Math.round(backerWidth)} мм</text><text x="${width-pad/4}" y="${height/2}" text-anchor="middle" stroke="none" transform="rotate(-90 ${width-pad/4} ${height/2})">${Math.round(backerHeight)} мм</text></g>`:''}</svg>`;
}
