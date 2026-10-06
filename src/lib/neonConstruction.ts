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
export type NeonDesign = { width: number; height: number; paths: NeonPoint[][]; cuts: { visibleMm: number; cutMm: number; hiddenTailMm: number }[]; radius: number };
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
    if (!la || !lc || angle < .02 || Math.PI-angle < .22) { output.push(b); continue; }
    const tangent = radius / Math.tan(angle / 2);
    if (tangent > Math.min(la,lc) / 2) throw new Error('Увеличьте высоту неоновой надписи для этого изгиба.');
    const start: NeonPoint = [b[0]+u[0]*tangent,b[1]+u[1]*tangent];
    const end: NeonPoint = [b[0]+v[0]*tangent,b[1]+v[1]*tangent];
    const bisector = [u[0]+v[0], u[1]+v[1]], norm = Math.hypot(...bisector);
    const distance = radius / Math.sin(angle / 2);
    const center: NeonPoint = [b[0]+bisector[0]/norm*distance,b[1]+bisector[1]/norm*distance];
    const from = Math.atan2(start[1]-center[1],start[0]-center[0]);
    let sweep = Math.atan2(end[1]-center[1],end[0]-center[0])-from;
    while(sweep > Math.PI) sweep-=Math.PI*2; while(sweep < -Math.PI) sweep+=Math.PI*2;
    for(let step=0;step<=12;step++) { const theta=from+sweep*step/12; output.push([center[0]+radius*Math.cos(theta),center[1]+radius*Math.sin(theta)]); }
  }
  if(closed && output.length) output.push(output[0]);
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
  const points=simplifyStroke(raw,radius*.4);
  if(points.length<3)return [points];
  const closed=length(points[0],points[points.length-1])<.001;
  const input=closed?points.slice(0,-1):points;
  const breaks:number[]=[];
  for(let i=0;i<input.length;i++) {
    if(!closed&&(i===0||i===input.length-1))continue;
    const a=input[(i+input.length-1)%input.length],b=input[i],c=input[(i+1)%input.length],la=length(a,b),lc=length(c,b);
    const cosine=((a[0]-b[0])*(c[0]-b[0])+(a[1]-b[1])*(c[1]-b[1]))/(la*lc),angle=Math.acos(Math.max(-1,Math.min(1,cosine)));
    if(angle>.02&&Math.PI-angle>.22&&radius/Math.tan(angle/2)>Math.min(la,lc)/2)breaks.push(i);
  }
  if(!breaks.length)return [roundNeonCorners(points,radius)];
  // Split tight joins into separately cut lengths instead of reducing the bend radius.
  const first=closed?breaks[0]:0;
  const open=closed?[...input.slice(first),...input.slice(0,first),input[first]]:input;
  const indices=closed?breaks.slice(1).map(i=>(i-first+input.length)%input.length).sort((a,b)=>a-b):breaks;
  const result:NeonPoint[][]=[];let from=0;
  for(const end of [...indices,open.length-1]) {
    const segment=open.slice(from,end+1).map(p=>[...p] as NeonPoint);
    const trim=(index:number,next:number)=>{const a=segment[index],b=segment[next],d=length(a,b),amount=Math.min(radius*1.5,d*.35);segment[index]=[a[0]+(b[0]-a[0])*amount/d,a[1]+(b[1]-a[1])*amount/d];};
    if(segment.length>1) {
      if(closed||from>0)trim(0,1);
      if(closed||end<open.length-1)trim(segment.length-1,segment.length-2);
      const total=segment.reduce((sum,p,i)=>sum+(i?length(p,segment[i-1]):0),0);
      if(total>radius)result.push(...adaptTubeStroke(segment,radius));
    }
    from=end;
  }
  return result;
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
export function createNeonDesign(text: string, height: number, diameter: number, font: string, align='center'): NeonDesign {
  const paths: NeonPoint[][]=[]; const pathRows:number[]=[];
  const external=EXTERNAL_NEON_FONTS.some(f=>f.id===font),data=getNeonFont(font);
  if(external&&!data)throw new Error('Шрифт загружается.');
  const handwritten=font==='handwritten'||font==='signature';
  const lines=text.normalize('NFC').trim().split('\n').slice(0,2),lineWidths:number[]=[];
  const sx=height/100*(font==='narrow'?.72:font==='signature'?.85:1),sy=height/100;
  const gap=Math.max(diameter*2,height*(handwritten?.03:.16));
  for(let row=0;row<lines.length;row++) {
    let x=0;const rowPaths:NeonPoint[][]=[];
    for(const char of lines[row]) {
      if(char===' '){x+=height*.4;continue;}
      let strokes:NeonPoint[][]=[],advance=70,scaleX=sx,scaleY=sy;
      if(data) {
        const glyph=data.glyphs[char];
        if(!glyph)throw new Error(`Этот шрифт не содержит «${char}». Выберите шрифт с кириллицей или измените текст.`);
        strokes=glyph.paths.map(path=>path.map(([px,py])=>[px,data.capHeight-py] as NeonPoint));
        advance=glyph.advance;scaleX=scaleY=height/data.capHeight;
      } else if(handwritten&&/^[\p{L}]$/u.test(char)) {
        const lower=char.toLowerCase(),key=HANDWRITTEN_LATIN[lower]??lower;
        if(!HANDWRITTEN_GLYPHS[key])throw new Error(`Неоновый шрифт не содержит «${char}».`);
        strokes=sampleStrokePath(HANDWRITTEN_GLYPHS[key]);advance=Math.max(50,...strokes.flat().map(p=>p[0]));
      } else {
        const key=latin[char.toUpperCase()]??char.toUpperCase();
        const soft=font==='soft'?SOFT_GLYPHS[key]:undefined;
        const definition=glyphs[key];
        if(!definition)throw new Error(`Неоновый шрифт не содержит «${char}». Используйте русские, латинские буквы и цифры.`);
        if(soft)strokes=sampleStrokePath(soft);
        else for(const stroke of definition.split('|')) strokes.push(stroke==='@'?Array.from({length:65},(_,i)=>[35+35*Math.cos(i*Math.PI/32),50+50*Math.sin(i*Math.PI/32)] as NeonPoint):stroke.split(' ').map(pair=>pair.split(',').map(Number) as NeonPoint));
        advance=Math.max(70,...strokes.flat().map(p=>p[0]));
      }
      for(const points of strokes) {
        const physical=points.map(([px,py])=>[x+px*scaleX+((font==='slanted'||font==='signature')?(100-py)*sy*.18:0),py*scaleY+row*height*1.55] as NeonPoint);
        rowPaths.push(...adaptTubeStroke(physical,diameter/2));
      }
      x+=advance*scaleX+gap;
    }
    lineWidths.push(Math.max(1,x-gap));paths.push(...rowPaths);pathRows.push(...rowPaths.map(()=>row));
  }
  const longest=Math.max(...lineWidths);
  paths.forEach((path,index)=>path.forEach(point=>{const space=longest-lineWidths[pathRows[index]];point[0]+=align==='left'?0:align==='right'?space:space/2;}));
  const flat=paths.flat();
  const minX=Math.min(0,...flat.map(p=>p[0])),maxX=Math.max(1,...flat.map(p=>p[0]));
  const minY=Math.min(0,...flat.map(p=>p[1])),maxY=Math.max(height,...flat.map(p=>p[1]));
  const width=maxX-minX+diameter,totalHeight=maxY-minY+diameter;
  for(const path of paths)for(const point of path){point[0]+=diameter/2-minX;point[1]+=diameter/2-minY;}
  const cuts=paths.map(path=>{const visibleMm=path.reduce((sum,p,i)=>sum+(i?length(path[i-1],p):0),0),cutMm=Math.ceil((visibleMm-1e-7)/10)*10;return {visibleMm,cutMm,hiddenTailMm:cutMm-visibleMm};});
  return {width,height:totalHeight,paths,cuts,radius:diameter/2};
}
export function neonBackerOutline(design:NeonDesign,width:number,height:number,shape:string):NeonPoint[] {
  if(shape!=='contour') {
    const radius=shape==='rounded'?Math.min(45,width/4,height/4):0;
    if(!radius)return [[0,0],[width,0],[width,height],[0,height]];
    return [[width-radius,radius],[width-radius,height-radius],[radius,height-radius],[radius,radius]].flatMap(([cx,cy],corner)=>Array.from({length:9},(_,i)=>{const angle=-Math.PI/2+corner*Math.PI/2+i*Math.PI/16;return [cx+radius*Math.cos(angle),cy+radius*Math.sin(angle)] as NeonPoint;}));
  }
  const points=design.paths.flat().map(([x,y])=>[(width-design.width)/2+x,(height-design.height)/2+y] as NeonPoint).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(points.length<3)return [[0,0],[width,0],[width,height],[0,height]];
  const cross=(a:NeonPoint,b:NeonPoint,c:NeonPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=(items:NeonPoint[])=>{const hull:NeonPoint[]=[];for(const p of items){while(hull.length>1&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();hull.push(p);}hull.pop();return hull;};
  const hull=[...half(points),...half([...points].reverse())];
  const minX=Math.min(...hull.map(p=>p[0])),maxX=Math.max(...hull.map(p=>p[0])),minY=Math.min(...hull.map(p=>p[1])),maxY=Math.max(...hull.map(p=>p[1]));
  return hull.map(([x,y])=>[(x-minX)/(maxX-minX||1)*width,(y-minY)/(maxY-minY||1)*height]);
}
export function neonHolderPositions(outline:NeonPoint[],width:number,height:number):NeonPoint[] {
  return [[0,0],[width,0],[width,height],[0,height]].map(corner=>{const nearest=outline.reduce((a,b)=>length(a,corner as NeonPoint)<length(b,corner as NeonPoint)?a:b);const dx=width/2-nearest[0],dy=height/2-nearest[1],d=Math.hypot(dx,dy);return [nearest[0]+dx/d*28,nearest[1]+dy/d*28] as NeonPoint;});
}
export function neonSvg(design: NeonDesign, backerWidth: number, backerHeight: number, diameter: number, color: string, night: boolean, dimensions: boolean, shape="rectangle", brightness=85) {
  const pad=Math.max(80,backerHeight*.2), width=backerWidth+pad*2, height=backerHeight+pad*2;
  const x=(width-design.width)/2,y=(height-design.height)/2;
  const outline=neonBackerOutline(design,backerWidth,backerHeight,shape),holders=neonHolderPositions(outline,backerWidth,backerHeight);
  const backerPath=outline.map((p,i)=>`${i?'L':'M'}${p[0]+pad} ${p[1]+pad}`).join(' ')+'Z';
  const power=brightness/100;
  const strokes=design.paths.map(points=>`<polyline points="${points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Неоновая вывеска"><defs><filter id="neon-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${diameter*2}"/></filter></defs><path d="${backerPath}" fill="${night?'#94c7ce':'#fff'}" fill-opacity=".07" stroke="${night?'#b9dae2':'#70888a'}" stroke-opacity=".6" stroke-width="2"/>${holders.map(([cx,cy])=>`<circle cx="${pad+cx}" cy="${pad+cy}" r="7" fill="#9caeac" stroke="#f5faf8" stroke-width="2"/>`).join('')}<g transform="translate(${x} ${y})" fill="none" stroke-linejoin="round" stroke-linecap="round">${night?`<g stroke="${color}" stroke-width="${diameter*2}" opacity="${power*.6}" filter="url(#neon-bloom)">${strokes}</g>`:''}<g stroke="#263c38" stroke-width="${diameter+2}" opacity=".2" transform="translate(2 4)">${strokes}</g><g stroke="${color}" stroke-width="${diameter}">${strokes}</g><g stroke="${night?'#fff9ed':'#ffffff'}" stroke-opacity="${night?power*.85:'.45'}" stroke-width="${diameter*.35}">${strokes}</g></g>${dimensions?`<g data-dimensions="true" fill="${night?'#d5e8e1':'#194d36'}" stroke="${night?'#d5e8e1':'#194d36'}" font-family="Arial" font-size="24"><path d="M${pad} ${height-pad/2}H${width-pad}M${width-pad/2} ${pad}V${height-pad}"/><text x="${width/2}" y="${height-pad/4}" text-anchor="middle" stroke="none">${Math.round(backerWidth)} мм</text><text x="${width-pad/4}" y="${height/2}" text-anchor="middle" stroke="none" transform="rotate(-90 ${width-pad/4} ${height/2})">${Math.round(backerHeight)} мм</text></g>`:''}</svg>`;
}
