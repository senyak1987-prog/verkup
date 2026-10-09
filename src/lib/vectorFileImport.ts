import type { Curve, Vector2, Path, EllipseCurve, LineCurve, QuadraticBezierCurve, CubicBezierCurve } from 'three';
import { Color } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { createVectorArtworkObject, multiplyVectorMatrices, parseVectorPath, serializeVectorPath, transformVectorPath, validateVectorArtwork, vectorIdentity, vectorPathBounds, VECTOR_MAX_COMMANDS, VECTOR_MAX_FILE_BYTES, VECTOR_MAX_OBJECTS } from './vectorArtwork';
import type { VectorArtworkObject, VectorMatrix, VectorPathCommand } from './vectorArtwork';

export type VectorFileImportResult = { name: string; format: 'pdf' | 'svg' | 'cdr'; objects: VectorArtworkObject[]; warnings: string[] };
const MM_PER_POINT = 25.4 / 72;
const MM_PER_PIXEL = 25.4 / 96;
const error = (message:string): never => { throw new Error(message); };
const addWarning = (warnings:string[],message:string) => { if(!warnings.includes(message)) warnings.push(message); };
const number = (value:number) => String(Number(value.toFixed(6)));

function ellipseCommands(curve:EllipseCurve):VectorPathCommand[] {
  const tau=Math.PI*2, same=Math.abs(curve.aEndAngle-curve.aStartAngle)<1e-12;
  let delta=curve.aEndAngle-curve.aStartAngle;
  while(delta<0) delta+=tau;
  while(delta>tau) delta-=tau;
  if(delta<1e-12) delta=same?0:tau;
  if(curve.aClockwise&&!same) delta=delta===tau?-tau:delta-tau;
  const count=Math.max(1,Math.ceil(Math.abs(delta)/(Math.PI/4))), step=delta/count;
  const cs=Math.cos(curve.aRotation),sn=Math.sin(curve.aRotation);
  const at=(a:number)=>[curve.aX+curve.xRadius*Math.cos(a)*cs-curve.yRadius*Math.sin(a)*sn,curve.aY+curve.xRadius*Math.cos(a)*sn+curve.yRadius*Math.sin(a)*cs];
  const derivative=(a:number)=>[-curve.xRadius*Math.sin(a)*cs-curve.yRadius*Math.cos(a)*sn,-curve.xRadius*Math.sin(a)*sn+curve.yRadius*Math.cos(a)*cs];
  const result:VectorPathCommand[]=[];
  for(let i=0;i<count;i++) {
    const a=curve.aStartAngle+i*step,b=a+step,k=4/3*Math.tan(step/4),p=at(a),q=at(b),dp=derivative(a),dq=derivative(b);
    result.push({type:'C',values:[p[0]+k*dp[0],p[1]+k*dp[1],q[0]-k*dq[0],q[1]-k*dq[1],...q]});
  }
  return result;
}

/** Keep Béziers and arcs smooth; never convert them to a polygon mesh on import. */
function pathCommands(path:Path):VectorPathCommand[] {
  if(!path.curves.length) return [];
  const start=path.curves[0].getPoint(0), result:VectorPathCommand[]=[{type:'M',values:[start.x,start.y]}];
  for(const generic of path.curves as Curve<Vector2>[]) {
    const curve=generic as unknown as Record<string,unknown>;
    if(curve.isLineCurve) { const c=generic as LineCurve;result.push({type:'L',values:[c.v2.x,c.v2.y]}); }
    else if(curve.isCubicBezierCurve) { const c=generic as CubicBezierCurve;result.push({type:'C',values:[c.v1.x,c.v1.y,c.v2.x,c.v2.y,c.v3.x,c.v3.y]}); }
    else if(curve.isQuadraticBezierCurve) { const c=generic as QuadraticBezierCurve;result.push({type:'Q',values:[c.v1.x,c.v1.y,c.v2.x,c.v2.y]}); }
    else if(curve.isEllipseCurve) result.push(...ellipseCommands(generic as EllipseCurve));
    else error('Вектор содержит неподдерживаемую кривую. Экспортируйте его как обычные кривые Bézier.');
  }
  result.push({type:'Z',values:[]});
  return result;
}

function reverseCommands(commands:VectorPathCommand[]):VectorPathCommand[] {
  const segments:{command:VectorPathCommand;start:number[]}[]=[];
  let current=commands[0].values;
  for(const command of commands.slice(1)) if(command.type!=='Z') { segments.push({command,start:current});current=command.values.slice(-2); }
  const result:VectorPathCommand[]=[{type:'M',values:current}];
  for(const {command,start} of segments.reverse()) result.push({type:command.type,values:command.type==='C'?[...command.values.slice(2,4),...command.values.slice(0,2),...start]:command.type==='Q'?[...command.values.slice(0,2),...start]:start});
  result.push({type:'Z',values:[]});return result;
}

function orientedPath(path:Path,positive:boolean):string {
  const sampled=path.getPoints(24);let area=0;
  for(let i=0;i<sampled.length;i++) { const a=sampled[i],b=sampled[(i+1)%sampled.length];area+=a.x*b.y-b.x*a.y; }
  const commands=pathCommands(path);
  return serializeVectorPath((area>=0)===positive?commands:reverseCommands(commands));
}

/** Convert even-odd counters to explicit opposite winding, for the shared nonzero 2D/3D/PDF pipeline. */
function filledPath(svgPath:ReturnType<SVGLoader['parse']>['paths'][number]):string {
  const shapes=svgPath.toShapes();
  return shapes.map(shape=>orientedPath(shape,true)+shape.holes.map(hole=>orientedPath(hole,false)).join('')).join('');
}

function physicalSvgScale(svg:Element):VectorMatrix {
  const view=svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if(view && (view.length!==4||view.some(v=>!Number.isFinite(v))||view[2]<=0||view[3]<=0)) error('Некорректный viewBox SVG.');
  const dimension=(s:string|null):number|undefined=>{
    if(!s) return undefined;
    const match=s.trim().match(/^([\d.+-]+)(mm|cm|in|pt|pc|px)?$/i);
    if(!match) return undefined;
    const value=Number(match[1]),factor=({mm:1,cm:10,in:25.4,pt:MM_PER_POINT,pc:MM_PER_POINT*12,px:MM_PER_PIXEL} as Record<string,number>)[match[2]?.toLowerCase()??'px'];
    return value>0&&Number.isFinite(value)?value*factor:undefined;
  };
  const width=dimension(svg.getAttribute('width')),height=dimension(svg.getAttribute('height'));
  if(!view) return [MM_PER_PIXEL,0,0,MM_PER_PIXEL,0,0];
  const sx=width?width/view[2]:height?height/view[3]:MM_PER_PIXEL,sy=height?height/view[3]:sx;
  if(svg.getAttribute('preserveAspectRatio')==='none') return [sx,0,0,sy,-view[0]*sx,-view[1]*sy];
  const scale=Math.min(sx,sy);
  return [scale,0,0,scale,-view[0]*scale,-view[1]*scale];
}

function svgCommandCount(data:string):number {
  const token=/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  if(data.replace(token,'').replace(/[\s,]/g,'')) error('Некорректные команды SVG.');
  const tokens=data.match(token)??[],counts:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
  let i=0,count=0,command='';
  while(i<tokens.length) {
    if(/^[a-z]$/i.test(tokens[i])) command=tokens[i++].toUpperCase();
    const size=counts[command];
    if(size===undefined) error('Некорректная последовательность SVG.');
    if(size===0) command='';
    else {
      if(i+size>tokens.length||tokens.slice(i,i+size).some(t=>/^[a-z]$/i.test(t))) error('SVG содержит незавершённую кривую.');
      i+=size;if(command==='M') command='L';
    }
    if(++count>VECTOR_MAX_COMMANDS) error('В SVG более 30 000 команд. Упростите кривые.');
  }
  return count;
}

/** DOMParser stays detached; only bounded geometric SVG is ever passed onward. */
export function importSvgVector(text:string,name='Вектор.svg'):VectorFileImportResult {
  if(text.length>VECTOR_MAX_FILE_BYTES) error('Файл больше 10 МБ. Упростите макет.');
  if(/<!DOCTYPE|<!ENTITY/i.test(text)) error('SVG с внешними сущностями не поддерживается.');
  const document=new DOMParser().parseFromString(text,'image/svg+xml'),svg=document.documentElement;
  if(svg.localName!=='svg'||document.querySelector('parsererror')) error('SVG повреждён. Экспортируйте макет заново.');
  const warnings:string[]=[],nodes=Array.from(svg.querySelectorAll('*'));
  if(nodes.length>6000) error('Слишком много элементов SVG. Упростите макет.');
  const allowed=new Set(['svg','g','path','rect','polygon','circle','ellipse','defs','style','title','desc','metadata']);
  let sourceCommands=0;
  for(const node of [svg,...nodes]) {
    const tag=node.localName;
    if(['metadata','title','desc'].includes(tag)) {node.remove();continue;}
    if(!svg.contains(node)&&node!==svg) continue;
    if(['script','foreignObject','iframe','animate','animateTransform','set'].includes(tag)) error('SVG содержит скрипты или активные элементы. Сохраните обычный статический SVG.');
    if(['image','text','tspan','line','polyline'].includes(tag)) {
      addWarning(warnings,tag==='image'?'Растровые изображения пропущены. Нужны векторные контуры.':tag==='text'||tag==='tspan'?'Редактируемый текст пропущен. Перед экспортом переведите текст в кривые.':'Открытые линии пропущены. Перед экспортом преобразуйте обводки в объекты.');
      node.remove();continue;
    }
    if(!allowed.has(tag)) error('SVG содержит маски, ссылки или эффекты. Разверните их в обычные кривые перед экспортом.');
    if(tag==='path'||tag==='polygon') {
      const geometry=node.getAttribute(tag==='path'?'d':'points')??'';
      sourceCommands+=tag==='path'?svgCommandCount(geometry):(geometry.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)??[]).length/2+1;
      if(sourceCommands>VECTOR_MAX_COMMANDS) error('Слишком сложный SVG. Упростите кривые до 30 000 команд.');
    }
    for(const attribute of Array.from(node.attributes)) {
      if(/^on/i.test(attribute.name)||/(^|:)href$/i.test(attribute.name)||/url\s*\(|javascript:|@import|expression\s*\(/i.test(attribute.value)) error('SVG содержит внешние ссылки или неподдерживаемые эффекты.');
      if(['clip-path','mask','filter'].includes(attribute.name)) error('Маски и обтравка SVG не поддерживаются. Примените их к контурам перед экспортом.');
    }
    if(tag==='style' && /url\s*\(|@import|expression\s*\(|clip-path|mask\s*:|filter\s*:/i.test(node.textContent??'')) error('CSS-эффекты SVG не поддерживаются. Разверните оформление в контуры.');
  }
  const loader=new SVGLoader();loader.defaultDPI=96;
  const result=loader.parse(new XMLSerializer().serializeToString(svg)),objects:VectorArtworkObject[]=[],matrix=physicalSvgScale(svg);
  for(const path of result.paths) {
    const style=path.userData?.style as Record<string,unknown>|undefined;
    if(style?.visibility==='hidden'||style?.display==='none') continue;
    if(style?.stroke && style.stroke!=='none' && Number(style.strokeOpacity??1)>0) addWarning(warnings,'Обводки пропущены. Чтобы сохранить их форму, преобразуйте обводки в объекты перед экспортом.');
    const fill=String(style?.fill??'#000000').trim().toLowerCase();
    if(fill==='none'||fill==='transparent'||Number(style?.opacity??1)===0||Number(style?.fillOpacity??1)===0) continue;
    if(!/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(fill)&&!Object.prototype.hasOwnProperty.call(Color.NAMES,fill)&&!/^rgb\(\s*[\d.%]+\s*,\s*[\d.%]+\s*,\s*[\d.%]+\s*\)$/.test(fill)&&!/^hsl\(\s*[\d.+-]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*\)$/.test(fill)) error('SVG содержит сложный или прозрачный цвет. Используйте обычные RGB-заливки без прозрачности.');
    if(Number(style?.opacity??1)!==1||Number(style?.fillOpacity??1)!==1) error('Полупрозрачные заливки не поддерживаются. Задайте непрозрачный цвет.');
    const data=filledPath(path);if(!data) continue;
    const node=path.userData?.node as Element|undefined;
    objects.push(createVectorArtworkObject({name:(node?.getAttribute('aria-label')||node?.getAttribute('id')||`Объект ${objects.length+1}`).slice(0,80),pathData:transformVectorPath(data,matrix),color:'#'+path.color.getHexString()}));
    if(objects.length>VECTOR_MAX_OBJECTS) error('В файле более 64 объектов. Объедините части одного цвета.');
  }
  if(!objects.length) error('В файле нет замкнутых залитых контуров. Переведите текст и обводки в кривые.');
  return {name,format:'svg',objects:validateVectorArtwork(objects),warnings};
}

type PdfOperatorList={fnArray:number[];argsArray:unknown[][]};
type PdfState={matrix:VectorMatrix;color:string;alpha:number;clips:{inverse:VectorMatrix;bounds:number[]}[]};
function inverseMatrix(m:VectorMatrix):VectorMatrix {
  const determinant=m[0]*m[3]-m[1]*m[2];
  if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12) error('PDF содержит вырожденное преобразование.');
  return [m[3]/determinant,-m[1]/determinant,-m[2]/determinant,m[0]/determinant,(m[2]*m[5]-m[3]*m[4])/determinant,(m[1]*m[4]-m[0]*m[5])/determinant];
}
/** Current PDF.js DrawOPS wire representation; output remains genuine vector geometry. */
export function pdfDrawPath(data:ArrayLike<number>):string {
  const commands:VectorPathCommand[]=[];
  let i=0,open=false;
  while(i<data.length) {
    const op=data[i++],type=({0:'M',1:'L',2:'C',3:'Q',4:'Z'} as Record<number,VectorPathCommand['type']>)[op];
    if(!type) error('Неподдерживаемая команда PDF.');
    if(type==='M'&&open) commands.push({type:'Z',values:[]});
    const count=({M:2,L:2,C:6,Q:4,Z:0})[type],values:Array<number>=[];
    for(let j=0;j<count;j++) values.push(data[i++]);
    commands.push({type,values});open=type!=='Z';
    if(commands.length>VECTOR_MAX_COMMANDS) error('В PDF слишком много команд. Упростите кривые.');
  }
  if(open) commands.push({type:'Z',values:[]});
  return serializeVectorPath(commands);
}

/** Exposed separately so synthetic operator tests exercise transforms, holes and unsupported content. */
export function importPdfOperators(list:PdfOperatorList,OPS:Record<string,number>,viewport:VectorMatrix,name='Вектор.pdf'):VectorFileImportResult {
  const objects:VectorArtworkObject[]=[],warnings:string[]=[],stack:PdfState[]=[];
  let state:PdfState={matrix:vectorIdentity,color:'#000000',alpha:1,clips:[]},budget=0;
  const reverseOps=new Map(Object.entries(OPS).map(([key,value])=>[value,key]));
  for(let i=0;i<list.fnArray.length;i++) {
    const op=reverseOps.get(list.fnArray[i])??'',args=list.argsArray[i];
    if(op==='save') stack.push({...state});
    else if(op==='restore') { state=stack.pop()??state; }
    else if(op==='paintFormXObjectBegin') {
      stack.push({...state});
      const matrix=args[0]?multiplyVectorMatrices(state.matrix,args[0] as VectorMatrix):state.matrix;
      const bounds=args[1] as number[]|undefined;
      state={...state,matrix,clips:bounds?[...state.clips,{inverse:inverseMatrix(matrix),bounds}]:state.clips};
    } else if(op==='paintFormXObjectEnd') state=stack.pop()??state;
    else if(op==='transform') state={...state,matrix:multiplyVectorMatrices(state.matrix,args as unknown as VectorMatrix)};
    else if(op==='setFillRGBColor') {
      const color=args[0];
      if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color)) error('Неподдерживаемый цвет заливки PDF.');
      state={...state,color:color as string};
    } else if(op==='setFillTransparent') state={...state,alpha:0};
    else if(op==='setGState') {
      for(const pair of args[0] as [string,unknown][]) {
        const [key,value]=pair;
        if(key==='ca') { if(value!==0&&value!==1) error('Полупрозрачные заливки PDF не поддерживаются.');state={...state,alpha:Number(value)}; }
        if((key==='BM'&&value!=='source-over')||(key==='SMask'&&value)||(key==='TR'&&value)) error('PDF содержит прозрачность, маски или цветовые эффекты. Разверните их в кривые.');
      }
    } else if(op==='constructPath') {
      const paint=args[0] as number, draw=(args[1] as [ArrayLike<number>])[0];
      if(paint===OPS.endPath) continue;
      if(paint===OPS.stroke||paint===OPS.closeStroke) { addWarning(warnings,'Обводки PDF пропущены. Преобразуйте обводки в объекты перед экспортом.');continue; }
      const filled=[OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(paint);
      if(!filled) error('PDF содержит неподдерживаемый способ заливки.');
      if(paint!==OPS.fill&&paint!==OPS.eoFill) addWarning(warnings,'Обводки PDF пропущены. Преобразуйте обводки в объекты перед экспортом.');
      if(state.alpha===0) continue;
      if(!draw||typeof draw.length!=='number') error('PDF содержит неподдерживаемый контур.');
      const raw=pdfDrawPath(draw);
      for(const clip of state.clips) {
        const box=vectorPathBounds(transformVectorPath(raw,multiplyVectorMatrices(clip.inverse,state.matrix))),b=clip.bounds;
        if(b.length!==4||b.some(v=>!Number.isFinite(v))||box.x<b[0]-.0001||box.y<b[1]-.0001||box.x+box.width>b[2]+.0001||box.y+box.height>b[3]+.0001) error('Группа PDF обрезана границей. Примените обтравку к контурам перед экспортом.');
      }
      const matrix=multiplyVectorMatrices(viewport,state.matrix),pathData=transformVectorPath(raw,matrix);
      let normalized=pathData;
      if(paint===OPS.eoFill||paint===OPS.eoFillStroke||paint===OPS.closeEOFillStroke) normalized=filledPath(new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${pathData}"/></svg>`).paths[0]);
      if(!normalized) continue;
      budget+=parseVectorPath(normalized).length;
      if(budget>VECTOR_MAX_COMMANDS) error('В PDF более 30 000 команд. Упростите макет.');
      // PDF silently fills zero-area paths; these cannot form a manufactured sign.
      try { vectorPathBounds(normalized); } catch { addWarning(warnings,'Пустые контуры PDF пропущены.');continue; }
      objects.push(createVectorArtworkObject({name:`Объект ${objects.length+1}`,pathData:normalized,color:state.color}));
      if(objects.length>VECTOR_MAX_OBJECTS) error('В PDF более 64 объектов. Объедините части одного цвета.');
    } else if(['clip','eoClip','shadingFill','setFillColorN','beginGroup','rawFillPath'].includes(op)) error('PDF содержит обтравку, маски, градиент или сложную группу. Экспортируйте простой PDF с залитыми кривыми.');
    else if(/showText|ShowText|showSpacedText/.test(op)) addWarning(warnings,'Текст PDF пропущен. Перед экспортом переведите весь текст в кривые.');
    else if(/paint.*Image|paintSolidColorImageMask/.test(op)) addWarning(warnings,'Растровые изображения PDF пропущены. Нужны векторные контуры.');
  }
  if(!objects.length) error('В PDF нет замкнутых векторных объектов. Переведите текст и обводки в кривые; сканы не подходят.');
  return {name,format:'pdf',objects:validateVectorArtwork(objects),warnings};
}

async function importPdf(file:File):Promise<VectorFileImportResult> {
  const pdfjs=await import('pdfjs-dist');
  const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),disableAutoFetch:true,disableStream:true,useSystemFonts:false,stopAtErrors:true,maxImageSize:1000000});
  try {
    const document=await task.promise;
    if(document.numPages!==1) error('Загрузите одностраничный PDF. Сохраните нужный макет отдельной страницей.');
    const page=await document.getPage(1),view=page.getViewport({scale:MM_PER_POINT}),list=await page.getOperatorList({annotationMode:pdfjs.AnnotationMode.DISABLE});
    if(list.fnArray.length>100000) error('Слишком сложный PDF. Упростите макет.');
    return importPdfOperators(list as unknown as PdfOperatorList,pdfjs.OPS,view.transform as unknown as VectorMatrix,file.name);
  } catch(cause) {
    if(cause instanceof Error && /password/i.test(cause.name)) error('PDF защищён паролем. Сохраните незащищённую копию.');
    throw cause;
  } finally { await task.destroy(); }
}

export async function importVectorFile(file:File):Promise<VectorFileImportResult> {
  if(!file.size||file.size>VECTOR_MAX_FILE_BYTES) error('Размер файла должен быть от 1 байта до 10 МБ.');
  const extension=file.name.split('.').pop()?.toLowerCase();
  if(extension==='svg') return importSvgVector(await file.text(),file.name);
  if(extension==='pdf') return importPdf(file);
  if(extension==='cdr') {
    const {cdrToSvg}=await import('./cdrVectorImport');
    const result=importSvgVector(await cdrToSvg(file),file.name);
    addWarning(result.warnings,'Импортирована первая страница CDR. Растровый предпросмотр не используется.');
    return {...result,format:'cdr'};
  }
  return error('Поддерживаются PDF, CDR и SVG. JPG, PNG и другие растровые файлы не являются редактируемым вектором.');
}
