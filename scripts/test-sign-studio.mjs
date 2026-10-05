import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual TypeScript modules without emitting files or adding a test framework.
const require = createRequire(import.meta.url);
function loadTypeScript(relativePath, overrides = {}) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url));
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const errors = diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.equal(errors.length, 0, errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const loadedModule = { exports: {} };
  const moduleRequire = specifier => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    if (specifier.endsWith(".css")) return {};
    return require(specifier);
  };
  new Function("require", "exports", "module", outputText)(moduleRequire, loadedModule.exports, loadedModule);
  return loadedModule.exports;
}

const commerce = loadTypeScript("../src/lib/signCommerce.ts");
const { calculateLetterPrice, hasUnpricedSymbols, requiresFrameApproval, snapshotProject, validateStoredCart } = commerce;
const { SignCart } = loadTypeScript("../src/components/SignCart.tsx", { "../lib/signCommerce": commerce });

function makeItem(overrides = {}) {
  return {
    id: "flowers",
    project: { productId: "letters", lettersText: "ЦВЕТЫ", letterHeight: 410, letterFaceColor: { code: "032", value: "#e73432" } },
    label: "ЦВЕТЫ",
    widthMm: 1900,
    heightMm: 410,
    depthMm: 40,
    price: 24600,
    requiresApproval: false,
    quantity: 1,
    ...overrides,
  };
}

function envelope(items) {
  return { version: 1, items };
}

test("Тариф: ЦВЕТЫ, 41 см, пять букв = 24 600 рублей", () => {
  assert.deepEqual(calculateLetterPrice("ЦВЕТЫ", 410), {
    letterCount: 5,
    heightCm: 41,
    unitPrice: 4920,
    total: 24600,
  });
});

test("Пробелы не тарифицируются; латиница, кириллица и цифры считаются", () => {
  assert.equal(calculateLetterPrice(" A Б 1 ", 100).letterCount, 3);
  assert.equal(calculateLetterPrice(" A Б 1 ", 100).total, 3600);
  assert.equal(calculateLetterPrice("ЁЖ 24", 550).letterCount, 4);
  assert.equal(calculateLetterPrice("Й е\u0308 ２", 100).letterCount, 3);
});

test("Пунктуация и эмодзи требуют согласования, сохраняя расчет букв", () => {
  assert.equal(calculateLetterPrice("А-Б & 🍀", 410).total, 9840);
  assert.equal(hasUnpricedSymbols("А-Б & 🍀"), true);
  assert.equal(hasUnpricedSymbols("КОФЕ 24\n"), false);
  assert.equal(calculateLetterPrice("&🍀", 410).total, 0);
});

test("Рама: ровно 550 мм допускается, 551 мм требует согласования", () => {
  assert.equal(requiresFrameApproval(550), false);
  assert.equal(requiresFrameApproval(551), true);
  assert.equal(requiresFrameApproval(Number.NaN), false);
});

test("Пустой текст и неподдерживаемая высота не дают отрицательную сумму или NaN", () => {
  assert.equal(calculateLetterPrice("", 410).total, 0);
  for (const height of [Number.NaN, Infinity, -10]) {
    assert.equal(calculateLetterPrice("МИР", height).total, 0);
  }
});

test("Снимок проекта независим от последующей правки текста, высоты и вложенного цвета", () => {
  const project = makeItem().project;
  const snapshot = snapshotProject(project);
  project.lettersText = "НОВЫЙ МАКЕТ";
  project.letterHeight = 300;
  project.letterFaceColor.value = "#000000";
  assert.equal(snapshot.lettersText, "ЦВЕТЫ");
  assert.equal(snapshot.letterHeight, 410);
  assert.equal(snapshot.letterFaceColor.value, "#e73432");
  snapshot.letterFaceColor.code = "010";
  assert.equal(project.letterFaceColor.code, "032");
});

test("JSON-корзина восстанавливает количество и отделяет проект от входного объекта", () => {
  const stored = envelope([makeItem({ quantity: 2 })]);
  const restored = validateStoredCart(JSON.parse(JSON.stringify(stored)));
  assert.equal(restored[0].price * restored[0].quantity, 49200);
  const detached = validateStoredCart(stored);
  stored.items[0].project.lettersText = "ДРУГОЙ";
  assert.equal(detached[0].project.lettersText, "ЦВЕТЫ");
});

test("Старый снимок проекта без новых необязательных полей остается читаемым", () => {
  const legacy = makeItem({ project: { lettersText: "ЦВЕТЫ", letterHeight: 410 } });
  const restored = validateStoredCart(envelope([legacy]));
  assert.equal(restored[0].project.letterHeight, 410);
  assert.equal(restored[0].approvalNote, undefined);
  assert.equal(restored[0].thumbnailSvg, undefined);
});

test("Неизвестная версия, массив вместо проекта и повторяющиеся id отклоняются", () => {
  assert.throws(() => validateStoredCart({ version: 2, items: [] }));
  assert.throws(() => validateStoredCart({ version: 1, items: {} }));
  assert.throws(() => validateStoredCart(envelope([makeItem({ project: [] })])));
  assert.throws(() => validateStoredCart(envelope([makeItem(), makeItem()])));
});

test("Неограниченные числа и поврежденные количества не восстанавливаются", () => {
  for (const price of [Infinity, Number.NaN, -1]) {
    assert.throws(() => validateStoredCart(envelope([makeItem({ price })])));
  }
  for (const quantity of [0, 100, 1.5, "2", Infinity]) {
    assert.throws(() => validateStoredCart(envelope([makeItem({ quantity })])));
  }
  assert.throws(() => validateStoredCart(envelope([makeItem({ widthMm: Infinity })])));
  assert.throws(() => validateStoredCart(envelope([makeItem({ heightMm: 0 })])));
});

test("Пределы числа макетов и объема снимка ограничивают поврежденные данные", () => {
  assert.throws(() => validateStoredCart(envelope(Array.from({ length: 21 }, (_, index) => makeItem({ id: String(index) })))));
  assert.throws(() => snapshotProject({ image: "a".repeat(3_000_001) }));
  assert.throws(() => snapshotProject(new Date()));
  let root = {};
  let cursor = root;
  for (let index = 0; index < 12; index++) { cursor.child = {}; cursor = cursor.child; }
  assert.throws(() => snapshotProject(root));
});

test("Неизвестная полная цена всегда помечена как согласование", () => {
  const [item] = validateStoredCart(envelope([makeItem({ price: null, requiresApproval: false })]));
  assert.equal(item.price, null);
  assert.equal(item.requiresApproval, true);
});

test("SVG с script, foreignObject, обработчиком или внешним ресурсом не отображается", () => {
  const unsafe = [
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><div>HTML</div></foreignObject></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><image href="https://example.invalid/track.png" /></svg>',
    '<html><script>alert(1)</script></html>',
  ];
  for (const thumbnailSvg of unsafe) {
    const [item] = validateStoredCart(envelope([makeItem({ thumbnailSvg })]));
    assert.equal(item.thumbnailSvg, undefined);
  }
});

test("Обычный SVG с XML-заголовком разрешен для прежнего предпросмотра", () => {
  const thumbnailSvg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="1" y="30">ЦВЕТЫ</text></svg>';
  const [item] = validateStoredCart(envelope([makeItem({ thumbnailSvg })]));
  assert.equal(item.thumbnailSvg, thumbnailSvg);
});

test("Корзина показывает целые рубли, исключает неоцененные строки и раскрывает дополнительные расходы", () => {
  const items = validateStoredCart(envelope([
    makeItem({ quantity: 2 }),
    makeItem({ id: "panel", label: "Панель-кронштейн", price: null, requiresApproval: true, approvalNote: "Цена панели — по согласованию." }),
  ]));
  const html = renderToStaticMarkup(React.createElement(SignCart, {
    items,
    onQuantityChange() {},
    onRemove() {},
    onEdit() {},
    onClear() {},
  }));
  assert.match(html, /aria-live="polite">49\s*200\s*₽<\/strong>/u);
  assert.doesNotMatch(html, /49\s*200,00/u);
  assert.match(html, /По согласованию/u);
  assert.match(html, /Монтаж, подложка и доставка рассчитываются отдельно\./u);
  assert.match(html, /Заказ еще не отправлен\./u);
});

test("HTML в названии остается текстом и не исполняется в корзине", () => {
  const html = renderToStaticMarkup(React.createElement(SignCart, {
    items: validateStoredCart(envelope([makeItem({ label: "<script>alert(1)</script>" })])),
    onQuantityChange() {},
    onRemove() {},
    onEdit() {},
    onClear() {},
  }));
  assert.match(html, /&lt;script&gt;/u);
  assert.doesNotMatch(html, /<script>/u);
});
