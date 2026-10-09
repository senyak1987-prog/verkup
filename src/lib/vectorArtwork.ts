/** Saved vector artwork contains geometry only: never SVG markup, scripts or URLs. */
export type VectorArtworkBox = { x: number; y: number; width: number; height: number };
export type VectorArtworkObject = {
  id: string; name: string; pathData: string; box: VectorArtworkBox;
  color: string; height: number; offset: { x: number; y: number }; visible: boolean;
};
export const VECTOR_MAX_OBJECTS = 64;
export const VECTOR_MAX_COMMANDS = 30000;
export const VECTOR_MAX_FILE_BYTES = 10 * 1024 * 1024;
export type VectorPathCommand = { type: 'M' | 'L' | 'Q' | 'C' | 'Z'; values: number[] };
export type VectorMatrix = readonly [number, number, number, number, number, number];
export const vectorIdentity: VectorMatrix = [1, 0, 0, 1, 0, 0];
const COUNTS = { M: 2, L: 2, Q: 4, C: 6, Z: 0 } as const;
const NUMBER = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?';
const finite = (n: unknown, limit = 100000): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
const n = (value: number) => String(Number(value.toFixed(6)));

/** Strict, bounded absolute path parser, shared by import and untrusted project loading. */
export function parseVectorPath(path: string): VectorPathCommand[] {
  if (typeof path !== 'string' || !path || path.length > 2000000) throw new Error('Некорректный или слишком сложный векторный контур.');
  const tokens = path.match(new RegExp(`[MLQCZ]|${NUMBER}`, 'g')) ?? [];
  if (path.replace(new RegExp(`[MLQCZ]|${NUMBER}|[\\s,]`, 'g'), '')) throw new Error('Вектор содержит неподдерживаемые команды.');
  const result: VectorPathCommand[] = [];
  let i = 0, started = false, drawing = false, closed = false;
  while (i < tokens.length) {
    const type = tokens[i++] as VectorPathCommand['type'];
    if (!(type in COUNTS)) throw new Error('Некорректная последовательность команд вектора.');
    const count = COUNTS[type], values = tokens.slice(i, i + count).map(Number); i += count;
    if (values.length !== count || values.some(v => !finite(v))) throw new Error('Координаты вектора повреждены или слишком велики.');
    if (type === 'M') {
      if (started && !closed) throw new Error('Все контуры должны быть замкнуты.');
      started = true; drawing = false; closed = false;
    } else {
      if (!started || closed) throw new Error('Некорректный векторный контур.');
      if (type === 'Z') { if (!drawing) throw new Error('Пустой векторный контур.'); closed = true; }
      else drawing = true;
    }
    result.push({ type, values });
    if (result.length > VECTOR_MAX_COMMANDS) throw new Error('В файле более 30 000 команд. Упростите контуры.');
  }
  if (!started || !closed) throw new Error('Все контуры должны быть замкнуты. Преобразуйте обводки в объекты.');
  return result;
}

export function serializeVectorPath(commands: VectorPathCommand[]): string {
  return commands.map(({ type, values }) => type + values.map(n).join(' ')).join('');
}
export function multiplyVectorMatrices(a: VectorMatrix, b: VectorMatrix): VectorMatrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function transformVectorPath(path: string, matrix: VectorMatrix): string {
  if (!matrix.every(v => finite(v))) throw new Error('Некорректное преобразование вектора.');
  return serializeVectorPath(parseVectorPath(path).map(({ type, values }) => {
    const transformed: number[] = [];
    for(let i=0;i<values.length;i+=2) transformed.push(matrix[0]*values[i]+matrix[2]*values[i+1]+matrix[4], matrix[1]*values[i]+matrix[3]*values[i+1]+matrix[5]);
    return { type, values: transformed };
  }));
}

/** Exact extrema keep dimensions independent of tessellation and control-point overshoot. */
export function vectorPathBounds(path: string): VectorArtworkBox {
  const commands = parseVectorPath(path), xs: number[] = [], ys: number[] = [];
  let point = [0,0], start = point;
  const append = (x:number,y:number) => { xs.push(x); ys.push(y); };
  for(const {type,values:v} of commands) {
    if(type==='M') { point=[v[0],v[1]]; start=point; append(...point as [number,number]); }
    else if(type==='L') { point=[v[0],v[1]]; append(...point as [number,number]); }
    else if(type==='Z') { point=start; }
    else {
      const end = type==='C' ? [v[4],v[5]] : [v[2],v[3]];
      append(...end as [number,number]);
      for(let axis=0;axis<2;axis++) {
        const p0=point[axis], p1=v[axis], p2=type==='C'?v[2+axis]:end[axis], p3=end[axis];
        let roots: number[];
        if(type==='Q') { const denominator=p0-2*p1+p2; roots=Math.abs(denominator)<1e-12?[]:[(p0-p1)/denominator]; }
        else {
          const a=-p0+3*p1-3*p2+p3, b=2*(p0-2*p1+p2), c=p1-p0, d=b*b-4*a*c;
          roots=Math.abs(a)<1e-12?(Math.abs(b)<1e-12?[]:[-c/b]):d<0?[]:[(-b+Math.sqrt(d))/(2*a),(-b-Math.sqrt(d))/(2*a)];
        }
        for(const t of roots) if(t>0&&t<1) {
          const u=1-t, value=type==='Q'?u*u*p0+2*u*t*p1+t*t*p2:u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;
          (axis===0?xs:ys).push(value);
        }
      }
      point=end;
    }
  }
  const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
  if(![x,y,width,height].every(v=>finite(v)) || width<.0001 || height<.0001 || width>50000 || height>50000) throw new Error('Вектор пустой или его размеры превышают допустимые.');
  return {x,y,width,height};
}

export function vectorArtworkBounds(objects: readonly VectorArtworkObject[]): VectorArtworkBox {
  if(!objects.length) return {x:0,y:0,width:0,height:0};
  const x=Math.min(...objects.map(o=>o.box.x)),y=Math.min(...objects.map(o=>o.box.y));
  return {x,y,width:Math.max(...objects.map(o=>o.box.x+o.box.width))-x,height:Math.max(...objects.map(o=>o.box.y+o.box.height))-y};
}

export function createVectorArtworkObject(input:{name:string;pathData:string;color:string;id?:string}):VectorArtworkObject {
  const box=vectorPathBounds(input.pathData);
  return {id:input.id??crypto.randomUUID(),name:input.name.slice(0,80),pathData:input.pathData,box,color:input.color.toLowerCase(),height:Math.max(1,Math.min(700,box.height)),offset:{x:0,y:0},visible:true};
}

export function validateVectorArtwork(value: unknown): VectorArtworkObject[] {
  if(value===undefined||value===null) return [];
  if(!Array.isArray(value)||value.length>VECTOR_MAX_OBJECTS) throw new Error('В проекте допускается до 64 векторных объектов.');
  let commands=0;
  const ids=new Set<string>();
  return value.map(raw=>{
    if(!raw || typeof raw!=='object') throw new Error('Повреждённый векторный объект.');
    const v=raw as Record<string,unknown>;
    if(typeof v.id!=='string'||!/^[-\w]{1,80}$/.test(v.id)||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>80||/[\x00-\x1f]/.test(v.name)) throw new Error('Некорректное имя или идентификатор вектора.');
    if(typeof v.color!=='string'||!/^#[\da-f]{6}$/i.test(v.color)||!finite(v.height,700)||v.height<1||typeof v.visible!=='boolean') throw new Error('Некорректные параметры векторного объекта.');
    const offset=v.offset as Record<string,unknown>|undefined;
    if(!offset||!finite(offset.x,50000)||!finite(offset.y,50000)||typeof v.pathData!=='string') throw new Error('Некорректное положение векторного объекта.');
    commands+=parseVectorPath(v.pathData).length;
    if(commands>VECTOR_MAX_COMMANDS) throw new Error('В проекте более 30 000 векторных команд.');
    const box=vectorPathBounds(v.pathData), supplied=v.box as Record<string,unknown>|undefined;
    if(!supplied || !(['x','y','width','height'] as const).every(key=>finite(supplied[key])&&Math.abs(Number(supplied[key])-box[key])<.01)) throw new Error('Размеры векторного объекта не совпадают с его контуром.');
    ids.add(v.id);
    return {id:v.id,name:v.name,pathData:v.pathData,box,color:v.color.toLowerCase(),height:v.height,offset:{x:offset.x,y:offset.y},visible:v.visible};
  });
}
