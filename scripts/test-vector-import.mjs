import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { DOMMatrix, Path2D, ImageData } from '@napi-rs/canvas';

function load(name, dependencies={}) {
  const source=fs.readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('exports','require',compiled)(exports,key=>{
    if(!(key in dependencies)) throw new Error('Unexpected import '+key);
    return dependencies[key];
  });return exports;
}
const shared=load('vectorArtwork');
// The real SVGLoader fill topology is exercised with an absolute path adapter;
// browser DOM sanitization is separately checked in the application UI.
class TestSVGLoader extends SVGLoader {
  parse(source) {
    const path=new THREE.ShapePath(),data=source.match(/d="([^"]+)"/)[1];
    for(const {type,values} of shared.parseVectorPath(data)) {
      if(type==='M') path.moveTo(...values);
      if(type==='L') path.lineTo(...values);
      if(type==='Q') path.quadraticCurveTo(...values);
      if(type==='C') path.bezierCurveTo(...values);
      if(type==='Z') path.currentPath.closePath();
    }
    path.userData={style:{fillRule:'evenodd'}};return {paths:[path]};
  }
}
const importer=load('vectorFileImport',{'./vectorArtwork':shared,'three':THREE,'three/examples/jsm/loaders/SVGLoader.js':{SVGLoader:TestSVGLoader}});
const {OPS,getDocument}=await (async()=>{
  Object.assign(globalThis,{DOMMatrix,Path2D,ImageData});return import('pdfjs-dist/legacy/build/pdf.mjs');
})();
const rectangle=[0,0,0,1,100,0,1,100,50,1,0,50,4];
const list=(operations)=>({fnArray:operations.map(o=>OPS[o[0]]),argsArray:operations.map(o=>o.slice(1))});
const draw=(paint='fill',path=rectangle)=>['constructPath',OPS[paint],[new Float32Array(path)],new Float32Array([0,0,100,50])];
const path='M0 0L100 0L100 50L0 50Z';
const object=()=>shared.createVectorArtworkObject({name:'Контур',pathData:path,color:'#ffcc00'});

test('closed path validates and saved bounding boxes are recomputed',()=>{
  const o=object();assert.deepEqual(shared.validateVectorArtwork([o]),[o]);
  assert.throws(()=>shared.validateVectorArtwork([{...o,box:{...o.box,width:101}}]),/размеры/i);
});
test('untrusted paths reject script, relative commands, NaN, huge coordinates and open contours',()=>{
  for(const p of ['M0 0L1 1<script>Z','m0 0l1 1z','M0 0LNaN 1Z','M0 0L100001 1Z','M0 0L1 1']) assert.throws(()=>shared.parseVectorPath(p));
});
test('cubic dimensions use exact extrema rather than oversized control handles',()=>{
  const box=shared.vectorPathBounds('M0 0C0 100 100 100 100 0L0 0Z');
  assert.equal(box.width,100);assert.equal(box.height,75);
});
test('quadratic dimensions and transformed curves preserve native commands',()=>{
  const p='M0 0Q50 100 100 0L0 0Z';assert.equal(shared.vectorPathBounds(p).height,50);
  const transformed=shared.transformVectorPath(p,[2,0,0,2,30,40]);
  assert.match(transformed,/Q/);assert.deepEqual(shared.vectorPathBounds(transformed),{x:30,y:40,width:200,height:100});
});
test('saved artwork enforces object, command, color and duplicate identity budgets',()=>{
  const o=object();assert.throws(()=>shared.validateVectorArtwork(Array(65).fill(o)),/64/);
  assert.throws(()=>shared.validateVectorArtwork([o,o]),/идентификатор/);
  assert.throws(()=>shared.validateVectorArtwork([{...o,color:'url(https://x)'}]),/параметры/);
  assert.throws(()=>shared.parseVectorPath('M0 0'+'L1 1'.repeat(30000)+'Z'),/30 000/);
});
test('multiple source contours retain their relative page positions',()=>{
  const a=object(),b=shared.createVectorArtworkObject({name:'Другой',pathData:'M200 25L220 25L220 75L200 75Z',color:'#ff0000'});
  assert.deepEqual(shared.vectorArtworkBounds([a,b]),{x:0,y:0,width:220,height:75});
});
test('PDF fill preserves dimensions, color and physical viewport transform',()=>{
  const result=importer.importPdfOperators(list([['setFillRGBColor','#ff4400'],draw()]),OPS,[25.4/72,0,0,-25.4/72,0,200]);
  assert.equal(result.objects[0].color,'#ff4400');assert.ok(Math.abs(result.objects[0].box.width-100*25.4/72)<.00001);
});
test('PDF graphics stack applies nested transformations without moving later objects',()=>{
  const result=importer.importPdfOperators(list([['save'],['transform',2,0,0,2,10,20],draw(),['restore'],draw()]),OPS,[1,0,0,1,0,0]);
  assert.deepEqual(result.objects.map(o=>o.box),[{x:10,y:20,width:200,height:100},{x:0,y:0,width:100,height:50}]);
});
test('PDF curves remain cubic and quadratic after import',()=>{
  const data=[0,0,0,2,0,100,100,100,100,0,3,50,-50,0,0,4];
  const result=importer.importPdfOperators(list([draw('fill',data)]),OPS,[1,0,0,1,0,0]);
  assert.match(result.objects[0].pathData,/C/);assert.match(result.objects[0].pathData,/Q/);
});
test('PDF ordinary forms keep their transform and reject actual cropping',()=>{
  const result=importer.importPdfOperators(list([['paintFormXObjectBegin',[2,0,0,2,10,20],[0,0,100,50]],draw(),['paintFormXObjectEnd'],draw()]),OPS,[1,0,0,1,0,0]);
  assert.deepEqual(result.objects[0].box,{x:10,y:20,width:200,height:100});assert.deepEqual(result.objects[1].box,{x:0,y:0,width:100,height:50});
  assert.throws(()=>importer.importPdfOperators(list([['paintFormXObjectBegin',null,[0,0,40,40]],draw(),['paintFormXObjectEnd']]),OPS,[1,0,0,1,0,0]),/обрезана/);
});
test('PDF even-odd counters remain holes in nonzero rendering',()=>{
  const outer=[0,0,0,1,100,0,1,100,100,1,0,100,4],inner=[0,25,25,1,75,25,1,75,75,1,25,75,4];
  const result=importer.importPdfOperators(list([draw('eoFill',[...outer,...inner])]),OPS,[1,0,0,1,0,0]);
  const paths=result.objects[0].pathData.match(/M[^M]*/g);assert.equal(paths.length,2);
  const area=p=>{let area=0,previous;for(const c of shared.parseVectorPath(p)){if(c.type==='M') previous=c.values;else if(c.type==='L'){area+=previous[0]*c.values[1]-c.values[0]*previous[1];previous=c.values;}}return area;};
  assert.ok(area(paths[0])*area(paths[1])<0,'outer and counter must have opposite winding');
});
test('PDF image, live text and stroke exclusions are explicitly reported',()=>{
  const result=importer.importPdfOperators(list([['showText',[]],['paintImageXObject','image'],draw('stroke'),draw()]),OPS,[1,0,0,1,0,0]);
  assert.equal(result.objects.length,1);assert.equal(result.warnings.length,3);
});
test('PDF clipping, gradients and unsupported opacity never silently alter the drawing',()=>{
  for(const op of [['clip'],['shadingFill','gradient'],['setGState',[['ca',.5]]],['setGState',[['BM','multiply']]]]) assert.throws(()=>importer.importPdfOperators(list([op,draw()]),OPS,[1,0,0,1,0,0]));
});
test('raster-only PDF is not advertised as editable vector artwork',()=>{
  assert.throws(()=>importer.importPdfOperators(list([['paintImageXObject','photo']]),OPS,[1,0,0,1,0,0]),/нет замкнутых/);
});
function fixturePdf(contents,resources='',extraBodies=[]) {
  const bodies=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << ${resources} >> /Contents 4 0 R >>`,`<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,...extraBodies];
  let text='%PDF-1.7\n';const positions=[];
  bodies.forEach((body,i)=>{positions.push(text.length);text+=`${i+1} 0 obj\n${body}\nendobj\n`;});
  const xref=text.length;text+=`xref\n0 ${bodies.length+1}\n0000000000 65535 f \n${positions.map(p=>String(p).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${bodies.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
test('actual PDF.js6.4 operator output imports a physical cubic and colored filled object',async()=>{
  const task=getDocument({data:fixturePdf('q\n1 0 0 1 20 30 cm\n1 0.5 0 rg\n0 0 m\n0 100 100 100 100 0 c\nh\nf\nQ'),useSystemFonts:false});
  try { const doc=await task.promise,page=await doc.getPage(1),view=page.getViewport({scale:25.4/72});
    const result=importer.importPdfOperators(await page.getOperatorList(),OPS,view.transform);
    assert.equal(result.objects.length,1);assert.match(result.objects[0].pathData,/C/);assert.equal(result.objects[0].color,'#ff8000');
    assert.ok(Math.abs(result.objects[0].box.height-75*25.4/72)<.001);
  } finally {await task.destroy();}
});
const fixtures={
  'editable-curves.pdf':fixturePdf('q\n1 0 0 1 20 30 cm\n1 0.5 0 rg\n0 0 m 0 100 100 100 100 0 c h f\n0.1 0.4 0.8 rg\n150 0 100 100 re 175 25 50 50 re f*\nQ'),
  'live-text-and-vector.pdf':fixturePdf('1 0 0 rg 0 0 50 50 re f\nBT /F1 20 Tf 20 80 Td (LIVE TEXT) Tj ET','/Font << /F1 5 0 R >>',['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']),
  'scan-only.pdf':fixturePdf('q 100 0 0 100 0 0 cm /Im1 Do Q','/XObject << /Im1 5 0 R >>',['<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream']),
  'clipped.pdf':fixturePdf('0 0 40 40 re W n 0 0 100 100 re f'),
  'transparent.pdf':fixturePdf('/GS1 gs 0 0 100 100 re f','/ExtGState << /GS1 5 0 R >>',['<< /Type /ExtGState /ca 0.5 >>']),
  'gradient.pdf':fixturePdf('/Sh1 sh','/Shading << /Sh1 5 0 R >>',['<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>']),
};
const fixtureDirectory=new URL('./fixtures/vector-import/',import.meta.url);
fs.mkdirSync(fixtureDirectory,{recursive:true});
for(const [name,bytes] of Object.entries(fixtures)) fs.writeFileSync(new URL(name,fixtureDirectory),bytes);
async function actualPdf(bytes) {
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false});
  try {const document=await task.promise,page=await document.getPage(1);return importer.importPdfOperators(await page.getOperatorList(),OPS,page.getViewport({scale:25.4/72}).transform);}
  finally {await task.destroy();}
}
test('actual PDF counters and multi-color parts retain separate editable objects',async()=>{
  const result=await actualPdf(fixtures['editable-curves.pdf']);assert.equal(result.objects.length,2);assert.equal(result.objects[1].pathData.match(/M/g).length,2);
  assert.deepEqual(result.objects.map(o=>o.color),['#ff8000','#1a66cc']);
});
test('actual PDF live text is omitted with an explicit warning',async()=>{
  const result=await actualPdf(fixtures['live-text-and-vector.pdf']);assert.equal(result.objects.length,1);assert.match(result.warnings.join(' '),/Текст PDF пропущен/);
});
test('actual scan-only PDF is rejected without inventing editable contours',async()=>{
  await assert.rejects(actualPdf(fixtures['scan-only.pdf']),/сканы не подходят/);
});
test('actual clipped, transparent and gradient PDFs fail with useful guidance',async()=>{
  await assert.rejects(actualPdf(fixtures['clipped.pdf']),/обтравку/);
  await assert.rejects(actualPdf(fixtures['transparent.pdf']),/Полупрозрачные/);
  await assert.rejects(actualPdf(fixtures['gradient.pdf']),/градиент/);
});
