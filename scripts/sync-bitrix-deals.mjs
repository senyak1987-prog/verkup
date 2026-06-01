import fs from "node:fs/promises";
import path from "node:path";

const env = process.env;
const webhookUrl = required("BITRIX_WEBHOOK_URL").replace(/\/?$/, "/");
const bitrixDomain = env.BITRIX_DOMAIN || new URL(webhookUrl).host;
const stageId = env.BITRIX_STAGE_ID || "";
const stageName = env.BITRIX_STAGE_NAME || "Запустить в производство";
const categoryId = env.BITRIX_CATEGORY_ID || "";

const customFields = {
  classification: env.BITRIX_FIELD_CLASSIFICATION || "",
  installAmount: env.BITRIX_FIELD_INSTALL_AMOUNT || "",
  startDate: env.BITRIX_FIELD_START_DATE || "",
  expectedFinishDate: env.BITRIX_FIELD_EXPECTED_FINISH_DATE || "",
};

const stageMap = await loadStageMap();
const targetStageIds = stageId
  ? new Set([stageId])
  : new Set(
      [...stageMap.entries()]
        .filter(([, name]) => normalize(name) === normalize(stageName))
        .map(([id]) => id),
    );

if (!targetStageIds.size) {
  throw new Error(
    `Stage "${stageName}" was not found. Set BITRIX_STAGE_ID in GitHub secrets for exact filtering.`,
  );
}

const deals = await fetchDeals(targetStageIds);
const users = await fetchUsers([...new Set(deals.map((deal) => deal.ASSIGNED_BY_ID).filter(Boolean))]);
const sourceMap = await loadStatusNameMap("SOURCE");
const typeMap = await loadStatusNameMap("DEAL_TYPE");
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
        if (user) users.set(String(id), [user.NAME, user.LAST_NAME].filter(Boolean).join(" "));
      } catch {
        users.set(String(id), String(id));
      }
    }),
  );
  return users;
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
  return {
    id,
    number: id,
    title,
    source: sourceMap.get(deal.SOURCE_ID) || deal.SOURCE_ID || "",
    type: typeMap.get(deal.TYPE_ID) || deal.TYPE_ID || "",
    classification: valueByField(deal, customFields.classification),
    saleAmount: toNumber(deal.OPPORTUNITY),
    installSaleAmount: toNumber(valueByField(deal, customFields.installAmount)),
    responsible: users.get(String(deal.ASSIGNED_BY_ID)) || "",
    startDate: valueByField(deal, customFields.startDate) || deal.BEGINDATE || "",
    expectedFinishDate: valueByField(deal, customFields.expectedFinishDate) || deal.CLOSEDATE || "",
    createdDate: deal.DATE_CREATE || "",
    stageName: stageMap.get(deal.STAGE_ID) || deal.STAGE_ID || "",
    bitrixUrl: `https://${bitrixDomain}/crm/deal/details/${id}/`,
  };
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

function toNumber(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
