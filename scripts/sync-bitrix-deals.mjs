import fs from "node:fs/promises";
import path from "node:path";

const env = process.env;
const webhookUrl = required("BITRIX_WEBHOOK_URL").replace(/\/?$/, "/");
const bitrixDomain = env.BITRIX_DOMAIN || new URL(webhookUrl).host;
const stageId = env.BITRIX_STAGE_ID || "";
const stageName = env.BITRIX_STAGE_NAME || "Запустить в производство";
const tzStageId = env.BITRIX_TZ_STAGE_ID || "DETAILS";
const tzStageName = env.BITRIX_TZ_STAGE_NAME || "Подготовка ТЗ";
const tzApprovalStageId = env.BITRIX_TZ_APPROVAL_STAGE_ID || "13";
const tzApprovalStageName = env.BITRIX_TZ_APPROVAL_STAGE_NAME || "Согласование ТЗ";
const productionStageId = env.BITRIX_PRODUCTION_STAGE_ID || "10";
const productionStageName = env.BITRIX_PRODUCTION_STAGE_NAME || "В производстве";
const defectStageId = env.BITRIX_DEFECT_STAGE_ID || "9";
const defectStageName = env.BITRIX_DEFECT_STAGE_NAME || "КОСЯК в заказе";
const categoryId = env.BITRIX_CATEGORY_ID || "";

const customFields = {
  classification: env.BITRIX_FIELD_CLASSIFICATION || "",
  installAmount: env.BITRIX_FIELD_INSTALL_AMOUNT || "",
  startDate: env.BITRIX_FIELD_START_DATE || "",
  expectedFinishDate: env.BITRIX_FIELD_EXPECTED_FINISH_DATE || "",
};

const stageMap = await loadStageMap();
const stageCodesById = new Map();
const targetStageIds = new Set();

addTargetStages({ code: "tz", id: tzStageId, name: tzStageName, required: false });
addTargetStages({
  code: "tzApproval",
  id: tzApprovalStageId,
  name: tzApprovalStageName,
  required: false,
});
addTargetStages({ code: "launch", id: stageId, name: stageName, required: true });
addTargetStages({
  code: "production",
  id: productionStageId,
  name: productionStageName,
  required: false,
});
addTargetStages({
  code: "defect",
  id: defectStageId,
  name: defectStageName,
  required: false,
});

if (!targetStageIds.size) {
  throw new Error(
    `Stage "${stageName}" was not found. Set BITRIX_STAGE_ID in GitHub secrets for exact filtering.`,
  );
}

const deals = await fetchDeals(targetStageIds);
const users = await fetchUsers([...new Set(deals.map((deal) => deal.ASSIGNED_BY_ID).filter(Boolean))]);
const sourceMap = await loadStatusNameMap("SOURCE");
const typeMap = await loadStatusNameMap("DEAL_TYPE");
const customFieldMaps = await loadCustomFieldMaps();
const normalized = deals.map((deal) => normalizeDeal(deal, users, stageMap));

await fs.mkdir(path.resolve("public/data"), { recursive: true });
await fs.writeFile(
  path.resolve("public/data/deals.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), items: normalized }, null, 2),
  "utf8",
);

console.log(`Saved ${normalized.length} Bitrix deals.`);

async function fetchDeals(targetStageIds) {
  const filter = {};
  if (categoryId !== "") filter.CATEGORY_ID = categoryId;
  if (targetStageIds.size === 1) filter.STAGE_ID = [...targetStageIds][0];
  if (targetStageIds.size > 1) filter.STAGE_ID = [...targetStageIds];

  const select = [
    "ID",
    "TITLE",
    "STAGE_ID",
    "CATEGORY_ID",
    "SOURCE_ID",
    "TYPE_ID",
    "OPPORTUNITY",
    "ASSIGNED_BY_ID",
    "BEGINDATE",
    "CLOSEDATE",
    "DATE_CREATE",
    ...Object.values(customFields).filter(Boolean),
  ];

  const all = [];
  let start = 0;
  do {
    const response = await callRest("crm.deal.list", {
      order: { DATE_MODIFY: "DESC" },
      filter,
      select,
      start,
    });
    const batch = response.result || [];
    all.push(...batch);
    start = response.next ?? null;
  } while (start !== null && start !== undefined);

  if (!targetStageIds.size || targetStageIds.size === 1) return all;
  return all.filter((deal) => targetStageIds.has(deal.STAGE_ID));
}

async function fetchUsers(ids) {
  const users = new Map();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await callRest("user.get", { ID: id });
        const user = response.result?.[0];
        if (user) {
          const name = [user.NAME, user.LAST_NAME].filter(Boolean).join(" ");
          const phone = extractBitrixUserPhone(user);
          users.set(String(id), { name, phone });
        }
      } catch {
        users.set(String(id), { name: String(id), phone: "" });
      }
    }),
  );
  return users;
}

const BITRIX_USER_PHONE_FIELDS = [
  "PERSONAL_MOBILE",
  "WORK_PHONE",
  "PERSONAL_PHONE",
  "UF_PHONE_INNER",
  "UF_PHONE",
  "UF_MOBILE",
  "UF_WORK_PHONE",
  "UF_PERSONAL_MOBILE",
];

function extractBitrixUserPhone(user) {
  for (const field of BITRIX_USER_PHONE_FIELDS) {
    const phone = extractPhoneValue(user[field], true);
    if (phone) return phone;
  }

  for (const [field, value] of Object.entries(user || {})) {
    const phone = extractPhoneValue(value, isPhoneFieldName(field));
    if (phone) return phone;
  }

  return "";
}

function isPhoneFieldName(field) {
  return /PHONE|MOBILE|TEL|INNER|EXT/i.test(String(field || ""));
}

function extractPhoneValue(value, allowExtension) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const phone = extractPhoneValue(item, allowExtension);
      if (phone) return phone;
    }
    return "";
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const phone = extractPhoneValue(item, allowExtension);
      if (phone) return phone;
    }
    return "";
  }

  return normalizePhoneText(value, allowExtension);
}

function normalizePhoneText(value, allowExtension) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const digits = text.replace(/\D/g, "");
  const compact = text.replace(/[^\d+]/g, "");
  const plainDigits = text.replace(/[^\d]/g, "");

  if (allowExtension && /^\d{3,5}$/.test(digits) && digits === plainDigits && !/[T:.-]/.test(text)) {
    return text;
  }

  if (/^\+?7\d{10}$/.test(compact) || (/^8\d{10}$/.test(digits) && digits.length === 11)) {
    return text;
  }

  if (/^(\+7|7|8)/.test(compact) && digits.length === 11) {
    return text;
  }

  return "";
}

async function loadStageMap() {
  const stages = new Map();
  await addStatuses(stages, "DEAL_STAGE");

  try {
    const categories = await callRest("crm.dealcategory.list", {});
    for (const category of categories.result || []) {
      await addStatuses(stages, `DEAL_STAGE_${category.ID}`);
      try {
        const categoryStages = await callRest("crm.dealcategory.stage.list", { id: category.ID });
        for (const stage of categoryStages.result || []) {
          stages.set(stage.STATUS_ID || stage.ID, stage.NAME || stage.TITLE || stage.STATUS_ID);
        }
      } catch {
        // Older Bitrix portals may not expose this method for incoming webhooks.
      }
    }
  } catch {
    // Category methods are optional for this MVP.
  }

  return stages;
}

async function loadStatusNameMap(entityId) {
  const statuses = new Map();
  try {
    const response = await callRest("crm.status.list", {
      filter: { ENTITY_ID: entityId },
    });
    for (const status of response.result || []) {
      statuses.set(status.STATUS_ID, status.NAME);
    }
  } catch {
    // Optional dictionaries.
  }
  return statuses;
}

async function addStatuses(stages, entityId) {
  try {
    const response = await callRest("crm.status.list", {
      filter: { ENTITY_ID: entityId },
    });
    for (const status of response.result || []) {
      stages.set(status.STATUS_ID, status.NAME);
    }
  } catch {
    // Ignore missing entity groups.
  }
}

function normalizeDeal(deal, users, stageMap) {
  const id = String(deal.ID);
  const title = deal.TITLE || "";
  const stageId = deal.STAGE_ID || "";
  const stageName = stageMap.get(stageId) || stageId || "";
  const totalSaleAmount = toNumber(deal.OPPORTUNITY);
  const installSaleAmount = toNumber(valueByField(deal, customFields.installAmount));
  const productionSaleAmount =
    installSaleAmount > 0 ? Math.max(0, totalSaleAmount - installSaleAmount) : totalSaleAmount;
  const responsibleUser = users.get(String(deal.ASSIGNED_BY_ID));

  return {
    id,
    number: id,
    title,
    stageId,
    stageCode: stageCodesById.get(stageId) || inferStageCode(stageName),
    source: sourceMap.get(deal.SOURCE_ID) || deal.SOURCE_ID || "",
    type: typeMap.get(deal.TYPE_ID) || deal.TYPE_ID || "",
    classification: displayValueByField(deal, customFields.classification),
    saleAmount: productionSaleAmount,
    installSaleAmount,
    responsible: responsibleUser?.name || "",
    responsiblePhone: responsibleUser?.phone || "",
    startDate: valueByField(deal, customFields.startDate) || deal.BEGINDATE || "",
    expectedFinishDate: valueByField(deal, customFields.expectedFinishDate) || deal.CLOSEDATE || "",
    createdDate: deal.DATE_CREATE || "",
    stageName,
    bitrixUrl: `https://${bitrixDomain}/crm/deal/details/${id}/`,
  };
}

function addTargetStages({ code, id, name, required }) {
  const ids = id
    ? [id]
    : [...stageMap.entries()]
        .filter(([, stageTitle]) => normalize(stageTitle) === normalize(name))
        .map(([stageId]) => stageId);

  if (!ids.length) {
    const message = `Stage "${name}" was not found.`;
    if (required) throw new Error(`${message} Set exact stage ID in GitHub secrets.`);
    console.warn(`${message} Deals from this stage will not be synced.`);
    return;
  }

  for (const stageId of ids) {
    targetStageIds.add(stageId);
    stageCodesById.set(stageId, code);
  }
}

function inferStageCode(stageTitle) {
  const normalized = normalize(stageTitle);
  if (normalized.includes(normalize(tzStageName))) return "tz";
  if (normalized.includes(normalize(tzApprovalStageName))) return "tzApproval";
  if (normalized.includes(normalize(productionStageName))) return "production";
  if (normalized.includes(normalize(defectStageName)) || normalized.includes(normalize("Косяк"))) {
    return "defect";
  }
  return "launch";
}

async function callRest(method, params) {
  const response = await fetch(`${webhookUrl}${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`${method} failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`${method} failed: ${json.error_description || json.error}`);
  }
  return json;
}

async function loadCustomFieldMaps() {
  const maps = new Map();
  try {
    const response = await callRest("crm.deal.userfield.list", {});
    for (const field of response.result || []) {
      if (!field.FIELD_NAME || !Array.isArray(field.LIST)) continue;
      maps.set(
        field.FIELD_NAME,
        new Map(field.LIST.map((item) => [String(item.ID), item.VALUE || String(item.ID)])),
      );
    }
  } catch {
    // Enumeration decoding is helpful, but not required for syncing deals.
  }
  return maps;
}

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function valueByField(row, fieldName) {
  if (!fieldName) return "";
  const value = row[fieldName];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function displayValueByField(row, fieldName) {
  const value = valueByField(row, fieldName);
  if (!fieldName || value === "") return "";
  const values = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  const dictionary = customFieldMaps.get(fieldName);
  if (!dictionary) return values.join(", ");
  return values.map((item) => dictionary.get(String(item)) || item).join(", ");
}

function toNumber(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = String(raw ?? "")
    .split("|")[0]
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
