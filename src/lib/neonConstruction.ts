export const NEON_FONTS = [
  { id: 'rounded', label: 'Неон · округлый' },
  { id: 'slanted', label: 'Неон · наклонный' },
  { id: 'narrow', label: 'Неон · узкий' },
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
};
const latin: Record<string, string> = { A:'А', B:'В', C:'С', E:'Е', H:'Н', K:'К', M:'М', N:'И', O:'О', P:'Р', T:'Т', X:'Х' };
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
    if (!la || !lc || angle < .02 || Math.PI-angle < .02) { output.push(b); continue; }
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
export function createNeonDesign(text: string, height: number, diameter: number, font: string): NeonDesign {
  const paths: NeonPoint[][] = []; const pathRows: number[] = []; const lines = text.trim().toUpperCase().split('\n').slice(0,2);
  const sx = height / 100 * (font === 'narrow' ? .72 : 1), sy = height / 100;
  const gap = Math.max(diameter * 2, height * .16); const lineWidths: number[] = [];
  for(let row=0;row<lines.length;row++) {
    let x=0; const rowPaths: NeonPoint[][]=[];
    for(const char of lines[row]) {
      if(char===' ') { x+=height*.4; continue; }
      const definition=glyphs[latin[char]??char];
      if(!definition) throw new Error(`Неоновый шрифт не содержит «${char}». Используйте русские, латинские буквы и цифры.`);
      let extent=70;
      for(const stroke of definition.split('|')) {
        let points: NeonPoint[];
        if(stroke==='@') points=Array.from({length:65},(_,i)=>[35+35*Math.cos(i*Math.PI/32),50+50*Math.sin(i*Math.PI/32)] as NeonPoint);
        else points=stroke.split(' ').map(pair=>pair.split(',').map(Number) as NeonPoint);
        extent=Math.max(extent,...points.map(p=>p[0]));
        const physical=points.map(([px,py])=>[x+px*sx+(font==='slanted'?(100-py)*sy*.18:0),py*sy+row*height*1.35] as NeonPoint);
        rowPaths.push(stroke==='@'?physical:roundNeonCorners(physical,diameter/2));
      }
      x+=extent*sx+gap;
    }
    lineWidths.push(Math.max(1,x-gap)); paths.push(...rowPaths); pathRows.push(...rowPaths.map(()=>row));
  }
  const longest=Math.max(...lineWidths);
  paths.forEach((path,index)=>path.forEach(point=>{point[0]+=(longest-lineWidths[pathRows[index]])/2;}));
  const flat=paths.flat();
  const minX=Math.min(0,...flat.map(p=>p[0])), maxX=Math.max(1,...flat.map(p=>p[0]));
  const minY=Math.min(0,...flat.map(p=>p[1])), maxY=Math.max(height,...flat.map(p=>p[1]));
  const width=maxX-minX+diameter, totalHeight=maxY-minY+diameter;
  for(const path of paths) for(const point of path) { point[0]+=diameter/2-minX; point[1]+=diameter/2-minY; }
  const cuts=paths.map(path=>{ const visibleMm=path.reduce((sum,p,i)=>sum+(i?length(path[i-1],p):0),0); const cutMm=Math.ceil((visibleMm-1e-7)/10)*10; return {visibleMm,cutMm,hiddenTailMm:cutMm-visibleMm}; });
  return {width,height:totalHeight,paths,cuts,radius:diameter/2};
}
export function neonSvg(design: NeonDesign, backerWidth: number, backerHeight: number, diameter: number, color: string, night: boolean, dimensions: boolean) {
  const pad=Math.max(80,backerHeight*.2), width=backerWidth+pad*2, height=backerHeight+pad*2;
  const x=(width-design.width)/2,y=(height-design.height)/2;
  const strokes=design.paths.map(points=>`<polyline points="${points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' ')}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Неоновая вывеска"><defs><filter id="neon-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${diameter*2}"/></filter></defs><rect x="${pad}" y="${pad}" width="${backerWidth}" height="${backerHeight}" rx="18" fill="${night?'#94c7ce':'#fff'}" fill-opacity=".07" stroke="${night?'#b9dae2':'#70888a'}" stroke-opacity=".6" stroke-width="2"/><path d="M${pad+18} ${pad+backerHeight*.2}V${pad+18}H${pad+backerWidth*.55}" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="3"/>${[pad+22,pad+backerWidth-22].map(cx=>[pad+22,pad+backerHeight-22].map(cy=>`<circle cx="${cx}" cy="${cy}" r="7" fill="#9caeac" stroke="#f5faf8" stroke-width="2"/>`).join('')).join('')}<g transform="translate(${x} ${y})" fill="none" stroke-linejoin="round" stroke-linecap="round">${night?`<g stroke="${color}" stroke-width="${diameter*2}" opacity=".55" filter="url(#neon-bloom)">${strokes}</g>`:''}<g stroke="#263c38" stroke-width="${diameter+2}" opacity=".2" transform="translate(2 4)">${strokes}</g><g stroke="${color}" stroke-width="${diameter}">${strokes}</g><g stroke="${night?'#fff9ed':'#ffffff'}" stroke-opacity="${night?'.8':'.45'}" stroke-width="${diameter*.35}">${strokes}</g></g>${dimensions?`<g data-dimensions="true" fill="${night?'#d5e8e1':'#194d36'}" stroke="${night?'#d5e8e1':'#194d36'}" font-family="Arial" font-size="24"><path d="M${pad} ${height-pad/2}H${width-pad}M${width-pad/2} ${pad}V${height-pad}"/><text x="${width/2}" y="${height-pad/4}" text-anchor="middle" stroke="none">${Math.round(backerWidth)} мм</text><text x="${width-pad/4}" y="${height/2}" text-anchor="middle" stroke="none" transform="rotate(-90 ${width-pad/4} ${height/2})">${Math.round(backerHeight)} мм</text></g>`:''}</svg>`;
}
