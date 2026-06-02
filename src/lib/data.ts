import type { AppData, CatalogItem, Deal, StoredCalculations } from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim().replace(/\/+$/, "");

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
      section: "consumables",
      title: "БП интерьер 100 Вт",
      unit: "шт",
      unitCost: 700,
      source: "Расходники",
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

async function loadJson<T>(
  path: string,
  fallback: T,
  options: { preferApi?: boolean } = {},
): Promise<T> {
  const normalizedPath = path.replace(/^\//, "");

  if (configuredApiUrl && options.preferApi) {
    const apiData = await fetchJson<T>(`${configuredApiUrl}/${normalizedPath}`);
    if (apiData) return apiData;
  }

  const staticData = await fetchJson<T>(`${import.meta.env.BASE_URL}${normalizedPath}`);
  return staticData || fallback;
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
