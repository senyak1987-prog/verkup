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
