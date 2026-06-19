import type {
  AppData,
  CatalogItem,
  Deal,
  StoredCalculations,
  StoredProduction,
  StoredTechSpecs,
} from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim().replace(/\/+$/, "");
const CACHE_PREFIX = "verkup:data:";
const CATALOG_FAVORITES_KEY = `${CACHE_PREFIX}catalog:favorites`;
const REQUEST_TIMEOUT_MS = 6000;
const DEAL_CACHE_RETAIN_MS = 24 * 60 * 60 * 1000;
const DEAL_CACHE_VERSION = 2;
const EMBEDDED_PRODUCTION_KEY = "__production";

type CatalogFavoriteOverride = {
  favorite: boolean;
  favoriteOrder?: number;
};

type StoredTechSpecsWithEmbeddedProduction = StoredTechSpecs & {
  [EMBEDDED_PRODUCTION_KEY]?: StoredProduction;
};

type CacheRecord<T> = {
  version?: number;
  savedAt?: string;
  data?: T;
};

const fallbackDeals: AppData<Deal> = {
  generatedAt: new Date().toISOString(),
  items: [],
};

const fallbackCalculations: StoredCalculations = {
  generatedAt: new Date().toISOString(),
  agentCostRatio: 0.58,
  calculations: [],
};

const fallbackTechSpecs: StoredTechSpecs = {
  generatedAt: new Date().toISOString(),
  specs: [],
};

const fallbackProduction: StoredProduction = {
  generatedAt: new Date().toISOString(),
  employees: [],
  registrations: [],
  registrationLinks: [],
  assignments: [],
  payouts: [],
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

export async function loadTechSpecs() {
  return loadJson<StoredTechSpecs>("/data/tech-specs.json", fallbackTechSpecs, {
    preferApi: true,
  });
}

export async function loadProduction() {
  const production = await loadJson<StoredProduction>("/data/production.json", fallbackProduction, {
    preferApi: true,
  });
  return withLoadedEmbeddedProduction(production);
}

export async function loadFreshProduction() {
  const production = await loadJson<StoredProduction>("/data/production.json", fallbackProduction, {
    ignoreCache: true,
    preferApi: true,
  });
  return withLoadedEmbeddedProduction(production, true);
}

export async function loadCatalogs() {
  return withCatalogFavoriteOverrides(
    await loadJson<AppData<CatalogItem>>("/data/catalogs.json", fallbackCatalogs),
  );
}

export function readCachedDeals() {
  return readCache<AppData<Deal>>("data/deals.json");
}

export function readCachedCalculations() {
  return readCache<StoredCalculations>("data/calculations.json");
}

export function readCachedTechSpecs() {
  return readCache<StoredTechSpecs>("data/tech-specs.json");
}

export function readCachedProduction() {
  const production = readCache<StoredProduction>("data/production.json");
  const embeddedProduction = embeddedProductionFromTechSpecs(
    readCache<StoredTechSpecsWithEmbeddedProduction>("data/tech-specs.json"),
  );

  if (production && embeddedProduction) return mergeStoredProduction(production, embeddedProduction);
  return embeddedProduction || production;
}

export function readCachedCatalogs() {
  const data = readCache<AppData<CatalogItem>>("data/catalogs.json");
  return data ? withCatalogFavoriteOverrides(data) : undefined;
}

export function writeCachedDeals(data: AppData<Deal>) {
  writeCache("data/deals.json", data);
}

export function writeCachedCalculations(data: StoredCalculations) {
  writeCache("data/calculations.json", data);
}

export function writeCachedTechSpecs(data: StoredTechSpecs) {
  writeCache("data/tech-specs.json", data);
}

export function embeddedProductionFromTechSpecs(
  data?: StoredTechSpecs | StoredTechSpecsWithEmbeddedProduction,
) {
  const production = (data as StoredTechSpecsWithEmbeddedProduction | undefined)?.[EMBEDDED_PRODUCTION_KEY];
  return isStoredProduction(production) ? production : undefined;
}

export function withEmbeddedProduction(
  data: StoredTechSpecs,
  production?: StoredProduction,
): StoredTechSpecsWithEmbeddedProduction {
  if (!isStoredProduction(production)) return data as StoredTechSpecsWithEmbeddedProduction;
  return {
    ...data,
    [EMBEDDED_PRODUCTION_KEY]: production,
  };
}

export function writeCachedProduction(data: StoredProduction) {
  writeCache("data/production.json", data);
}

export function writeCachedCatalogs(data: AppData<CatalogItem>) {
  writeCache("data/catalogs.json", data);
}

export function rememberCatalogFavoriteChanges(previousItems: CatalogItem[], nextItems: CatalogItem[]) {
  const previousById = new Map(
    previousItems.map((item) => [item.id, catalogFavoriteOverrideForItem(item)]),
  );
  const overrides = readCatalogFavoriteOverrides();
  let changed = false;

  for (const item of nextItems) {
    const nextOverride = catalogFavoriteOverrideForItem(item);
    const previousOverride = previousById.get(item.id);

    if (previousOverride === undefined) {
      if (!nextOverride.favorite) continue;
      overrides[item.id] = nextOverride;
      changed = true;
      continue;
    }

    if (
      previousOverride.favorite !== nextOverride.favorite ||
      previousOverride.favoriteOrder !== nextOverride.favoriteOrder
    ) {
      overrides[item.id] = nextOverride;
      changed = true;
    }
  }

  if (changed) {
    writeCatalogFavoriteOverrides(overrides);
  }
}

async function loadJson<T>(
  path: string,
  fallback: T,
  options: { ignoreCache?: boolean; preferApi?: boolean } = {},
): Promise<T> {
  const normalizedPath = path.replace(/^\//, "");
  const cachedRecord = readCacheRecord<T>(normalizedPath);
  const cachedData = options.ignoreCache ? undefined : cachedRecord?.data;

  if (isBrowserOffline() && cachedData) {
    return cachedData;
  }

  if (configuredApiUrl && options.preferApi) {
    const apiData = await fetchJson<T>(`${configuredApiUrl}/${normalizedPath}`);
    if (apiData) {
      const resolvedApiData = reconcileFetchedData(
        normalizedPath,
        apiData,
        cachedData,
        cachedRecord?.savedAt,
      );
      if (shouldKeepCachedData(resolvedApiData, cachedData)) return cachedData;
      writeCacheIfUseful(normalizedPath, resolvedApiData, cachedData);
      return resolvedApiData;
    }

    if (cachedData && shouldPreferCachedDeals(normalizedPath)) {
      return cachedData;
    }
  }

  const staticData = await fetchJson<T>(`${import.meta.env.BASE_URL}${normalizedPath}`);
  if (staticData) {
    const resolvedStaticData = reconcileFetchedData(
      normalizedPath,
      staticData,
      cachedData,
      cachedRecord?.savedAt,
    );
    if (shouldKeepCachedData(resolvedStaticData, cachedData)) return cachedData;
    writeCacheIfUseful(normalizedPath, resolvedStaticData, cachedData);
    return resolvedStaticData;
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
  return readCacheRecord<T>(path)?.data;
}

function readCacheRecord<T>(path: string): CacheRecord<T> | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return undefined;
    const record = JSON.parse(raw) as CacheRecord<T>;
    if (!record || typeof record !== "object" || !("data" in record)) return undefined;
    if (isDealsPath(path) && record.version !== DEAL_CACHE_VERSION) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

function writeCache<T>(path: string, data: T) {
  try {
    localStorage.setItem(
      cacheKey(path),
      JSON.stringify({
        version: isDealsPath(path) ? DEAL_CACHE_VERSION : undefined,
        savedAt: new Date().toISOString(),
        data,
      }),
    );
  } catch {
    // Кэш не критичен: если браузер запретил запись, приложение продолжит работать онлайн.
  }
}

function withCatalogFavoriteOverrides(data: AppData<CatalogItem>): AppData<CatalogItem> {
  const overrides = readCatalogFavoriteOverrides();
  const overrideIds = Object.keys(overrides);

  if (!overrideIds.length) return data;

  return {
    ...data,
    items: data.items.map((item) =>
      Object.prototype.hasOwnProperty.call(overrides, item.id)
        ? {
            ...item,
            favorite: overrides[item.id].favorite,
            favoriteOrder: overrides[item.id].favoriteOrder,
          }
        : item,
    ),
  };
}

function readCatalogFavoriteOverrides() {
  try {
    const raw = localStorage.getItem(CATALOG_FAVORITES_KEY);
    if (!raw) return {} as Record<string, CatalogFavoriteOverride>;
    const parsed = JSON.parse(raw) as Record<string, boolean | CatalogFavoriteOverride>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, override]) => [id, normalizeCatalogFavoriteOverride(override)]),
    );
  } catch {
    return {};
  }
}

function writeCatalogFavoriteOverrides(overrides: Record<string, CatalogFavoriteOverride>) {
  try {
    localStorage.setItem(CATALOG_FAVORITES_KEY, JSON.stringify(overrides));
  } catch {
    // Избранное останется в текущем состоянии приложения, даже если браузер запретил localStorage.
  }
}

function catalogFavoriteOverrideForItem(item: CatalogItem): CatalogFavoriteOverride {
  return {
    favorite: Boolean(item.favorite),
    favoriteOrder: Number.isFinite(item.favoriteOrder) ? item.favoriteOrder : undefined,
  };
}

function normalizeCatalogFavoriteOverride(
  override: boolean | CatalogFavoriteOverride,
): CatalogFavoriteOverride {
  if (typeof override === "boolean") return { favorite: override };

  return {
    favorite: Boolean(override.favorite),
    favoriteOrder: Number.isFinite(override.favoriteOrder) ? override.favoriteOrder : undefined,
  };
}

function writeCacheIfUseful<T>(path: string, data: T, cachedData?: T) {
  if (shouldKeepCachedData(data, cachedData)) return;

  writeCache(path, data);
}

function shouldPreferCachedDeals(path: string) {
  return isDealsPath(path);
}

function reconcileFetchedData<T>(
  path: string,
  data: T,
  cachedData?: T,
  cachedSavedAt?: string,
): T {
  if (isProductionPath(path)) {
    return reconcileFetchedProduction(data, cachedData);
  }

  if (!isDealsPath(path)) return data;
  if (!isAppData<Deal>(data) || !isAppData<Deal>(cachedData)) return data;
  if (!cachedData.items.length || isCacheTooOld(cachedSavedAt)) return data;
  if (!shouldMergeCachedDeals(data, cachedData)) return data;

  const fetchedIds = new Set(data.items.map((deal) => String(deal.id)));
  const missingCachedDeals = cachedData.items.filter((deal) => !fetchedIds.has(String(deal.id)));

  if (!missingCachedDeals.length) return data;

  return {
    ...data,
    items: [...data.items, ...missingCachedDeals],
  } as T;
}

function reconcileFetchedProduction<T>(data: T, cachedData?: T): T {
  if (!isStoredProduction(data) || !isStoredProduction(cachedData)) return data;

  return mergeStoredProduction(data, cachedData) as T;
}

async function withLoadedEmbeddedProduction(
  production: StoredProduction,
  ignoreCache = false,
) {
  const techSpecs = await loadJson<StoredTechSpecsWithEmbeddedProduction>(
    "/data/tech-specs.json",
    fallbackTechSpecs,
    {
      ignoreCache,
      preferApi: true,
    },
  );
  const embeddedProduction = embeddedProductionFromTechSpecs(techSpecs);
  return embeddedProduction ? mergeStoredProduction(production, embeddedProduction) : production;
}

export function mergeStoredProduction(
  base: StoredProduction,
  incoming: StoredProduction,
): StoredProduction {
  const preferIncomingRecords = isGeneratedAtNewer(incoming.generatedAt, base.generatedAt);

  return {
    ...base,
    generatedAt: preferIncomingRecords ? incoming.generatedAt : base.generatedAt,
    employees: mergeProductionRecords(base.employees || [], incoming.employees || [], preferIncomingRecords),
    registrations: mergeProductionRecords(
      base.registrations || [],
      incoming.registrations || [],
      preferIncomingRecords,
    ),
    registrationLinks: mergeProductionRecords(
      base.registrationLinks || [],
      incoming.registrationLinks || [],
      preferIncomingRecords,
    ),
    assignments: mergeProductionRecords(
      base.assignments || [],
      incoming.assignments || [],
      preferIncomingRecords,
      { keepMissingIncomingRecords: preferIncomingRecords },
    ),
    payouts: mergeProductionRecords(
      base.payouts || [],
      incoming.payouts || [],
      preferIncomingRecords,
      { keepMissingIncomingRecords: preferIncomingRecords },
    ),
  };
}

function mergeProductionRecords<T extends { id: string }>(
  fetchedRecords: T[],
  cachedRecords: T[],
  preferCachedRecords: boolean,
  options: { keepMissingIncomingRecords?: boolean } = {},
) {
  const records = new Map<string, T>();
  for (const record of fetchedRecords) records.set(record.id, record);
  for (const record of cachedRecords) {
    if (preferCachedRecords || records.has(record.id) || options.keepMissingIncomingRecords) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values());
}

function shouldMergeCachedDeals(data: AppData<Deal>, cachedData: AppData<Deal>) {
  const fetchedAt = Date.parse(data.generatedAt || "");
  const cachedAt = Date.parse(cachedData.generatedAt || "");

  if (Number.isFinite(fetchedAt) && Number.isFinite(cachedAt)) {
    return fetchedAt < cachedAt;
  }

  return data.items.length < cachedData.items.length;
}

function isCacheTooOld(savedAt?: string) {
  if (!savedAt) return false;
  const savedAtMs = Date.parse(savedAt);
  return Number.isFinite(savedAtMs) && Date.now() - savedAtMs > DEAL_CACHE_RETAIN_MS;
}

function shouldKeepCachedData<T>(data: T, cachedData?: T): cachedData is T {
  return (
    (isEmptyAppData(data) && isNonEmptyAppData(cachedData)) ||
    (isEmptyStoredTechSpecs(data) &&
      isNonEmptyStoredTechSpecs(cachedData) &&
      shouldKeepNonEmptyCachedData(data, cachedData)) ||
    (isEmptyStoredProduction(data) && isNonEmptyStoredProduction(cachedData)) ||
    (isStoredProduction(data) &&
      isStoredProduction(cachedData) &&
      isGeneratedAtNewer(cachedData.generatedAt, data.generatedAt))
  );
}

function shouldKeepNonEmptyCachedData(
  data: { generatedAt?: string },
  cachedData: { generatedAt?: string },
) {
  return !isGeneratedAtNewer(data.generatedAt, cachedData.generatedAt);
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isEmptyAppData(value: unknown): value is AppData<unknown> {
  return isAppData(value) && !value.items.length;
}

function isNonEmptyAppData(value: unknown): value is AppData<unknown> {
  return isAppData(value) && value.items.length > 0;
}

function isEmptyStoredTechSpecs(value: unknown): value is StoredTechSpecs {
  return isStoredTechSpecs(value) && !value.specs.length;
}

function isNonEmptyStoredTechSpecs(value: unknown): value is StoredTechSpecs {
  return isStoredTechSpecs(value) && value.specs.length > 0;
}

function isEmptyStoredProduction(value: unknown): value is StoredProduction {
  return (
    isStoredProduction(value) &&
    !value.assignments.length &&
    !(value.payouts || []).length &&
    !value.employees.length &&
    !(value.registrations || []).length &&
    !(value.registrationLinks || []).length
  );
}

function isNonEmptyStoredProduction(value: unknown): value is StoredProduction {
  return (
    isStoredProduction(value) &&
    (value.assignments.length > 0 ||
      (value.payouts || []).length > 0 ||
      value.employees.length > 0 ||
      (value.registrations || []).length > 0 ||
      (value.registrationLinks || []).length > 0)
  );
}

function isAppData<T>(value: unknown): value is AppData<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as AppData<unknown>).items),
  );
}

function isStoredTechSpecs(value: unknown): value is StoredTechSpecs {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as StoredTechSpecs).specs),
  );
}

function isStoredProduction(value: unknown): value is StoredProduction {
  return Boolean(
      value &&
      typeof value === "object" &&
      Array.isArray((value as StoredProduction).employees) &&
      (!("registrations" in value) || Array.isArray((value as StoredProduction).registrations)) &&
      (!("registrationLinks" in value) ||
        Array.isArray((value as StoredProduction).registrationLinks)) &&
      (!("payouts" in value) || Array.isArray((value as StoredProduction).payouts)) &&
      Array.isArray((value as StoredProduction).assignments),
  );
}

function isGeneratedAtNewer(candidate?: string, baseline?: string) {
  const candidateMs = Date.parse(candidate || "");
  const baselineMs = Date.parse(baseline || "");
  return Number.isFinite(candidateMs) && Number.isFinite(baselineMs) && candidateMs > baselineMs;
}

function isDealsPath(path: string) {
  return path.replace(/^\//, "") === "data/deals.json";
}

function isProductionPath(path: string) {
  return path.replace(/^\//, "") === "data/production.json";
}
