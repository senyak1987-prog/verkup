import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../src/lib/cdrDecoderCore.ts', import.meta.url), 'utf8');
const shimUrl = pathToFileURL(require.resolve('@bjorn3/browser_wasi_shim')).href;
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText.replace('"@bjorn3/browser_wasi_shim"', JSON.stringify(shimUrl));
const { decodeCdrBytes, boundedCdrModule, CDR_MAX_INPUT_BYTES } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const wasm = new Uint8Array(fs.readFileSync(new URL('../public/vector-import/cdr2svg.wasm', import.meta.url)));
const fixture = new Uint8Array(fs.readFileSync(new URL('./fixtures/vector-import/libreoffice-fdo65220-2.cdr', import.meta.url)));

test('the shipped CDR decoder and real CorelDRAW X5 fixture match their pinned provenance', () => {
  assert.equal(crypto.createHash('sha256').update(wasm).digest('hex'), 'c0534886a6ad5112d6e096ce8319073db77cafb534c506fe7b7c37e8aefea9b8');
  assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'), '88e62beb7a7ebe812f6ce06238017d07d215de9dbf76323dde93200f2d5dd348');
});

test('real CDR input decodes locally into independent editable closed SVG paths with fills', async () => {
  const svg = await decodeCdrBytes(fixture, wasm);
  assert.match(svg, /<svg\b/);
  assert.equal((svg.match(/<path\b/g) ?? []).length, 5);
  for (const fill of ['#0000ff', '#ff0000', '#6699ff', '#006633']) assert.ok(svg.includes('fill: ' + fill));
  assert.match(svg, /M58\.5649,100\.1565\s+L58\.5649,179\.6635/);
  assert.equal((svg.match(/\bZ"/g) ?? []).length, 5);
  assert.doesNotMatch(svg, /<image\b|data:image|<text\b/);
  assert.match(svg, /fill-opacity: 0\.0000/); // SVG importer must exclude this fifth, invisible shape.
});

test('CDR decoding is deterministic and every import gets a fresh filesystem/module instance', async () => {
  assert.equal(await decodeCdrBytes(fixture, wasm), await decodeCdrBytes(fixture, wasm));
});

test('unlimited upstream wasm memory is explicitly capped at 512 MiB before instantiation', async () => {
  const bounded = boundedCdrModule(wasm);
  assert.notDeepEqual(bounded, wasm);
  assert.deepEqual(boundedCdrModule(bounded), bounded);
  const module = await WebAssembly.compile(bounded);
  assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === '_start'));
  assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === 'memory'));
  assert.ok(WebAssembly.Module.imports(module).every(entry => entry.module === 'wasi_snapshot_preview1'));
  // Memory section: count 1, bounded 32-bit memory, initial 7 pages, maximum 8192 pages.
  assert.ok(Buffer.from(bounded).includes(Buffer.from([5, 5, 1, 1, 7, 0x80, 0x40])));
});

test('empty, oversized and non-CDR inputs fail explicitly before they can invoke the parser', async () => {
  await assert.rejects(decodeCdrBytes(new Uint8Array(), wasm), /пуст/);
  await assert.rejects(decodeCdrBytes(new Uint8Array(CDR_MAX_INPUT_BYTES + 1), wasm), /10 МБ/);
  await assert.rejects(decodeCdrBytes(new TextEncoder().encode('%PDF-1.7 ordinary PDF'), wasm), /не поддерживаемый файл CorelDRAW/);
});

test('an unsupported ZIP and a recognised but truncated CDR return actionable errors', async () => {
  await assert.rejects(decodeCdrBytes(new TextEncoder().encode('PK\x03\x04invalid-zip-file'), wasm), /версия CDR не поддерживается/);
  const broken = new Uint8Array(32); broken.set(new TextEncoder().encode('RIFF')); broken[4] = 24; broken.set(new TextEncoder().encode('CDR9'), 8);
  await assert.rejects(decodeCdrBytes(broken, wasm), /повреждён|неподдерживаемые|Не удалось прочитать/);
});

test('an invalid converter binary never masquerades as an unsupported drawing', async () => {
  await assert.rejects(decodeCdrBytes(fixture, new Uint8Array([1, 2, 3])), /Браузер не поддерживает модуль чтения CDR/);
});
