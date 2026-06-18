import type {
  AppData,
  CatalogItem,
  DealStageCode,
  ProductionPushSubscription,
  StoredCalculations,
  StoredProduction,
  StoredTechSpecs,
  TechSpecDraft,
} from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim();

export type SaveApiSettings = {
  apiUrl: string;
};

export function defaultSaveApiUrl() {
  clearLegacyBrowserSecret();
  return configuredApiUrl || localStorage.getItem("verkupSaveApiUrl") || "";
}

export function isSaveApiUrlConfigured() {
  return configuredApiUrl.length > 0;
}

export function persistSaveApiSettings(settings: SaveApiSettings) {
  clearLegacyBrowserSecret();
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

export async function saveTechSpecs(settings: SaveApiSettings, data: StoredTechSpecs) {
  return postToSaveApi(settings, "/save-tech-specs", { data });
}

export async function saveProduction(settings: SaveApiSettings, data: StoredProduction) {
  return postToSaveApi(settings, "/save-production", { data });
}

export async function sendProductionPush(
  settings: SaveApiSettings,
  payload: {
    body: string;
    employeeId: string;
    subscriptions: ProductionPushSubscription[];
    title: string;
    url: string;
  },
) {
  return postToSaveApi(settings, "/send-production-push", payload);
}

export async function moveDealToStage(
  settings: SaveApiSettings,
  dealId: string,
  targetStage: DealStageCode,
) {
  return postToSaveApi(settings, "/move-stage", { dealId, targetStage });
}

export async function uploadTechSpecToBitrix(
  settings: SaveApiSettings,
  payload: {
    dealId: string;
    draft: TechSpecDraft;
    fileName: string;
    fileBase64: string;
    mimeType?: string;
  },
) {
  return postToSaveApi(settings, "/upload-tech-spec", payload) as Promise<{
    ok: boolean;
    field: string;
  }>;
}

async function postToSaveApi(settings: SaveApiSettings, path: string, payload: unknown) {
  const apiUrl = normalizeApiUrl(settings.apiUrl);

  if (!apiUrl) {
    throw new Error("Не указан адрес API сохранения.");
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Не удалось подключиться к API сохранения. Проверьте Worker/доступ к сети.");
  }

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error || `API сохранения ответил ${response.status}`);
  }

  return response.json();
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function clearLegacyBrowserSecret() {
  localStorage.removeItem(["verkup", "SaveApi", "Key"].join(""));
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
