import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import opentype from "opentype.js";
import ts from "typescript";

// Load the real serializer without Three.js, a browser DOM, or emitted test files.
const source = fs.readFileSync(new URL("../src/lib/glyphPath.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", compiled)(exports);
const { serializeGlyphPath } = exports;

test("Координата около целого числа сохраняет валидный контур", () => {
  const path = new opentype.Path();
  path.moveTo(115.00000000000001, 0);
  path.lineTo(118.875, -30.025);
  path.close();
  assert.equal(serializeGlyphPath(path), "M115 0L118.875 -30.025Z");
});

test("Реальные контуры ЦВЕТЫ в Manrope 800 не содержат NaN", () => {
  const bytes = fs.readFileSync(new URL("../public/fonts/Manrope-Variable.ttf", import.meta.url));
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const path = font.getPath("ЦВЕТЫ", 0, 0, 100, { kerning: true, variation: { wght: 800 } });
  assert.ok(path.commands.length > 100);
  assert.ok(path.commands.some(command => command.x === 115.00000000000001));
  const serialized = serializeGlyphPath(path);
  assert.doesNotMatch(serialized, /NaN|Infinity|undefined/);
  assert.equal((serialized.match(/[MLQCZ]/g) || []).length, path.commands.length);
  assert.match(serialized, /M115 0/);
});

test("Неконечные координаты отклоняются до SVGLoader", () => {
  for (const invalid of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => serializeGlyphPath({ commands: [{ type: "M", x: invalid, y: 0 }] }), /некорректные координаты/);
  }
});
