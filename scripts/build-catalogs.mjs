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
  const workbook = XLSX.readFile(file, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => clean(cell) === "Наименование"));
  if (headerIndex < 0) return;
  const header = rows[headerIndex].map(clean);
  const nameIdx = header.indexOf("Наименование");
  const unitIdx = header.indexOf("Ед. изм.");
  const priceIdx = header.indexOf("Цена клиента") >= 0 ? header.indexOf("Цена клиента") : header.indexOf("Розница");

  for (const row of rows.slice(headerIndex + 1)) {
    const title = clean(row[nameIdx]);
    const price = toNumber(row[priceIdx]);
    if (!title || !price) continue;
    addItem({
      section: "materials",
      title,
      unit: clean(row[unitIdx]) || "шт",
      unitCost: price,
      source: path.basename(file),
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

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const number = Number(clean(value).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
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
