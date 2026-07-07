import type {
  AppData,
  BitrixDealFile,
  CatalogItem,
  DealStageCode,
  Installation,
  InstallationLocation,
  InstallationPhoto,
  InstallationPhotoType,
  ProductionPhoto,
  ProductionPhotoKind,
  ProductionPushSubscription,
  StoredCalculations,
  StoredInstallations,
  StoredProduction,
  StoredTechSpecs,
  StoredWarehouse,
  TechSpecDraft,
} from "../types";

const configuredApiUrl = (import.meta.env.VITE_SAVE_API_URL || "").trim();

export type SaveApiSettings = {
  apiUrl: string;
};

export function defaultSaveApiUrl() {
  clearLegacyBrowserSecret();
  return configuredApiUrl || runtimeSaveApiUrl() || localStorage.getItem("verkupSaveApiUrl") || "";
}

export function isSaveApiUrlConfigured() {
  return Boolean(configuredApiUrl || runtimeSaveApiUrl());
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

export async function saveInstallations(settings: SaveApiSettings, data: StoredInstallations) {
  return postToSaveApi(settings, "/save-installations", { data });
}

export async function saveWarehouse(settings: SaveApiSettings, data: StoredWarehouse) {
  return postToSaveApi(settings, "/save-warehouse", { data }) as Promise<{
    data: StoredWarehouse;
    ok: boolean;
  }>;
}

export async function uploadWarehouseDocument(
  settings: SaveApiSettings,
  payload: {
    actor?: string;
    file: File;
    type?: "invoice_photo" | "invoice_pdf" | "invoice_excel";
  },
) {
  const formData = new FormData();
  formData.append("files[]", payload.file);
  formData.append("actor", payload.actor || "");
  formData.append("type", payload.type || "");

  return postFormToSaveApi(settings, "/warehouse/documents", formData) as Promise<{
    data: StoredWarehouse;
    documents: Array<{
      id: string;
      originalName: string;
      url: string;
      processingStatus: string;
    }>;
    success: boolean;
  }>;
}

export async function createInstallation(
  settings: SaveApiSettings,
  payload: Partial<Installation> & {
    actor?: string;
    actorId?: string;
    dealId: string;
  },
) {
  return postToSaveApi(settings, "/installations", payload) as Promise<{
    data: StoredInstallations;
    installation: Installation;
    success: boolean;
  }>;
}

export async function updateInstallation(
  settings: SaveApiSettings,
  installationId: string,
  payload: Partial<Installation> & {
    actor?: string;
    actorId?: string;
  },
) {
  return postToSaveApi(settings, `/installations/${encodeURIComponent(installationId)}`, payload) as Promise<{
    data: StoredInstallations;
    installation: Installation;
    success: boolean;
  }>;
}

export async function deleteInstallation(
  settings: SaveApiSettings,
  installationId: string,
  payload: {
    actor?: string;
    actorId?: string;
  } = {},
) {
  return requestSaveApi(settings, `/installations/${encodeURIComponent(installationId)}`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "DELETE",
  }) as Promise<{
    data: StoredInstallations;
    success: boolean;
  }>;
}

export async function changeInstallationStatus(
  settings: SaveApiSettings,
  installationId: string,
  action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation",
  payload: {
    actor?: string;
    actorId?: string;
    installerLocation?: InstallationLocation;
    note?: string;
    resultComment?: string;
    returnComment?: string;
  } = {},
) {
  return postToSaveApi(settings, `/installations/${encodeURIComponent(installationId)}/${action}`, payload) as Promise<{
    data: StoredInstallations;
    installation: Installation;
    success: boolean;
  }>;
}

export async function uploadInstallationPhoto(
  settings: SaveApiSettings,
  payload: {
    actor?: string;
    actorId?: string;
    dealId: string;
    file: File;
    installationId: string;
    type: InstallationPhotoType;
  },
) {
  const formData = new FormData();
  formData.append("files[]", payload.file);
  formData.append("actor", payload.actor || "");
  formData.append("actorId", payload.actorId || "");
  formData.append("dealId", payload.dealId);
  formData.append("type", payload.type);

  return postFormToSaveApi(
    settings,
    `/installations/${encodeURIComponent(payload.installationId)}/photos`,
    formData,
  ) as Promise<{
    data: StoredInstallations;
    installation: Installation;
    photos: InstallationPhoto[];
    success: boolean;
  }>;
}

export async function deleteInstallationPhoto(
  settings: SaveApiSettings,
  payload: {
    installationId: string;
    photoId: string;
  },
) {
  return requestSaveApi(
    settings,
    `/installations/${encodeURIComponent(payload.installationId)}/photos/${encodeURIComponent(payload.photoId)}`,
    {
      method: "DELETE",
    },
  ) as Promise<{
    data: StoredInstallations;
    installation: Installation;
    success: boolean;
  }>;
}

export async function markInstallationNotificationRead(
  settings: SaveApiSettings,
  notificationId: string,
  employeeId: string,
) {
  return postToSaveApi(
    settings,
    `/installation-notifications/${encodeURIComponent(notificationId)}/read`,
    { employeeId },
  );
}

export async function uploadProductionPhoto(
  settings: SaveApiSettings,
  payload: {
    assignmentId: string;
    dealId: string;
    dealNumber?: string;
    dealTitle?: string;
    employeeId: string;
    file: File;
    kind: ProductionPhotoKind;
    techSpecItemId?: string;
    uploadedBy?: string;
  },
) {
  const formData = new FormData();
  formData.append("files[]", payload.file);
  formData.append("assignmentId", payload.assignmentId);
  formData.append("employeeId", payload.employeeId);
  formData.append("kind", payload.kind);
  formData.append("dealNumber", payload.dealNumber || "");
  formData.append("dealTitle", payload.dealTitle || "");
  formData.append("techSpecItemId", payload.techSpecItemId || "");
  formData.append("uploadedBy", payload.uploadedBy || "");

  return postFormToSaveApi(
    settings,
    `/deals/${encodeURIComponent(payload.dealId)}/photos`,
    formData,
  ) as Promise<{
    assignmentUpdated?: boolean;
    photos: ProductionPhoto[];
    success: boolean;
  }>;
}

export async function deleteProductionPhoto(
  settings: SaveApiSettings,
  payload: {
    dealId: string;
    photoId: string;
  },
) {
  return requestSaveApi(settings, `/deals/${encodeURIComponent(payload.dealId)}/photos/${encodeURIComponent(payload.photoId)}`, {
    method: "DELETE",
  });
}

export async function startProductionWork(
  settings: SaveApiSettings,
  payload: {
    actor?: string;
    assignmentId: string;
    dealId: string;
    dealNumber?: string;
    dealTitle?: string;
    employeeId?: string;
    techSpecItemId?: string;
  },
) {
  return postToSaveApi(settings, `/deals/${encodeURIComponent(payload.dealId)}/start-work`, payload) as Promise<{
    data?: StoredProduction;
    success: boolean;
    updated?: boolean;
  }>;
}

export async function completeProductionWork(
  settings: SaveApiSettings,
  payload: {
    actor?: string;
    assignmentId: string;
    completion?: unknown;
    dealId: string;
    dealNumber?: string;
    dealTitle?: string;
    employeeId?: string;
    techSpecItemId?: string;
  },
) {
  return postToSaveApi(settings, `/deals/${encodeURIComponent(payload.dealId)}/complete`, payload) as Promise<{
    data?: StoredProduction;
    success: boolean;
    updated?: boolean;
  }>;
}

export async function markProductionNotificationRead(
  settings: SaveApiSettings,
  notificationId: string,
  employeeId: string,
) {
  return postToSaveApi(
    settings,
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { employeeId },
  );
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
  targetStage: DealStageCode | string,
  targetStageId?: string,
) {
  return postToSaveApi(settings, "/move-stage", {
    dealId,
    targetStage,
    targetStageId: targetStageId || targetStage,
  });
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

export async function loadBitrixDealFiles(
  settings: SaveApiSettings,
  dealId: string,
  options: { importFiles?: boolean; refresh?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (options.refresh) params.set("refresh", "1");
  if (options.importFiles) params.set("import", "1");
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestSaveApi(settings, `/bitrix/deal-files/${encodeURIComponent(dealId)}${query}`, {
    method: "GET",
  }) as Promise<{
    cached?: boolean;
    checkedAt?: string;
    dealId: string;
    fileCount?: number;
    imageCount?: number;
    import?: {
      downloaded?: number;
      failed?: number;
      kept?: number;
      total?: number;
    };
    installationFiles: BitrixDealFile[];
    status?: "found" | "missing" | string;
    success: boolean;
    techSpecFiles: BitrixDealFile[];
  }>;
}

async function postToSaveApi(settings: SaveApiSettings, path: string, payload: unknown) {
  return requestSaveApi(settings, path, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

async function requestSaveApi(settings: SaveApiSettings, path: string, init: RequestInit) {
  const apiUrl = normalizeApiUrl(settings.apiUrl);

  if (!apiUrl) {
    throw new Error("Не указан адрес API сохранения.");
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, init);
  } catch {
    throw new Error("Не удалось подключиться к API сохранения. Проверьте доступ к сети.");
  }

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error || `API сохранения ответил ${response.status}`);
  }

  return response.json();
}

async function postFormToSaveApi(settings: SaveApiSettings, path: string, formData: FormData) {
  const apiUrl = normalizeApiUrl(settings.apiUrl);

  if (!apiUrl) {
    throw new Error("Не указан адрес API сохранения.");
  }

  let response: Response;

  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Не удалось загрузить фото. Проверьте интернет и попробуйте еще раз.");
  }

  if (!response.ok) {
    const error = await readApiError(response);
    if (response.status === 413) {
      throw new Error("Файл слишком большой. Выберите файл до 20 МБ.");
    }
    throw new Error(error || `API фото ответил ${response.status}`);
  }

  return response.json();
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function runtimeSaveApiUrl() {
  if (typeof window === "undefined") return "";

  const runtime = String(window.VERKUP_CONFIG?.SAVE_API_URL || "").trim();
  if (runtime) return runtime;

  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocalHost) return "";

  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return `${base || ""}/api`;
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
