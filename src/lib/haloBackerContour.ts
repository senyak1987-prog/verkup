import { traceAlpha } from './systemFontContours';

type Box = { x:number; y:number; width:number; height:number };
type Row = { pathData:string; naturalBox:Box; pathBox:Box; inkBox:Box };
const cache = new Map<string,string>();

/** Offset the actual letter silhouettes in millimetres, filling counters for a solid flat plate. */
export function haloBackerContour(rows:Row[], requestedOffset:number):string {
  const offset=Math.max(15,Math.min(25,requestedOffset));
  const drawable=rows.filter(row=>row.pathData && row.naturalBox.width>0 && row.naturalBox.height>0);
  if(!drawable.length || typeof document==='undefined') return '';
  const key=JSON.stringify([drawable,offset]), previous=cache.get(key); if(previous!==undefined) return previous;
  const left=Math.min(...drawable.map(r=>r.inkBox.x))-offset-3;
  const top=Math.min(...drawable.map(r=>r.inkBox.y))-offset-3;
  const width=Math.max(...drawable.map(r=>r.inkBox.x+r.inkBox.width))+offset+3-left;
  const height=Math.max(...drawable.map(r=>r.inkBox.y+r.inkBox.height))+offset+3-top;
  const scale=Math.min(2,4096/width,2048/height,Math.sqrt(3_000_000/(width*height)));
  const canvas=document.createElement('canvas'); canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return '';
  ctx.setTransform(scale,0,0,scale,-left*scale,-top*scale);
  ctx.fillStyle=ctx.strokeStyle='#000';ctx.lineWidth=offset*2;ctx.lineJoin=ctx.lineCap='round';
  for(const row of drawable){
    const sx=row.pathBox.width/row.naturalBox.width,sy=row.pathBox.height/row.naturalBox.height;
    const transform=new DOMMatrix([sx,0,0,sy,row.pathBox.x-row.naturalBox.x*sx,row.pathBox.y-row.naturalBox.y*sy]);
    for(const subpath of row.pathData.match(/M[^M]*/gi)??[]){
      const path=new Path2D();path.addPath(new Path2D(subpath),transform);ctx.fill(path);ctx.stroke(path);
    }
    // A narrow web joins the letters into one manufacturable plate per line.
    ctx.beginPath();ctx.moveTo(row.pathBox.x+offset,row.pathBox.y+row.pathBox.height/2);
    ctx.lineTo(row.pathBox.x+row.pathBox.width-offset,row.pathBox.y+row.pathBox.height/2);ctx.stroke();
  }
  const traced=traceAlpha(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,Math.max(.7,scale*.8));
  const n=(value:number)=>Number(value.toFixed(3));
  const path=(traced.match(/M[^M]*/g)??[]).map(part=>{
    const points=Array.from(part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g),m=>({x:Number(m[1])/scale+left,y:Number(m[2])/scale+top}));
    if(points.length>1 && points[0].x===points[points.length-1].x && points[0].y===points[points.length-1].y)points.pop();
    if(points.length<3)return '';
    const radius=1/scale, corner=(a:typeof points[number],b:typeof points[number])=>{
      const distance=Math.hypot(b.x-a.x,b.y-a.y),t=Math.min(.45,radius/Math.max(distance,.001));
      return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    };
    const start=corner(points[0],points[points.length-1]);
    return `M${n(start.x)} ${n(start.y)}`+points.map((p,i)=>{
      const before=corner(p,points[(i+points.length-1)%points.length]),after=corner(p,points[(i+1)%points.length]);
      return `L${n(before.x)} ${n(before.y)}Q${n(p.x)} ${n(p.y)} ${n(after.x)} ${n(after.y)}`;
    }).join('')+'Z';
  }).join('');
  if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(key,path);return path;
}
