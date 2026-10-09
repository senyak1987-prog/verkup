import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url), cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
  const exports = {}; cache.set(name, exports);
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText)(exports, key => key.startsWith('./') ? load(key.slice(2)) : require(key));
  return exports;
}
const { createSignVectorPdf, vectorDrawingPdf, pdfPath, pdfShapePath } = load('signVectorPdf');
const project = { productId: 'letters', lettersText: 'ПРОДУКТЫ', mountMode: 'frame', glowMode: 'halo', haloBackerEnabled: true, logoEnabled: true, logoShape: 'circle' };
const row = { pathData: 'M20 30L220 30L220 130L20 130ZM70 60L70 100L100 100L100 60Z', naturalBox: { x: 20, y: 30, width: 200, height: 100 }, pathBox: { x: 400, y: 100, width: 600, height: 300 } };
const layout = { textRows: [row, { ...row, pathBox: { x: 500, y: 450, width: 400, height: 200 } }], logoBox: { x: 20, y: 100, width: 300, height: 300 }, logoCornerRadius: 48,
  frameSegments: [{ x: 400, y: 115, width: 600, height: 15 }, { x: 400, y: 370, width: 600, height: 15 }, { x: 500, y: 385, width: 15, height: 80 }],
  haloBackerPath: 'M380 80L1020 80Q1040 80 1040 100L1040 680L380 680Z', panelBox: { x: 0, y: 0, width: 2000, height: 800 }, seamXs: [1500] };

test('PDF stores every letter row, counters, logo, backing and welded frame as physical vectors in independently switchable layers', () => {
  const pdf = Buffer.from(createSignVectorPdf(project, layout)).toString('ascii');
  assert.ok(pdf.startsWith('%PDF-1.7'));
  assert.doesNotMatch(pdf, /\/Subtype \/Image|\/XObject|\/Font|\bDo\b/);
  assert.equal((pdf.match(/\/Type \/OCG/g) ?? []).length, 4);
  assert.match(pdf, /400 100 m\n1000 100 l/);
  assert.match(pdf, /500 450 m\n900 450 l/);
  assert.match(pdf, /400 115 m/);
  assert.match(pdf, /500 385 m/);
  assert.match(pdf, /1033\.333333 80 1040 86\.666667 1040 100 c/);
  assert.match(pdf, / h|\nh/);
  assert.match(pdf, /0\.25 w/);
  const [mediaW, mediaH] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)/.exec(pdf).slice(1).map(Number);
  assert.ok(Math.abs(mediaW * 25.4 / 72 - 1040) < .00001);
  assert.ok(Math.abs(mediaH * 25.4 / 72 - 620) < .00001);
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]); assert.equal(pdf.slice(xref, xref + 4), 'xref');
  for (const entry of pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)) assert.match(pdf.slice(Number(entry[1])), /^\d+ 0 obj\n/);
  const stream = /\/Length (\d+) >>\nstream\n([\s\S]*?)endstream/.exec(pdf); assert.equal(stream[2].length, Number(stream[1]));
});
test('Exact quadratic conversion, nonuniform row scaling and signed coordinates retain millimetres', () => {
  const path = pdfPath('M-10 20Q20 50 50 20Z', { sx: 2, sy: 3, x: 100, y: 200 });
  assert.equal(path.commands, '80 260 m\n120 320 160 320 200 260 c\nh');
  assert.throws(() => pdfPath('M0 0A1 1 0 0 0 10 10'), /контур/);
  assert.throws(() => pdfPath('M0 NaN'), /контур/);
  assert.throws(() => vectorDrawingPdf([], 'Empty'), /Добавьте/);
});
test('Long joined ACP backing exports at 1:1 beyond the default PDF page limit', () => {
  const pdf = Buffer.from(vectorDrawingPdf([{ name: 'Подложка', color: '#111111', drawings: [{ path: pdfShapePath({ x: 0, y: 0, width: 15000, height: 1000 }) }] }], 'Long')).toString('ascii');
  const unit = Number(/\/UserUnit (\d+)/.exec(pdf)[1]), width = Number(/\/MediaBox \[0 0 ([\d.]+)/.exec(pdf)[1]);
  assert.ok(unit > 1); assert.ok(width <= 14400);
  assert.ok(Math.abs(width * unit * 25.4 / 72 - 15020) < .00001);
  const acp = Buffer.from(createSignVectorPdf({ ...project, mountMode: 'acp' }, layout)).toString('ascii');
  assert.match(acp, /1500 0 m\n1500 800 l/);
  assert.doesNotMatch(acp, /400 115 m/);
});
test('Panel circles remain cubic vectors and neon retains real tube diameter and acrylic outline', () => {
  const panel = Buffer.from(createSignVectorPdf({ ...project, productId: 'panel', panelShape: 'circle', panelSize: 550 }, layout)).toString('ascii');
  assert.equal((panel.match(/ c\n/g) ?? []).length, 8);
  const neon = Buffer.from(createSignVectorPdf({ ...project, productId: 'neon', neonBackerShape: 'rectangle', neonDiameter: 8 }, layout, { width: 400, height: 200, design: { width: 200, height: 100, paths: [[[0, 0], [200, 100]]], radius: 4 } })).toString('ascii');
  assert.match(neon, /8 w\n100 50 m\n300 150 l/);
});
test('Imported backing and letter contours export into distinct semantic layers in physical paint order', () => {
  const importedRows = [
    {kind:'vector',vectorRole:'backing',color:'#b2a781',pathData:'M0 0L300 0L300 200L0 200Z',naturalBox:{x:0,y:0,width:300,height:200},pathBox:{x:10,y:20,width:600,height:400}},
    {...row,kind:'vector',vectorRole:'letter',color:'#ffffff',pathBox:{x:70,y:70,width:480,height:120}},
  ];
  const pdf = Buffer.from(createSignVectorPdf({...project,mountMode:'wall',haloBackerEnabled:false,logoEnabled:false},{...layout,textRows:importedRows})).toString('ascii');
  assert.equal((pdf.match(/\/Type \/OCG/g) ?? []).length,2);
  assert.ok(pdf.includes('041a043e043d044204430440044b0020043f043e0434043b043e0436043a0438'),'Backing contour layer');
  assert.ok(pdf.includes('04110443043a0432044b'),'Letter layer');
  const backingLayer=/\/OC \/L0 BDC([\s\S]*?)EMC/.exec(pdf)[1],letterLayer=/\/OC \/L1 BDC([\s\S]*?)EMC/.exec(pdf)[1];
  assert.match(backingLayer,/0\.698039 0\.654902 0\.505882 rg/);assert.match(backingLayer,/10 20 m\n610 20 l/);
  assert.doesNotMatch(backingLayer,/70 70 m/);assert.match(letterLayer,/70 70 m\n550 70 l/);
  assert.match(letterLayer,/190 106 m/,'Letter counter remains an editable contour');
  assert.doesNotMatch(pdf,/\/Subtype \/Image|\/Font|NaN|Infinity/);
});
const { smoothContour } = load('contourCurves');
test('Actual Arial Black raster outlines become smooth cubic curves while retaining holes and sharp corners', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/arial-black-raster-sign.json', import.meta.url), 'utf8'));
  const rings = fixture.pathData.match(/M[^M]*/g);
  const smoothed = rings.map(ring => smoothContour([...ring.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]), 1.2)).join('');
  assert.equal((smoothed.match(/M/g) ?? []).length, rings.length);
  assert.equal((smoothed.match(/Z/g) ?? []).length, rings.length);
  assert.ok((smoothed.match(/C/g) ?? []).length > 10);
  assert.doesNotMatch(smoothed, /NaN|Infinity/);
  assert.ok((smoothed.match(/[LC]/g) ?? []).length < (fixture.pathData.match(/L/g) ?? []).length / 2);
  assert.equal(smoothContour([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]), 'M0 0L100 0L100 100L0 100L0 0Z');
});
