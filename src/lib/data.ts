import type { AppData, CatalogItem, Deal, StoredCalculations } from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim().replace(/\/+$/, "");
const CACHE_PREFIX = "verkup:data:";
const REQUEST_TIMEOUT_MS = 6000;

const fallbackDeals: AppData<Deal> = {
  generatedAt: new Date().toISOString(),
  items: [],
};

const fallbackCalculations: StoredCalculations = {
  generatedAt: new Date().toISOString(),
  agentCostRatio: 0.58,
  calculations: [],
};

const fallbackCatalogs: AppData<CatalogItem> = {
  generatedAt: new Date().toISOString(),
  items: [
    {
      id: "assembly-letter-leds",
      section: "assembly",
      title: "Установка диодов",
      unit: "шт",
      unitCost: 50,
      source: "Прайс сборка",
    },
    {
      id: "consumables-power-100",
      section: "lighting",
      title: "БП интерьер 100 Вт",
      unit: "шт",
      unitCost: 700,
      source: "Светотехника",
    },
    {
      id: "milling-material-4-5",
      section: "milling",
      title: "Фрезеровка материала 4-5 мм",
      unit: "п/м",
      unitCost: 55,
      source: "ПРАЙС ФРЕЗЕРОВКА",
    },
  ],
};

export async function loadDeals() {
  return loadJson<AppData<Deal>>("/data/deals.json", fallbackDeals, { preferApi: true });
}

export async function loadCalculations() {
  return loadJson<StoredCalculations>("/data/calculations.json", fallbackCalculations, {
    preferApi: true,
  });
}

export async function loadCatalogs() {
  return loadJson<AppData<CatalogItem>>("/data/catalogs.json", fallbackCatalogs);
}

export function readCachedDeals() {
  return readCache<AppData<Deal>>("data/deals.json");
}

export function readCachedCalculations() {
  return readCache<StoredCalculations>("data/calculations.json");
}

export function readCachedCatalogs() {
  return readCache<AppData<CatalogItem>>("data/catalogs.json");
}

export function writeCachedDeals(data: AppData<Deal>) {
  writeCache("data/deals.json", data);
}

export function writeCachedCalculations(data: StoredCalculations) {
  writeCache("data/calculations.json", data);
}

export function writeCachedCatalogs(data: AppData<CatalogItem>) {
  writeCache("data/catalogs.json", data);
}

async function loadJson<T>(
  path: string,
  fallback: T,
  options: { preferApi?: boolean } = {},
): Promise<T> {
  const normalizedPath = path.replace(/^\//, "");
  const cachedData = readCache<T>(normalizedPath);

  if (isBrowserOffline() && cachedData) {
    return cachedData;
  }

  if (configuredApiUrl && options.preferApi) {
    const apiData = await fetchJson<T>(`${configuredApiUrl}/${normalizedPath}`);
    if (apiData) {
      if (shouldKeepCachedData(apiData, cachedData)) return cachedData;
      writeCacheIfUseful(normalizedPath, apiData, cachedData);
      return apiData;
    }
  }

  const staticData = await fetchJson<T>(`${import.meta.env.BASE_URL}${normalizedPath}`);
  if (staticData) {
    if (shouldKeepCachedData(staticData, cachedData)) return cachedData;
    writeCacheIfUseful(normalizedPath, staticData, cachedData);
    return staticData;
  }

  return cachedData || fallback;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function cacheKey(path: string) {
  return `${CACHE_PREFIX}${path.replace(/^\//, "")}`;
}

function readCache<T>(path: string): T | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return undefined;
    const record = JSON.parse(raw) as { data?: T };
    return record.data;
  } catch {
    return undefined;
  }
}

function writeCache<T>(path: string, data: T) {
  try {
    localStorage.setItem(
      cacheKey(path),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        data,
      }),
    );
  } catch {
    // Кэш не критичен: если браузер запретил запись, приложение продолжит работать онлайн.
  }
}

function writeCacheIfUseful<T>(path: string, data: T, cachedData?: T) {
  if (shouldKeepCachedData(data, cachedData)) return;

  writeCache(path, data);
}

function shouldKeepCachedData<T>(data: T, cachedData?: T): cachedData is T {
  return isEmptyAppData(data) && isNonEmptyAppData(cachedData);
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isEmptyAppData(value: unknown): value is AppData<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as AppData<unknown>).items) &&
      !(value as AppData<unknown>).items.length,
  );
}

function isNonEmptyAppData(value: unknown): value is AppData<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as AppData<unknown>).items) &&
      (value as AppData<unknown>).items.length > 0,
  );
}
