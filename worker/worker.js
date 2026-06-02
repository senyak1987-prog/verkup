const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

const liveCache = {
  deals: undefined,
  dealsExpiresAt: 0,
  dealsPromise: undefined,
  dictionaries: undefined,
  dictionariesExpiresAt: 0,
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true }, 200, cors);
      }

      if (request.method === "GET" && url.pathname === "/data/deals.json") {
        if (env.BITRIX_WEBHOOK_URL) {
          return json(await loadLiveDeals(env), 200, noStoreHeaders(cors));
        }

        requireEnv(env, "GITHUB_TOKEN");
        return await loadJsonFromGitHub(env, "public/data/deals.json", cors);
      }

      if (request.method === "GET" && url.pathname === "/data/calculations.json") {
        requireEnv(env, "GITHUB_TOKEN");
        return await loadJsonFromGitHub(env, "public/data/calculations.json", cors);
      }

      if (request.method === "GET" && url.pathname === "/data/catalogs.json") {
        return json({ error: "Use static catalogs from GitHub Pages" }, 503, noStoreHeaders(cors));
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, cors);
      }

      requireEnv(env, "GITHUB_TOKEN");

      if (url.pathname === "/save-calculations") {
        const body = await request.json();
        return await saveJsonToGitHub(
          env,
          "public/data/calculations.json",
          `Update Verkup calculations ${new Date().toISOString()}`,
          body.data,
          cors,
        );
      }

      if (url.pathname === "/save-catalogs") {
        const body = await request.json();
        return await saveJsonToGitHub(
          env,
          "public/data/catalogs.json",
          `Update Verkup catalogs ${new Date().toISOString()}`,
          body.data,
          cors,
        );
      }

      if (url.pathname === "/move-to-production") {
        const body = await request.json();
        const dealId = String(body.dealId || "").trim();
        const targetStageId = targetStageIdFor(env, "production", body.targetStageId);

        if (!dealId) {
          return json({ error: "dealId is required" }, 400, cors);
        }

        await dispatchMoveWorkflow(env, dealId, targetStageId);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/move-to-launch") {
        const body = await request.json();
        const dealId = String(body.dealId || "").trim();
        const targetStageId = targetStageIdFor(env, "launch", body.targetStageId);

        if (!dealId) {
          return json({ error: "dealId is required" }, 400, cors);
        }

        await dispatchMoveWorkflow(env, dealId, targetStageId);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/move-stage") {
        const body = await request.json();
        const dealId = String(body.dealId || "").trim();
        const targetStage = String(body.targetStage || "").trim();

        if (!dealId) {
          return json({ error: "dealId is required" }, 400, cors);
        }

        const targetStageId = targetStageIdFor(env, targetStage, body.targetStageId);
        await dispatchMoveWorkflow(env, dealId, targetStageId);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/sync-bitrix") {
        await dispatchSyncWorkflow(env);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: error.message || "Unexpected API error" }, status, cors);
    }
  },
};

async function loadJsonFromGitHub(env, path, cors) {
  const branch = env.GITHUB_BRANCH || "main";
  const staticUrl = staticDataUrlFor(env, path);

  if (staticUrl) {
    const staticResponse = await fetch(`${staticUrl}?t=${Date.now()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "verkup-save-api",
      },
    });

    if (staticResponse.ok) {
      return json(await staticResponse.json(), 200, noStoreHeaders(cors));
    }
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner(env)}/${repo(env)}/${encodeURIComponent(branch)}/${path}?t=${Date.now()}`;
  const rawResponse = await fetch(rawUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "verkup-save-api",
    },
  });

  if (rawResponse.ok) {
    return json(await rawResponse.json(), 200, noStoreHeaders(cors));
  }

  const url = `https://api.github.com/repos/${owner(env)}/${repo(env)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: githubHeaders(env),
  });

  if (!response.ok) {
    throw await githubError(response, "GitHub data load failed");
  }

  const body = await response.json();
  return json(JSON.parse(fromBase64Utf8(body.content || "")), 200, noStoreHeaders(cors));
}

function staticDataUrlFor(env, path) {
  const match = String(path).match(/^public\/data\/(.+)$/);
  if (!match) return "";

  const base =
    env.STATIC_DATA_BASE_URL ||
    `https://${owner(env)}.github.io/${repo(env)}/data`;

  return `${base.replace(/\/+$/, "")}/${match[1]}`;
}

async function saveJsonToGitHub(env, path, message, data, cors) {
  if (!data) {
    return json({ error: "data is required" }, 400, cors);
  }

  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner(env)}/${repo(env)}/contents/${path}`;
  const current = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env),
  });
  const currentJson = current.ok ? await current.json() : undefined;

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      branch,
      content: toBase64Utf8(`${JSON.stringify(data, null, 2)}\n`),
      sha: currentJson?.sha,
    }),
  });

  if (!response.ok) {
    throw await githubError(response, "GitHub save failed");
  }

  return json({ ok: true, result: await response.json() }, 200, cors);
}

async function dispatchSyncWorkflow(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner(env)}/${repo(env)}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      event_type: "bitrix_deal_stage_changed",
      client_payload: {
        source: "verkup-save-api",
      },
    }),
  });

  if (!response.ok) {
    throw await githubError(response, "GitHub sync dispatch failed");
  }
}

async function dispatchMoveWorkflow(env, dealId, targetStageId) {
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner(env)}/${repo(env)}/actions/workflows/move-bitrix-stage.yml/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: githubHeaders(env),
    body: JSON.stringify({
      ref: branch,
      inputs: {
        deal_id: dealId,
        target_stage_id: targetStageId,
      },
    }),
  });

  if (!response.ok) {
    throw await githubError(response, "GitHub workflow dispatch failed");
  }
}

async function loadLiveDeals(env) {
  const now = Date.now();
  if (liveCache.deals && liveCache.dealsExpiresAt > now) return liveCache.deals;
  if (liveCache.dealsPromise) return liveCache.dealsPromise;

  liveCache.dealsPromise = fetchLiveDeals(env)
    .then((data) => {
      liveCache.deals = data;
      liveCache.dealsExpiresAt = Date.now() + 5000;
      return data;
    })
    .finally(() => {
      liveCache.dealsPromise = undefined;
    });

  return liveCache.dealsPromise;
}

async function fetchLiveDeals(env) {
  const dictionaries = await loadLiveDictionaries(env);
  const targetStageIds = new Set();
  const stageCodesById = new Map();
  addLiveStageTarget(env, dictionaries.stageMap, targetStageIds, stageCodesById, {
    code: "launch",
    id: env.BITRIX_LAUNCH_STAGE_ID || env.BITRIX_STAGE_ID || "4",
    name: env.BITRIX_LAUNCH_STAGE_NAME || "Запустить в производство",
  });
  addLiveStageTarget(env, dictionaries.stageMap, targetStageIds, stageCodesById, {
    code: "production",
    id: env.BITRIX_PRODUCTION_STAGE_ID || "10",
    name: env.BITRIX_PRODUCTION_STAGE_NAME || "В производстве",
  });

  const deals = await fetchBitrixDeals(env, targetStageIds);
  const users = await fetchBitrixUsers(
    env,
    [...new Set(deals.map((deal) => deal.ASSIGNED_BY_ID).filter(Boolean))],
  );

  return {
    generatedAt: new Date().toISOString(),
    items: deals.map((deal) => normalizeBitrixDeal(env, deal, users, dictionaries, stageCodesById)),
  };
}

async function loadLiveDictionaries(env) {
  const now = Date.now();
  if (liveCache.dictionaries && liveCache.dictionariesExpiresAt > now) {
    return liveCache.dictionaries;
  }

  const dictionaries = {
    stageMap: await loadBitrixStageMap(env),
    sourceMap: await loadBitrixStatusMap(env, "SOURCE"),
    typeMap: await loadBitrixStatusMap(env, "DEAL_TYPE"),
    customFieldMaps: await loadBitrixCustomFieldMaps(env),
  };
  liveCache.dictionaries = dictionaries;
  liveCache.dictionariesExpiresAt = now + 5 * 60 * 1000;
  return dictionaries;
}

async function fetchBitrixDeals(env, targetStageIds) {
  const filter = {};
  if (env.BITRIX_CATEGORY_ID) filter.CATEGORY_ID = env.BITRIX_CATEGORY_ID;
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
    ...liveCustomFields(env),
  ];

  const all = [];
  let start = 0;
  do {
    const response = await callBitrixRest(env, "crm.deal.list", {
      order: { DATE_MODIFY: "DESC" },
      filter,
      select,
      start,
    });
    const batch = response.result || [];
    all.push(...batch);
    start = response.next ?? null;
  } while (start !== null && start !== undefined);

  if (targetStageIds.size <= 1) return all;
  return all.filter((deal) => targetStageIds.has(deal.STAGE_ID));
}

async function fetchBitrixUsers(env, ids) {
  const users = new Map();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await callBitrixRest(env, "user.get", { ID: id });
        const user = response.result?.[0];
        if (user) users.set(String(id), [user.NAME, user.LAST_NAME].filter(Boolean).join(" "));
      } catch {
        users.set(String(id), String(id));
      }
    }),
  );
  return users;
}

async function loadBitrixStageMap(env) {
  const stages = new Map();
  await addBitrixStatuses(env, stages, "DEAL_STAGE");

  try {
    const categories = await callBitrixRest(env, "crm.dealcategory.list", {});
    for (const category of categories.result || []) {
      await addBitrixStatuses(env, stages, `DEAL_STAGE_${category.ID}`);
      try {
        const categoryStages = await callBitrixRest(env, "crm.dealcategory.stage.list", {
          id: category.ID,
        });
        for (const stage of categoryStages.result || []) {
          stages.set(stage.STATUS_ID || stage.ID, stage.NAME || stage.TITLE || stage.STATUS_ID);
        }
      } catch {
        // Older Bitrix portals may not expose this method for incoming webhooks.
      }
    }
  } catch {
    // Category methods are optional.
  }

  return stages;
}

async function loadBitrixStatusMap(env, entityId) {
  const statuses = new Map();
  await addBitrixStatuses(env, statuses, entityId);
  return statuses;
}

async function addBitrixStatuses(env, statuses, entityId) {
  try {
    const response = await callBitrixRest(env, "crm.status.list", {
      filter: { ENTITY_ID: entityId },
    });
    for (const status of response.result || []) {
      statuses.set(status.STATUS_ID, status.NAME);
    }
  } catch {
    // Ignore missing entity groups.
  }
}

async function loadBitrixCustomFieldMaps(env) {
  const maps = new Map();
  try {
    const response = await callBitrixRest(env, "crm.deal.userfield.list", {});
    for (const field of response.result || []) {
      if (!field.FIELD_NAME || !Array.isArray(field.LIST)) continue;
      maps.set(
        field.FIELD_NAME,
        new Map(field.LIST.map((item) => [String(item.ID), item.VALUE || String(item.ID)])),
      );
    }
  } catch {
    // Enumeration decoding is helpful, but not required.
  }
  return maps;
}

function normalizeBitrixDeal(env, deal, users, dictionaries, stageCodesById) {
  const id = String(deal.ID);
  const fields = liveFieldNames(env);
  const stageId = deal.STAGE_ID || "";
  const stageName = dictionaries.stageMap.get(stageId) || stageId || "";
  const totalSaleAmount = toNumber(deal.OPPORTUNITY);
  const installSaleAmount = toNumber(valueByField(deal, fields.installAmount));
  const productionSaleAmount =
    installSaleAmount > 0 ? Math.max(0, totalSaleAmount - installSaleAmount) : totalSaleAmount;
  const bitrixDomain = env.BITRIX_DOMAIN || new URL(env.BITRIX_WEBHOOK_URL).host;

  return {
    id,
    number: id,
    title: deal.TITLE || "",
    stageId,
    stageCode: stageCodesById.get(stageId) || inferLiveStageCode(env, stageName),
    source: dictionaries.sourceMap.get(deal.SOURCE_ID) || deal.SOURCE_ID || "",
    type: dictionaries.typeMap.get(deal.TYPE_ID) || deal.TYPE_ID || "",
    classification: displayValueByField(deal, fields.classification, dictionaries.customFieldMaps),
    saleAmount: productionSaleAmount,
    installSaleAmount,
    responsible: users.get(String(deal.ASSIGNED_BY_ID)) || "",
    startDate: valueByField(deal, fields.startDate) || deal.BEGINDATE || "",
    expectedFinishDate: valueByField(deal, fields.expectedFinishDate) || deal.CLOSEDATE || "",
    createdDate: deal.DATE_CREATE || "",
    stageName,
    bitrixUrl: `https://${bitrixDomain}/crm/deal/details/${id}/`,
  };
}

function addLiveStageTarget(env, stageMap, targetStageIds, stageCodesById, { code, id, name }) {
  const ids = id
    ? [id]
    : [...stageMap.entries()]
        .filter(([, stageTitle]) => normalize(stageTitle) === normalize(name))
        .map(([stageId]) => stageId);

  for (const stageId of ids) {
    targetStageIds.add(stageId);
    stageCodesById.set(stageId, code);
  }
}

async function callBitrixRest(env, method, params) {
  const webhookUrl = env.BITRIX_WEBHOOK_URL.replace(/\/?$/, "/");
  const response = await fetch(`${webhookUrl}${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`${method} failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  if (body.error) {
    throw new Error(`${method} failed: ${body.error_description || body.error}`);
  }
  return body;
}

function liveFieldNames(env) {
  return {
    classification: env.BITRIX_FIELD_CLASSIFICATION || "UF_CRM_6512B7A78D965",
    installAmount: env.BITRIX_FIELD_INSTALL_AMOUNT || "UF_CRM_1547662428256",
    startDate: env.BITRIX_FIELD_START_DATE || "",
    expectedFinishDate: env.BITRIX_FIELD_EXPECTED_FINISH_DATE || "",
  };
}

function liveCustomFields(env) {
  return Object.values(liveFieldNames(env)).filter(Boolean);
}

function inferLiveStageCode(env, stageTitle) {
  return normalize(stageTitle) === normalize(env.BITRIX_PRODUCTION_STAGE_NAME || "В производстве")
    ? "production"
    : "launch";
}

function valueByField(row, fieldName) {
  if (!fieldName) return "";
  const value = row[fieldName];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function displayValueByField(row, fieldName, customFieldMaps) {
  const value = valueByField(row, fieldName);
  if (!fieldName || value === "") return "";
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function owner(env) {
  return env.GITHUB_OWNER || "senyak1987-prog";
}

function repo(env) {
  return env.GITHUB_REPO || "verkup";
}

function requireEnv(env, name) {
  if (!env[name]) {
    const error = new Error(`${name} is not configured`);
    error.status = 500;
    throw error;
  }
}

function targetStageIdFor(env, targetStage, explicitStageId) {
  const target = String(targetStage || "").trim().toLowerCase();
  const explicit = String(explicitStageId || "").trim();
  if (explicit) return explicit;

  if (target === "launch") return String(env.BITRIX_LAUNCH_STAGE_ID || "4");
  if (target === "production") return String(env.BITRIX_PRODUCTION_STAGE_ID || "10");

  const error = new Error("targetStage must be launch or production");
  error.status = 400;
  throw error;
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "verkup-save-api",
  };
}

async function githubError(response, prefix) {
  const text = await response.text();
  let message = text;

  try {
    const jsonBody = JSON.parse(text);
    message = jsonBody.message || text;
  } catch {
    // Keep raw GitHub response text.
  }

  const error = new Error(`${prefix}: ${response.status} ${message}`);
  error.status = response.status;
  return error;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.includes("*") || !origin
      ? "*"
      : allowed.includes(origin)
        ? origin
        : allowed[0] || origin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function noStoreHeaders(headers) {
  return {
    ...headers,
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...jsonHeaders,
      ...extraHeaders,
    },
  });
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64Utf8(value) {
  const binary = atob(String(value).replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes) || "{}";
}
