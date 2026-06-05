import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const materialsFile = process.env.MATERIALS_PRICE_PATH || "C:/Users/Семен/Desktop/Прайс по материалам.xlsx";
const catalogFile = process.env.CATALOG_PATH || "public/data/catalogs.json";
const cacheFile = process.env.REMEX_IMAGE_CACHE || "public/data/remex-images.json";
const fetchLimit = Number(process.env.REMEX_FETCH_LIMIT || 0);
const concurrency = Math.max(1, Number(process.env.REMEX_IMAGE_CONCURRENCY || 6));

const linksByRow = await readMaterialLinks(materialsFile);
const catalogData = JSON.parse(await fs.readFile(catalogFile, "utf8"));
const cacheData = await readJson(cacheFile, { generatedAt: "", items: {} });
const imageCache = { ...(cacheData.items || {}) };
const productUrls = new Set();

let linkedItems = 0;
for (const item of catalogData.items) {
  const sourceRow = materialSourceRow(item);
  const link = sourceRow ? linksByRow.get(sourceRow) : undefined;
  if (!link) continue;

  item.productUrl = link.productUrl;
  item.productCode = link.productCode;
  linkedItems += 1;

  const cached = imageCache[link.productUrl];
  if (cached?.imageUrl) item.imageUrl = cached.imageUrl;
  else productUrls.add(link.productUrl);
}

const urlsToFetch = [...productUrls].slice(0, fetchLimit || undefined);
let fetched = 0;
let imagesFound = 0;

await runPool(urlsToFetch, concurrency, async (productUrl) => {
  const result = await fetchProductImage(productUrl);
  imageCache[productUrl] = {
    productUrl,
    ...result,
    fetchedAt: new Date().toISOString(),
  };
  fetched += 1;
  if (result.imageUrl) imagesFound += 1;
  if (fetched % 50 === 0 || fetched === urlsToFetch.length) {
    console.log(`Fetched ${fetched}/${urlsToFetch.length} Remex pages, images ${imagesFound}.`);
  }
});

let imageItems = 0;
for (const item of catalogData.items) {
  if (!item.productUrl) continue;
  const cached = imageCache[item.productUrl];
  if (cached?.imageUrl) {
    item.imageUrl = cached.imageUrl;
    imageItems += 1;
  }
}

catalogData.generatedAt = new Date().toISOString();
await fs.mkdir(path.dirname(cacheFile), { recursive: true });
await fs.writeFile(
  cacheFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), items: imageCache }, null, 2),
  "utf8",
);
await fs.writeFile(catalogFile, JSON.stringify(catalogData, null, 2), "utf8");

console.log(
  `Updated ${linkedItems} catalog items with Remex links; ${imageItems} items now have images. Fetched ${fetched} pages.`,
);

async function readMaterialLinks(file) {
  const workbook = XLSX.readFile(file, { cellDates: false, cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => clean(cell) === "Наименование"));
  if (headerIndex < 0) return new Map();

  const header = rows[headerIndex].map(clean);
  const codeIdx = header.indexOf("Код");
  const nameIdx = header.indexOf("Наименование");
  const links = new Map();

  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const rowNumber = headerIndex + offset + 2;
    const title = clean(row[nameIdx]);
    const productUrl = productUrlFromCell(sheet, rowNumber, nameIdx);
    if (!title || !productUrl) continue;

    links.set(rowNumber, {
      productCode: clean(row[codeIdx]) || productCodeFromUrl(productUrl),
      productUrl,
      title,
    });
  }

  return links;
}

function productUrlFromCell(sheet, oneBasedRow, zeroBasedColumn) {
  const address = XLSX.utils.encode_cell({ r: oneBasedRow - 1, c: zeroBasedColumn });
  const target = sheet[address]?.l?.Target;
  if (!target || !/^https?:\/\//i.test(target)) return "";
  return target.replace(/\/$/, "");
}

function materialSourceRow(item) {
  if (item.section !== "materials" || !item.source) return 0;
  const match = String(item.source).match(/строка\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function fetchProductImage(productUrl) {
  try {
    const response = await fetch(productUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!response.ok) return { status: `http-${response.status}` };

    const html = await response.text();
    const imageUrl = extractImageUrl(html, productUrl);
    return imageUrl ? { imageUrl, status: "ok" } : { status: "no-image" };
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

function extractImageUrl(html, productUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<img[^>]+class=["'][^"']*product__main-img[^"']*["'][^>]+src=["']([^"']+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return absoluteUrl(decodeHtml(match[1]), productUrl);
  }

  const imageMatch = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => decodeHtml(match[1]))
    .find((src) => /\/storage\/r-products\//i.test(src));

  return imageMatch ? absoluteUrl(imageMatch, productUrl) : "";
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function runPool(values, size, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(size, values.length) }, async () => {
    while (index < values.length) {
      const value = values[index++];
      await worker(value);
    }
  });
  await Promise.all(workers);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function productCodeFromUrl(productUrl) {
  return productUrl.match(/\/product\/([^/?#]+)/)?.[1] || "";
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
