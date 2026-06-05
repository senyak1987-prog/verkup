import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const files = {
  assembly: process.env.ASSEMBLY_PRICE_PATH || "O:/Производство/Таблицы/Прайс сборка.xlsx",
  milling:
    process.env.MILLING_PRICE_PATH ||
    "O:/Производство/Таблицы/ПРАЙС ФРЕЗЕРОВКА ПЕЧАТЬ ПЛОТТЕР.xlsx",
  materials: process.env.MATERIALS_PRICE_PATH || "C:/Users/Семен/Desktop/Прайс по материалам.xlsx",
};
const remexImageCacheFile = process.env.REMEX_IMAGE_CACHE || "public/data/remex-images.json";
const remexImageCache = await readJson(remexImageCacheFile, { items: {} });

const items = [];
await readAssembly(files.assembly);
await readMilling(files.milling);
await readMaterials(files.materials);

await fs.mkdir("public/data", { recursive: true });
await fs.writeFile(
  "public/data/catalogs.json",
  JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2),
  "utf8",
);
console.log(`Saved ${items.length} catalog items.`);

async function readAssembly(file) {
  if (!(await exists(file))) return;
  const workbook = XLSX.readFile(file, { cellDates: false });
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    for (const row of rows) {
      for (let offset = 0; offset <= row.length - 3; offset += 4) {
        const group = clean(row[offset]);
        const title = clean(row[offset + 1]);
        const price = toNumber(row[offset + 2]);
        if (!title || !price || /наименование|именование|цена/i.test(title)) continue;
        addItem({
          section: "assembly",
          title: group ? `${group}: ${title}` : title,
          unit: inferUnit(title),
          unitCost: price,
          source: `${path.basename(file)} / ${sheetName}`,
        });
      }
    }
  }
}

async function readMilling(file) {
  if (!(await exists(file))) return;
  const workbook = XLSX.readFile(file, { cellDates: false });
  for (const sheetName of ["ОБЩИЙ", "Прайс ОСНОВНОЙ"]) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    for (const row of rows) {
      const title = clean(row[0]);
      const price = toNumber(row[1]);
      if (title && price && !/наименование|фрезеровка|пленка|материал/i.test(title)) {
        addItem({
          section: inferMillingSection(title),
          title,
          unit: inferUnit(title) || "м2",
          unitCost: price,
          source: `${path.basename(file)} / ${sheetName}`,
        });
      }
    }
  }
}

async function readMaterials(file) {
  if (!(await exists(file))) return;
  const workbook = XLSX.readFile(file, { cellDates: false, cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => clean(cell) === "Наименование"));
  if (headerIndex < 0) return;
  const header = rows[headerIndex].map(clean);
  const codeIdx = header.indexOf("Код");
  const nameIdx = header.indexOf("Наименование");
  const unitIdx = header.indexOf("Ед. изм.");
  let materialPath = [];

  for (const [index, row] of rows.slice(headerIndex + 1).entries()) {
    const sourceRow = headerIndex + index + 2;
    const title = clean(row[nameIdx]);
    const priceInfo = materialPrice(row);
    const price = priceInfo.price;

    if (isMaterialGroupRow(row, nameIdx, unitIdx, title, price)) {
      materialPath = materialPathParts(title);
      continue;
    }

    if (!title || !price) continue;
    const normalized = normalizeMaterialCost(title, clean(row[unitIdx]), price);
    const materialSubgroup = materialPath.slice(1).join(" / ") || undefined;
    const productUrl = productUrlFromCell(sheet, sourceRow, nameIdx);
    const cachedImage = productUrl ? remexImageCache.items?.[productUrl]?.imageUrl : "";
    addItem({
      section: "materials",
      title,
      unit: normalized.unit,
      unitCost: normalized.unitCost,
      source: `${path.basename(file)}; строка ${sourceRow}; ${priceInfo.source}`,
      materialGroup: materialPath[0] || "Без группы",
      materialFamily: materialFamilyFor(title, materialPath),
      materialSubgroup,
      materialGroupPath: materialPath.join(" / ") || "Без группы",
      productCode: clean(row[codeIdx]) || productCodeFromUrl(productUrl),
      productUrl: productUrl || undefined,
      imageUrl: cachedImage || undefined,
      favorite: false,
    });
  }
}

function addItem(item) {
  const id = `${item.section}-${slug(item.title)}-${items.length}`;
  items.push({ id, ...item });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function productUrlFromCell(sheet, oneBasedRow, zeroBasedColumn) {
  const address = XLSX.utils.encode_cell({ r: oneBasedRow - 1, c: zeroBasedColumn });
  const target = sheet[address]?.l?.Target;
  if (!target || !/^https?:\/\//i.test(target)) return "";
  return target.replace(/\/$/, "");
}

function productCodeFromUrl(productUrl) {
  return productUrl?.match(/\/product\/([^/?#]+)/)?.[1] || "";
}

function toNumber(value) {
  const number = Number(clean(value).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function materialPrice(row) {
  const columns = [
    { index: 8, source: "столбец I" },
    { index: 6, source: "столбец G" },
    { index: 4, source: "столбец E" },
  ];

  for (const column of columns) {
    const price = toNumber(row[column.index]);
    if (price > 0) return { price, source: column.source };
  }

  return { price: 0, source: "цена не найдена" };
}

function isMaterialGroupRow(row, nameIdx, unitIdx, title, price) {
  if (!title || price) return false;
  if (clean(row[unitIdx])) return false;
  return row
    .filter((_, index) => index !== nameIdx)
    .every((cell) => !clean(cell));
}

function materialPathParts(title) {
  return title
    .split("/")
    .map(clean)
    .filter(Boolean);
}

function materialFamilyFor(title, materialPath) {
  const group = materialPath[0] || "";
  const pathParts = materialPath.slice(1);
  const pathText = pathParts.join(" ");
  const text = `${pathText} ${title}`.toLowerCase();

  if (group === "Листовые материалы") {
    if (/акп|композит/.test(text)) return "АКП";
    if (/пвх|pvc|сэндвич/.test(text)) return "ПВХ";
    if (/пенокартон/.test(text)) return "Пенокартон";
    if (/пластик для гравировки|гравиров/.test(text)) return "Пластик для гравировки";
    if (/полиэфир|пэт|pet/.test(text)) return "ПЭТ";
    if (/монолитн.*поликарбонат|поликарбонат.*монолитн/.test(text)) return "Поликарбонат монолитный";
    if (/сотов.*поликарбонат|поликарбонат.*сотов/.test(text)) return "Поликарбонат сотовый";
    if (/поликарбонат/.test(text)) return "Поликарбонат";
    if (/вспененн.*полистирол/.test(text)) return "Полистирол вспененный";
    if (/полистирол/.test(text)) {
      if (/зерк/.test(text)) return "Полистирол зеркальный";
      if (/молоч|опал|светор|светорас/.test(text)) return "Полистирол молочный";
      return "Полистирол";
    }
    if (/оргстекло|акрил|plex|acry/.test(text)) {
      if (/торцев/.test(text)) return "Акрил торцевой";
      if (/день\s*\/\s*ночь|день-ночь/.test(text)) return "Акрил день/ночь";
      if (/зерк/.test(text)) return "Акрил зеркальный";
      if (/цветн|черн|красн|син|оранж|зелен|желт/.test(text)) return "Акрил цветной";
      if (/молоч|опал|светор|светорас/.test(text)) return "Акрил молочный";
      if (/прозр|transparent|clear/.test(text)) return "Акрил прозрачный";
      return "Акрил";
    }
  }

  return pathParts[0] || undefined;
}

function normalizeMaterialCost(title, unit, price) {
  const rawUnit = unit || "шт";
  const normalizedUnit = rawUnit.toLowerCase();

  if (normalizedUnit.includes("лист") || looksLikeSheetMaterial(title)) {
    const area = extractSheetAreaSqm(title);
    if (area) return { unit: "м2", unitCost: roundMoney(price / area) };
  }

  if (normalizedUnit.includes("пог") || normalizedUnit === "м") {
    const width = extractRollWidthMeters(title);
    if (width) return { unit: "м2", unitCost: roundMoney(price / width) };
  }

  if (normalizedUnit.includes("м²") || normalizedUnit.includes("м2")) {
    return { unit: "м2", unitCost: roundMoney(price) };
  }

  return { unit: rawUnit, unitCost: roundMoney(price) };
}

function looksLikeSheetMaterial(title) {
  const low = title.toLowerCase();
  return /акп|пвх|акрил|полистирол|оргстекло|пластик|композит|лист/.test(low);
}

function extractSheetAreaSqm(title) {
  return extractDimensionPairs(title)
    .map(({ width, height }) => dimensionToMeters(width) * dimensionToMeters(height))
    .filter((area) => area >= 0.1 && area <= 100)
    .sort((a, b) => b - a)[0];
}

function extractRollWidthMeters(title) {
  return extractDimensionPairs(title)
    .map(({ width, height }) => ({
      width: dimensionToMeters(width),
      height: dimensionToMeters(height),
    }))
    .filter(({ width, height }) => width > 0 && width <= 10 && height >= 5)
    .map(({ width }) => width)
    .sort((a, b) => b - a)[0];
}

function extractDimensionPairs(title) {
  const pairs = [];
  const dimensionRuns = title.match(/\d+(?:[.,]\d+)?(?:\s*[хx×]\s*\d+(?:[.,]\d+)?)+/gi) || [];

  for (const run of dimensionRuns) {
    const values = run.split(/\s*[хx×]\s*/).map(toDecimal).filter(Number.isFinite);
    if (values.length < 2) continue;

    if (values.length >= 3 && values[0] <= 50 && values[1] > 100 && values[2] > 100) {
      pairs.push({ width: values[1], height: values[2] });
      continue;
    }

    pairs.push({ width: values[0], height: values[1] });
  }

  return pairs;
}

function toDecimal(value) {
  return Number(String(value).replace(",", "."));
}

function dimensionToMeters(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 100 ? value / 1000 : value;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function inferUnit(title) {
  const low = title.toLowerCase();
  if (low.includes("м2") || low.includes("м²") || low.includes("м/кв")) return "м2";
  if (low.includes("м.п") || low.includes("п/м") || low.includes("пог")) return "м.п.";
  if (low.includes("шт")) return "шт";
  if (low.includes("м ")) return "м";
  return "шт";
}

function inferMillingSection(title) {
  const low = title.toLowerCase();
  if (low.includes("плен")) return "plotter";
  if (low.includes("печ")) return "print";
  return "milling";
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
