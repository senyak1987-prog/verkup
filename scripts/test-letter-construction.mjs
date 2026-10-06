import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import opentype from "opentype.js";
const require = createRequire(import.meta.url);
function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env.BASE_URL', '"/"');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, key => dependencies[key] ?? require(key));
  return exports;
}
const glyph = load('glyphPath');
const contours = load('letterContours', { './glyphPath': glyph, './systemFontContours': load('systemFontContours') });
const construction = load('letterConstruction');
const commerceSource = fs.readFileSync(new URL('../src/lib/signCommerce.ts', import.meta.url), 'utf8');
const requiresFrameApproval = new Function(ts.transpileModule(
  commerceSource.slice(commerceSource.indexOf('export function requiresFrameApproval('), commerceSource.indexOf('export type CartItem'))
    .replace('export function', 'function'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText + ';return requiresFrameApproval;')();

test('Допустимая глубина на всех границах производственных диапазонов', () => {
  for (const [height, depths] of [[120,[40,50]],[180,[40,50]],[181,[50]],[199,[50]],[200,[50,60]],[350,[50,60]],[351,[60]],[550,[60]],[551,[]]])
    assert.deepEqual(construction.allowedLetterDepths(height), depths);
  assert.equal(construction.normalizeLetterDepth(410, 40), 60);
  assert.equal(construction.normalizeLetterDepth(120, 60), 50);
  assert.equal(construction.normalizeLetterDepth(250, 50), 50);
});
test('Наружные края обеих труб находятся на 10–20 мм внутри общей линии букв', () => {
  for (const inset of [10,15,20]) {
    const rails = construction.frameRailCenters(100, 120, inset, inset);
    assert.equal(rails.top - 7.5 - 100, inset);
    assert.equal(220 - rails.bottom - 7.5, inset);
  }
});
test('Общая глубина учитывает каждую активную строку и сохраняет допустимый выбор', () => {
  for (const [heights, expected] of [[[100],[40]], [[150,300],[50]], [[200,350],[50,60]], [[100,400],[]], [[600],[]]]) {
    assert.deepEqual(construction.allowedLetterDepths(heights), expected, heights.join(' / '));
    assert.deepEqual(construction.allowedLetterDepths([...heights].reverse()), expected, 'Порядок строк не меняет глубину');
    for (const depth of expected) assert.equal(construction.normalizeLetterDepth(heights, depth), depth);
  }
  assert.equal(construction.normalizeLetterDepth([100], 60), 40);
  assert.equal(construction.normalizeLetterDepth([150,300], 40), 50);
  assert.equal(construction.normalizeLetterDepth([200,350], 40), 60);
  assert.equal(construction.normalizeLetterDepth([100,400], 40), 60, 'Несовместимые строки сохраняют конечный макет для согласования');
  assert.equal(construction.normalizeLetterDepth([600], 40), 60);
  assert.equal(requiresFrameApproval(Math.max(200,350)), false);
  assert.equal(requiresFrameApproval(Math.max(200,600)), true);
});

const projectSource = fs.readFileSync(new URL('../src/components/SignProductConfigurator.tsx', import.meta.url), 'utf8');
const schemaSource = projectSource.slice(projectSource.indexOf('const ORACAL_8500_COLORS'), projectSource.indexOf('type StudioSection')) +
  projectSource.slice(projectSource.indexOf('const DEFAULT_PROJECT'), projectSource.indexOf('type ProjectState')) +
  projectSource.slice(projectSource.indexOf('const PROJECT_ENUMS'), projectSource.indexOf('function loadSavedProject'));
const schemaCompiled = ts.transpileModule(schemaSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText;
const panel = load('panelConstruction');
const validateProject = new Function('LETTER_FONTS','resolveSignFont','normalizeLetterDepth','constrainBacker','NEON_FONTS','normalizePanelSize','normalizePanelDepth',
  schemaCompiled + ';return validateProject;')(contours.SIGN_FONTS, contours.resolveSignFont,
  construction.normalizeLetterDepth, load('backerConstraints').constrainBacker, [],panel.normalizePanelSize,panel.normalizePanelDepth);
test('Восстановление проекта считает глубину по активным строкам вместо скрытой базовой высоты', () => {
  const restore = project => validateProject({ version: 1, project: {glowMode:"face",...project} });
  const short = restore({ lettersText: 'КОФЕ', letterHeight: 220, letterLineHeights: [100], letterDepth: 60 });
  assert.equal(short.letterDepth, 40);
  const sparse = restore({ lettersText: '', secondLineText: 'КАФЕ', thirdLineText: 'СВЕТ',
    letterHeight: 600, letterLineHeights: [600,150,300], letterDepth: 40 });
  assert.equal(sparse.letterDepth, 50, 'Пустая первая строка и старая высокая база не должны требовать 60 мм');
  const mixed = restore({ lettersText: 'КАФЕ', secondLineText: 'СВЕТ',
    letterHeight: 100, letterLineHeights: [200,350], letterDepth: 50 });
  assert.equal(mixed.letterDepth, 50);
  const incompatible = restore({ lettersText: 'КАФЕ', secondLineText: 'СВЕТ',
    letterHeight: 220, letterLineHeights: [100,400], letterDepth: 40 });
  assert.equal(incompatible.letterDepth, 60);
});
test('Три сохранённые строки сохраняют прежние скрытые шрифты, собственные размеры и смещения', () => {
  const values = contours.LEGACY_SIGN_FONTS.map(font => font.value);
  const saved = validateProject({ version: 1, project: { lettersText: 'КАФЕ', secondLineText: 'Город', thirdLineText: 'Свет',
    letterFont: values[0], letterLineFonts: values, letterLineHeights: [210,160,120],
    letterLineOffsets: [{ x: 10, y: -20 }, { x: -15, y: 30 }, { x: 40, y: -5 }], letterDepth: 50 } });
  assert.equal(saved.letterFont, values[0]);
  assert.deepEqual(saved.letterLineFonts, values);
  assert.deepEqual(saved.letterLineHeights, [210,160,120]);
  assert.deepEqual(saved.letterLineOffsets, [{ x: 10, y: -20 }, { x: -15, y: 30 }, { x: 40, y: -5 }]);
  assert.equal(saved.letterDepth, 50);
});
test('Независимые отступы трубы ограничены 10–20 мм даже в старых сохраненных проектах', () => {
  for (const [topInset,bottomInset,expectedTop,expectedBottom] of [[0,100,10,20],[-50,15,10,15],[20,0,20,10]]) {
    const rails = construction.frameRailCenters(-85, 220, topInset, bottomInset);
    assert.equal(rails.top - 7.5 + 85, expectedTop);
    assert.equal(135 - rails.bottom - 7.5, expectedBottom);
    assert.ok(rails.top < rails.bottom);
  }
});
for (const item of contours.SIGN_FONTS.filter(item => item.file)) test(item.label + ': живой контур и высота без выносных элементов', () => {
  const bytes = fs.readFileSync(new URL('../public/fonts/' + item.file, import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const reference = contours.contoursFromFont(font, 'Н', item.weight);
  for (const text of ['ЦВЕТЫ','ДЦЩЙ','Й','дцй','Город Свет','АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ','абвгдеёжзийклмнопрстуфхцчшщъыьэюя','ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789']) {
    const data = contours.contoursFromFont(font, text, item.weight);
    assert.doesNotMatch(data.pathData, /NaN|Infinity|undefined/);
    assert.ok(data.mainBox.width > 0 && data.mainBox.height > 0);
    if (/[\p{Lu}\d]/u.test(text)) assert.equal(data.mainBox.height, reference.mainBox.height);
  }
  const protruding = contours.contoursFromFont(font, 'ЦЙ', item.weight);
  assert.ok(protruding.inkBox.height > protruding.mainBox.height);
});
test('Разные шрифты создают разные контуры без подмены', () => {
  const paths = contours.SIGN_FONTS.filter(item => item.file).map(item => {
    const bytes = fs.readFileSync(new URL('../public/fonts/' + item.file, import.meta.url));
    return contours.contoursFromFont(opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), 'ЦВЕТЫ', item.weight).pathData;
  });
  assert.equal(new Set(paths).size, contours.SIGN_FONTS.filter(item => item.file).length);
});

test('Контражур сохраняет борт 40/50 мм, исправляет 60 мм и импорт без дробных глубин',()=>{
  for(const mode of ['halo','faceHalo']){
    assert.equal(construction.normalizeLetterDepth(150,40,mode),40);
    assert.equal(construction.normalizeLetterDepth(300,50,mode),50);
    assert.equal(construction.normalizeLetterDepth(300,60,mode),50);
    assert.equal(construction.normalizeLetterDepth(400,60,mode),50);
    const saved=validateProject({version:1,project:{lettersText:'СВЕТ',letterHeight:300,letterLineHeights:[300],letterDepth:60,glowMode:mode}});
    assert.equal(saved.letterDepth,50);
    for(const invalid of [41,45,55,NaN,Infinity])assert.ok([40,50].includes(construction.normalizeLetterDepth(150,invalid,mode)));
  }
});


test('Old ACP palettes migrate to Oracal 641 without losing independent logo and halo colours',()=>{
 const saved=validateProject({version:1,project:{acpColor:{code:'ACP-R',value:'#c9282d'},haloBackerColor:{code:'ACP-S',value:'#c8ced8'},letterFaceColor:{code:'031',value:'#d8242a'},logoFaceColor:{code:'053',value:'#5ca8d7'},logoSideColor:{code:'091',value:'#b99a51'},haloLightColor:{code:'010',value:'#f8f8f2'}}});
 assert.equal(saved.acpColor.code,'047');assert.equal(saved.haloBackerColor.code,'072');
 assert.equal(saved.letterFaceColor.value,'#c81e0d');assert.equal(saved.logoFaceColor.value,'#0987c8');assert.equal(saved.logoSideColor.code,'091');assert.equal(saved.haloLightColor.code,'010');
 const old=validateProject({version:1,project:{letterFaceColor:{code:'031',value:'#d8242a'},letterSideColor:{code:'049',value:'#004f9f'}}});
 assert.deepEqual(old.logoFaceColor,old.letterFaceColor);assert.deepEqual(old.logoSideColor,old.letterSideColor);assert.deepEqual(old.haloLightColor,old.letterFaceColor);
});

const paletteCompiled=ts.transpileModule(projectSource.slice(projectSource.indexOf('const ORACAL_8500_COLORS'),projectSource.indexOf('type StudioSection')),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const filmCatalog=new Function(paletteCompiled+';return {opaque:ORACAL_641_COLORS,translucent:ORACAL_8500_COLORS,luminous:LIGHT_FACE_FILMS,white:WHITE_LIGHT_TONES,normalize:normalizeFaceFilms};')();
test('All supplied film codes belong to their own complete series and survive save/import',()=>{
 const expected8500='010 025 021 013 020 207 034 330 323 032 329 016 031 017 030 085 413 041 008 040 403 012 527 053 052 051 528 005 006 049 542 065 007 541 066 054 062 063 009 614 068 618 087 060 070 074 076 072 805 011 081 088 090 091'.split(' ');
 const expected641='000 010 020 019 021 022 025 312 030 031 032 047 034 036 035 404 040 043 042 041 045 562 518 050 065 049 086 067 057 051 098 052 084 053 056 066 054 055 060 613 061 068 062 064 063 800 083 081 082 023 070 073 071 076 074 072 090 091 092'.split(' ');
 assert.deepEqual(filmCatalog.translucent.map(c=>c.code),expected8500);assert.deepEqual(filmCatalog.opaque.map(c=>c.code),expected641);
 for(const [key,colors] of [['panelFaceColor',filmCatalog.translucent],['letterSideColor',filmCatalog.opaque]]) for(const color of colors){
  assert.match(color.value,/^#[0-9a-f]{6}$/);assert.ok(color.name.length>2);
  const result=validateProject({version:1,project:{[key]:color}});assert.deepEqual(result[key],color);
 }
 assert.equal(filmCatalog.luminous.length,52);assert.ok(filmCatalog.luminous.every(c=>!['010','070'].includes(c.code)));
});
test('Luminous white and black film migrate to bare acrylic with independent white-light tones',()=>{
 for(const glowMode of ['face','faceSide','faceHalo'])for(const code of ['010','070','none'])for(const tone of ['cool','neutral','warm']){
  const result=validateProject({version:1,project:{glowMode,letterFaceColor:{code,value:'#ffffff'},logoFaceColor:{code,value:'#ffffff'},letterWhiteTone:tone,logoWhiteTone:'warm'}});
  assert.equal(result.letterFaceColor.code,'none');assert.equal(result.letterFaceColor.value,filmCatalog.white.find(c=>c.id===tone).value);
  assert.equal(result.logoFaceColor.value,filmCatalog.white.find(c=>c.id==='warm').value);
  const restored=validateProject({version:1,project:{glowMode,letterFaceColor:result.letterFaceColor,logoFaceColor:result.logoFaceColor,letterWhiteTone:result.letterWhiteTone,logoWhiteTone:result.logoWhiteTone}});assert.deepEqual(restored.letterFaceColor,result.letterFaceColor);assert.equal(restored.letterWhiteTone,tone);
 }
 for(const code of ['010','070']){const result=validateProject({version:1,project:{glowMode:'halo',letterFaceColor:{code,value:'#ffffff'}}});assert.equal(result.letterFaceColor.code,code);}
 const halo=validateProject({version:1,project:{glowMode:'halo',letterFaceColor:{code:'none',value:'#ffdcb1'}}});assert.equal(halo.letterFaceColor.code,'010');
 assert.throws(()=>validateProject({version:1,project:{letterWhiteTone:'invalid'}}),/неподдерживаемые/);
 const blackHalo=validateProject({version:1,project:{glowMode:'halo',letterFaceColor:{code:'070',value:'#060606'}}});blackHalo.glowMode='face';assert.equal(filmCatalog.normalize(blackHalo).letterFaceColor.code,'none');
});
