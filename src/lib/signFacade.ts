export const SIGN_PLACEMENTS = [{id:'none',title:'Без фасада'},{id:'windows',title:'Над окнами'},{id:'shop',title:'Над витриной'},{id:'canopy',title:'На козырьке'},{id:'entrance',title:'У входа'}] as const;
export type SignPlacement = typeof SIGN_PLACEMENTS[number]['id'];
type FacadeRect = {x:number;y:number;w:number;h:number;color:string;z?:number};
export function facadeRects(place: SignPlacement, night: boolean): FacadeRect[] {
  const rects: FacadeRect[] = [{x:0,y:0,w:500,h:280,color:night?'#243e38':'#e2dfd3',z:-45}];
  for(const y of [25,140,267]) rects.push({x:0,y,w:500,h:3,color:night?'#375049':'#cec9bc'});
  const glass=night?'#cfb477':'#85a8ac';
  if(place==='entrance') rects.push({x:310,y:145,w:100,h:123,color:'#24463e'},{x:323,y:158,w:74,h:98,color:glass},{x:388,y:199,w:3,h:22,color:'#f4e9c4'});
  else if(place==='shop') {
    rects.push({x:50,y:150,w:400,h:118,color:'#24463e'},{x:60,y:160,w:380,h:100,color:glass});
    for(const x of [170,330]) rects.push({x,y:155,w:8,h:110,color:'#355347'});
  } else for(const x of [60,210,360]) rects.push({x,y:150,w:85,h:115,color:'#416754'},{x:x+7,y:157,w:71,h:101,color:glass},{x:x+40,y:157,w:5,h:101,color:'#496b59'},{x:x+7,y:205,w:71,h:5,color:'#496b59'});
  if(place==='canopy') rects.push({x:30,y:58,w:440,h:78,color:'#668373',z:12},{x:20,y:130,w:460,h:14,color:'#1d5540',z:15});
  return rects;
}
export function createFacadeSvg(place: SignPlacement, markup: string, night: boolean, prefix='main-facade') {
  const rects=facadeRects(place,night).map(r=>`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.color}"/>`).join('');
  const inner=markup.replace(/^<\?xml[^>]*\?>\s*/,'').replace(/<svg\b([^>]*)>/,(_tag,attrs:string)=>'<svg x="75" y="40" width="350" height="90" '+attrs.replace(/\s(?:width|height)="[^"]*"/g,'')+'>')
    .replace(/id="([^"]+)"/g,(_a,id:string)=>`id="${prefix}-${id}"`).replace(/url\(#([^\)]+)\)/g,(_a,id:string)=>`url(#${prefix}-${id})`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 280" role="img" aria-label="Размещение: ${SIGN_PLACEMENTS.find(p=>p.id===place)?.title}">${rects}${inner}</svg>`;
}
