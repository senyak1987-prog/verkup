import type { AppData, CatalogItem, StoredCalculations } from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim();

export type SaveApiSettings = {
  apiUrl: string;
};

export function defaultSaveApiUrl() {
  localStorage.removeItem("verkupSaveApiKey");
  return configuredApiUrl || localStorage.getItem("verkupSaveApiUrl") || "";
}

export function isSaveApiUrlConfigured() {
  return configuredApiUrl.length > 0;
}

export function persistSaveApiSettings(settings: SaveApiSettings) {
  localStorage.removeItem("verkupSaveApiKey");
  if (!isSaveApiUrlConfigured()) {
    localStorage.setItem("verkupSaveApiUrl", settings.apiUrl.trim());
  }
}

export async function saveCalculations(settings: SaveApiSettings, data: StoredCalculations) {
  return postToSaveApi(settings, "/save-calculations", { data });
}

export async function saveCatalogs(
  settings: SaveApiSettings,
  data: AppData<CatalogItem>,
) {
  return postToSaveApi(settings, "/save-catalogs", { data });
}

export async function moveDealToProduction(settings: SaveApiSettings, dealId: string) {
  return postToSaveApi(settings, "/move-to-production", { dealId });
}

async function postToSaveApi(settings: SaveApiSettings, path: string, payload: unknown) {
  const apiUrl = normalizeApiUrl(settings.apiUrl);

  if (!apiUrl) {
    throw new Error("Не указан адрес API сохранения.");
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error || `API сохранения ответил ${response.status}`);
  }

  return response.json();
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function readApiError(response: Response) {
  const text = await response.text();
  if (!text) return "";

  try {
    const json = JSON.parse(text) as { error?: string; message?: string };
    return json.error || json.message || text;
  } catch {
    return text;
  }
}
