const env = process.env;
const webhookUrl = required("BITRIX_WEBHOOK_URL").replace(/\/?$/, "/");
const dealId = required("BITRIX_DEAL_ID");
const targetStageId = env.BITRIX_TARGET_STAGE_ID || "";
const targetStageName =
  env.BITRIX_TARGET_STAGE_NAME ||
  (targetStageId === env.BITRIX_TZ_STAGE_ID ? env.BITRIX_TZ_STAGE_NAME : "") ||
  (targetStageId === env.BITRIX_TZ_APPROVAL_STAGE_ID ? env.BITRIX_TZ_APPROVAL_STAGE_NAME : "") ||
  (targetStageId === env.BITRIX_LAUNCH_STAGE_ID ? env.BITRIX_LAUNCH_STAGE_NAME : "") ||
  env.BITRIX_PRODUCTION_STAGE_NAME ||
  "В производстве";

const stageId = targetStageId || (await resolveStageId(targetStageName));
if (!stageId) {
  throw new Error(`Stage "${targetStageName}" was not found. Set BITRIX_TARGET_STAGE_ID.`);
}

await callRest("crm.deal.update", {
  id: dealId,
  fields: {
    STAGE_ID: stageId,
  },
});

console.log(`Deal ${dealId} moved to stage ${stageId}.`);

async function resolveStageId(stageName) {
  const stages = await loadStageMap();
  const normalizedName = normalize(stageName);
  const match = [...stages.entries()].find(([, name]) => normalize(name) === normalizedName);
  return match?.[0] || "";
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
        // Optional on some Bitrix portals.
      }
    }
  } catch {
    // Optional on some Bitrix portals.
  }

  return stages;
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

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
