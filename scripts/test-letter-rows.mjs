import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const result = {}; new Function('exports', 'require', compiled)(result, id => dependencies[id] ?? require(id)); return result;
}
const contourApi = load('letterContours', { './glyphPath': load('glyphPath'), './systemFontContours': load('systemFontContours', { './contourCurves': load('contourCurves') }) });
const backer = load('backerConstraints'), frame = load('letterFrame');
const { createLetterRowsLayout: layout } = load('letterRowsLayout', { './backerConstraints': backer, './letterFrame': frame });
const alignment = load('signLayoutAlignment');
const fonts = new Map(contourApi.SIGN_FONTS.filter(entry => entry.file).map(entry => {
  const bytes = fs.readFileSync(new URL('../public/fonts/' + entry.file, import.meta.url));
  return [entry.value, { ...entry, font: opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }];
}));
const selected = ['Manrope, sans-serif', '"Playfair Display", serif', '"Russo One", sans-serif'];
const near = (actual, expected, message, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
test('Физический размер логотипа независим от строк и ограничен 100–700 мм',()=>{
  for(const requested of [20,65,90,900,1200]){
    const result=layout(fixture({logoSizeMm:requested}));
    near(result.logoBox.height,Math.max(100,Math.min(700,requested)),'Logo height');
    near(result.logoBox.width,result.logoBox.height,'Square artwork proportions');
  }
});
const inside = (box, panel, message) => {
  assert.ok(box.x >= panel.x + 6 - .001 && box.x + box.width <= panel.x + panel.width - 6 + .001, message + ': width');
  assert.ok(box.y >= panel.y + 6 - .001 && box.y + box.height <= panel.y + panel.height - 6 + .001, message + ': height');
};
function fixture(patch = {}, settings) {
  const lineSettings = settings ?? [0, 1, 2].map(index => ({ index, text: ['ШАУРМА', 'САМАЯ ВКУСНАЯ', 'КАФЕ'][index], font: selected[index], height: [210, 160, 110][index], offset: { x: 0, y: 0 } }));
  const lines = lineSettings.map(row => {
    const entry = fonts.get(row.font); return contourApi.contoursFromFont(entry.font, row.text, entry.weight);
  });
  const combined = contourApi.combineLetterLines(lines);
  return { height: 210, lineSettings, contours: { ...combined, lines }, logoEnabled: true, logoScale: 90, logoShape: 'circle', letterOutlineEnabled: false,
    widthOverride: 0, logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0, mountMode: 'frame',
    acpLayout: { faceWidth: 2000, faceHeight: 900 }, frameTopPosition: 15, frameBottomPosition: 15, ...patch };
}

test('Each row keeps its own actual font outline, nominal height and natural proportions', () => {
  const config = fixture(), result = layout(config);
  assert.equal(result.textRows.length, 3);
  result.textRows.forEach((row, index) => {
    assert.equal(row.index, index); assert.equal(row.font, selected[index]);
    assert.equal(row.pathData, config.contours.lines[index].pathData); assert.equal(row.box.height, config.lineSettings[index].height);
    near(row.pathBox.width / row.pathBox.height, row.naturalBox.width / row.naturalBox.height, 'Natural font ratio');
    assert.doesNotMatch(row.pathData, /NaN|Infinity|undefined/);
  });
  assert.equal(new Set(result.textRows.map(row => row.pathData)).size, 3);
  assert.equal(result.frameSegments.filter(segment => segment.kind === 'rail').length, 6);
});

test('Sparse active rows preserve three indexed offsets and editing row 3 leaves row 1 intact', () => {
  const settings = [
    { index: 0, text: 'ЦВЕТЫ', font: selected[0], height: 180, offset: { x: 20, y: 30 } },
    { index: 2, text: 'КАФЕ', font: selected[2], height: 130, offset: { x: -40, y: 50 } },
  ];
  const config = fixture({ mountMode: 'acp' }, settings), before = layout(config);
  assert.deepEqual(before.letterLineOffsets, [{ x: 20, y: 30 }, { x: 0, y: 0 }, { x: -40, y: 50 }]);
  const patch = alignment.moveLayoutSelection(before, 'line-2', true, 45, -25, { constrainToPanel: true }).patch;
  const after = layout({ ...config, lineSettings: settings.map(row => ({ ...row, offset: patch.letterLineOffsets[row.index] })) });
  assert.deepEqual(after.textRows[0], before.textRows[0]);
  near(after.textRows[1].box.x - before.textRows[1].box.x, 45, 'Only selected row moves X');
  near(after.textRows[1].box.y - before.textRows[1].box.y, -25, 'Only selected row moves Y');
  assert.deepEqual(after.letterLineOffsets[1], { x: 0, y: 0 });
});

test('Blank rows produce no phantom text or frame and an all-blank logo uses only its own dimensions', () => {
  const settings = [
    { index: 0, text: ' ', font: selected[0], height: 210, offset: { x: 0, y: 0 } },
    { index: 1, text: 'КАФЕ', font: selected[1], height: 130, offset: { x: 0, y: 0 } },
    { index: 2, text: '', font: selected[2], height: 110, offset: { x: 0, y: 0 } },
  ];
  const result = layout(fixture({}, settings));
  assert.equal(result.textRows.length, 1); assert.equal(result.textRows[0].index, 1);
  assert.equal(result.frameSegments.filter(segment => segment.kind === 'rail').length, 2);
  const blank = settings.map(row => ({ ...row, text: '' })), blankResult = layout(fixture({}, blank));
  assert.equal(blankResult.textRows.length, 0); assert.equal(blankResult.frameSegments.length, 0);
  assert.deepEqual(blankResult.signBox, blankResult.logoBox);
  assert.equal(blankResult.letterLineOffsets.length, 3);
  for (const box of [blankResult.signBox, blankResult.textNaturalBox]) assert.ok(Object.values(box).every(Number.isFinite));
});

test('Missing contours have concrete finite natural boxes while the font is loading', () => {
  for (const contours of [null, undefined, { pathData: '', mainBox: { x: 0, y: NaN, width: 0, height: 0 }, inkBox: { x: 0, y: 0, width: 0, height: 0 } }]) {
    const result = layout(fixture({ contours }));
    for (const row of result.textRows) for (const box of [row.box, row.pathBox, row.naturalBox]) {
      assert.ok(Object.values(box).every(Number.isFinite)); assert.ok(box.width > 0 && box.height > 0);
    }
    assert.ok(result.textNaturalBox); assert.ok(result.textNaturalBox.width > 0 && result.textNaturalBox.height > 0);
  }
});

test('Cyrillic tails and accents affect the visible ink but never the nominal row dimensions or frame levels', () => {
  for (const entry of fonts.values()) {
    const setting = text => [{ index: 0, text, font: entry.value, height: 220, offset: { x: 0, y: 0 } }];
    const ordinary = layout(fixture({ logoEnabled: false }, setting('Н')));
    const protruding = layout(fixture({ logoEnabled: false }, setting('ДЦЩЙ')));
    assert.equal(ordinary.signBox.height, 220); assert.equal(protruding.signBox.height, 220);
    const row = protruding.textRows[0]; assert.ok(row.inkBox.height > row.box.height);
    const rails = protruding.frameSegments.filter(segment => segment.kind === 'rail');
    near(rails[0].y - row.box.y, 15, entry.label + ': top');
    near(row.box.y + row.box.height - rails[1].y - rails[1].height, 15, entry.label + ': bottom');
  }
});

test('All font rows including outlines, tails, accents and extreme dragged offsets fit inside ACP', () => {
  for (const entry of fonts.values()) for (const offset of [-5000, 0, 5000]) for (const outline of [false, true]) {
    const settings = [
      { index: 0, text: 'ДЦЩЙ', font: entry.value, height: 550, offset: { x: offset, y: -offset } },
      { index: 2, text: 'СВЕТ', font: selected[1], height: 300, offset: { x: -offset, y: offset } },
    ];
    const result = layout(fixture({ mountMode: 'acp', acpLayout: { faceWidth: 4000, faceHeight: 800 }, letterOutlineEnabled: outline,
      logoOffsetX: offset, logoOffsetY: offset, textOffsetX: offset, textOffsetY: -offset }, settings));
    for (const row of result.textRows) inside(row.inkBox, result.panelBox, entry.label + ' ' + offset);
    inside(result.logoBox, result.panelBox, entry.label + ': logo'); assert.ok(result.fit > 0 && result.fit < 1);
  }
});

const svgLoader = { SVGLoader: class {
  parse(svg) {
    const data = / d="([^"]+)"/.exec(svg)?.[1] ?? '', path = new THREE.ShapePath();
    for (const [, command, numbers] of data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
      const values = numbers.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (command === 'M') path.moveTo(...values); if (command === 'L') path.lineTo(...values);
      if (command === 'Q') path.quadraticCurveTo(...values); if (command === 'C') path.bezierCurveTo(...values);
      if (command === 'Z') path.currentPath.closePath();
    }
    return { paths: [path] };
  }
} };
const scene = load('signSceneGeometry', { three: THREE, './letterContours': contourApi, './glyphShapes': load('glyphShapes', { three: THREE }),
  './neonScene': {}, './panelConstruction': load('panelConstruction'), 'three/examples/jsm/loaders/SVGLoader.js': svgLoader });
test('The production 3D rows project to exactly the SVG millimetre ink box with their own fonts and offsets', async () => {
  const settings = [
    { index: 0, text: 'ДЦЩЙ', font: selected[0], height: 210, offset: { x: 70, y: -35 } },
    { index: 2, text: 'Город Свет', font: selected[1], height: 160, offset: { x: -40, y: 55 } },
  ];
  const result = layout(fixture({ logoEnabled: false, letterOutlineEnabled: false }, settings));
  const project = { productId: 'letters', sceneMode: 'day', letterHeight: 210, letterDepth: 50, mountMode: 'frame', glowMode: 'face',
    logoEnabled: false, letterFaceColor: { value: '#ffffff' }, letterSideColor: { value: '#222222' }, outlineColor: { value: '#000000' } };
  const model = await scene.buildSignModel(project, result, result.signBox.width, result.signBox.height, 50, false);
  const centerX = result.signBox.x + result.signBox.width / 2, centerY = result.signBox.y + result.signBox.height / 2;
  for (const row of result.textRows) {
    const mesh = model.getObjectByName('extruded-letter-row-' + row.index), box = new THREE.Box3().setFromObject(mesh);
    assert.equal(mesh.userData.font, row.font);
    near(box.min.x + centerX, row.inkBox.x, 'SVG/3D left', .03);
    near(box.max.x + centerX, row.inkBox.x + row.inkBox.width, 'SVG/3D right', .03);
    near(centerY - box.max.y, row.inkBox.y, 'SVG/3D top', .03);
    near(centerY - box.min.y, row.inkBox.y + row.inkBox.height, 'SVG/3D bottom', .03);
    assert.equal(box.min.z, 15); assert.equal(box.max.z, 65);
  }
  scene.disposeSignObject(model);
});

test('ACP joins share physical seam locations and fitting never makes rows or a logo smaller than 100 mm',()=>{
 const joined=layout(fixture({mountMode:'acp',acpLayout:{faceWidth:9000,faceHeight:1200,depth:100}}));
 assert.deepEqual(joined.seamXs.map(x=>x-joined.panelBox.x),[3000,6000]);
 const small=layout(fixture({mountMode:'acp',logoSizeMm:100,acpLayout:{faceWidth:400,faceHeight:250}}));
 for(const row of small.textRows)assert.ok(row.box.height>=100);
 assert.ok(small.logoBox.height>=100);
 assert.ok(small.textRows.some(row=>row.inkBox.width>small.panelBox.width-12),'An impossible fit remains visible for correction rather than producing undersized lettering');
});

test('3D ACP joints match the balanced physical sections used in 2D',async()=>{
 const result=layout(fixture({mountMode:'acp',acpLayout:{faceWidth:9000,faceHeight:1200,depth:100},logoEnabled:false}));
 const project={productId:'letters',sceneMode:'day',letterHeight:210,letterDepth:50,mountMode:'acp',glowMode:'face',logoEnabled:false,acpDepth:100,acpColor:{value:'#ffffff'},letterFaceColor:{value:'#ff0000'},letterSideColor:{value:'#222222'}};
 const model=await scene.buildSignModel(project,result,9000,1200,50,false);
 const joints=model.children.filter(x=>x.name==='acp-panel-joint');
 assert.deepEqual(joints.map(x=>x.position.x),[-1500,1500]);
 scene.disposeSignObject(model);
});


test('Halo on ACP has physical 20 mm standoffs behind each row and logo, with independent face and return colours',async()=>{
 const result=layout(fixture({mountMode:'acp',acpLayout:{faceWidth:4000,faceHeight:1000,depth:50}}));
 const project={productId:'letters',sceneMode:'day',letterHeight:210,letterDepth:50,mountMode:'acp',glowMode:'halo',logoEnabled:true,logoShape:'circle',logoImage:'',acpDepth:50,acpColor:{value:'#ffffff'},letterFaceColor:{value:'#ff0000'},letterSideColor:{value:'#222222'},logoFaceColor:{value:'#00ff00'},logoSideColor:{value:'#0000ff'},haloLightColor:{value:'#ffff00'}};
 const model=await scene.buildSignModel(project,result,4000,1000,50,false);
 const panel=new THREE.Box3().setFromObject(model.getObjectByName('acp-box'));
 const logo=model.getObjectByName('extruded-logo');
 const meshes=[logo,...result.textRows.map(row=>model.getObjectByName('extruded-letter-row-'+row.index))];
 for(const mesh of meshes){const bounds=new THREE.Box3().setFromObject(mesh);near(bounds.min.z-panel.max.z,20,'Full body begins 20 mm in front of the panel');near(bounds.max.z-bounds.min.z,50,'Letter depth remains 50 mm');}
 assert.equal(logo.material[0].userData.dayColor.getHexString(),'00ff00');assert.equal(logo.material[1].userData.dayColor.getHexString(),'0000ff');
 assert.equal(meshes[1].material[0].userData.dayColor.getHexString(),'ff0000');assert.equal(meshes[1].material[1].userData.dayColor.getHexString(),'222222');
 const spacers=model.children.filter(mesh=>mesh.name==='halo-distance-spacer');assert.ok(spacers.length>6);
 for(const spacer of spacers){const bounds=new THREE.Box3().setFromObject(spacer);near(bounds.min.z,panel.max.z,'Spacer touches ACP');near(bounds.max.z,20,'Spacer touches rear of body');}
 scene.disposeSignObject(model);
});

test('Unfilmed acrylic stays white when switched off while its emitted light uses each selected temperature',async()=>{
 const result=layout(fixture({logoEnabled:false}));
 const previousDocument=globalThis.document,previousPath=globalThis.Path2D;
 const context={save(){},translate(){},scale(){},fill(){},restore(){}};
 globalThis.document={createElement:()=>({getContext:()=>context})};globalThis.Path2D=class {};
 try { for(const value of ['#e6f3ff','#fff4e6','#ffdcb1']){
  const project={productId:'letters',sceneMode:'night',letterHeight:210,letterDepth:50,mountMode:'frame',glowMode:'face',logoEnabled:false,letterFaceColor:{code:'none',value},letterSideColor:{value:'#222222'}};
  const model=await scene.buildSignModel(project,result,4000,1000,50,false);
  const face=model.getObjectByName('extruded-letter-row-0').material[0];
  assert.equal(face.userData.dayColor.getHexString(),'f5f5f3');assert.equal(face.emissive.getHexString(),value.slice(1));
  scene.applySignLighting(model,1,false,1);assert.equal(face.emissiveIntensity,0);
  scene.applySignLighting(model,1,true,1);assert.ok(face.emissiveIntensity>0);
  scene.disposeSignObject(model);
 } } finally {if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;}
});
