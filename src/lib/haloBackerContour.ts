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
    // Separate contours attach to the steel frame; do not bridge counters or word spaces.
  }
  const traced=traceAlpha(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,Math.max(.2,Math.min(.8,scale*.35)),true);
  const n=(value:number)=>Number(value.toFixed(3));
  const path=traced.replace(/([MLQC])([^MLQCZ]+)/g,(_match,command:string,coordinates:string)=>
    command+coordinates.trim().split(/[\s,]+/).map((value,index)=>n(Number(value)/scale+(index%2?top:left))).join(' '));
  if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(key,path);return path;
}
