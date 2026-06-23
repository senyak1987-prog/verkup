const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

const liveCache = {
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

      if (request.method === "GET" && url.pathname === "/data/tech-specs.json") {
        requireEnv(env, "GITHUB_TOKEN");
        return await loadJsonFromGitHub(env, "public/data/tech-specs.json", cors);
      }

      if (request.method === "GET" && url.pathname === "/data/production.json") {
        requireEnv(env, "GITHUB_TOKEN");
        return await loadJsonFromGitHub(env, "public/data/production.json", cors);
      }

      if (request.method === "GET" && url.pathname === "/data/catalogs.json") {
        return json({ error: "Use static catalogs from GitHub Pages" }, 503, noStoreHeaders(cors));
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, cors);
      }

      if (url.pathname === "/send-production-push") {
        const body = await request.json();
        return await sendProductionPush(env, body, cors);
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

      if (url.pathname === "/save-tech-specs") {
        const body = await request.json();
        return await saveJsonToGitHub(
          env,
          "public/data/tech-specs.json",
          `Update Verkup tech specs ${new Date().toISOString()}`,
          body.data,
          cors,
        );
      }

      if (url.pathname === "/save-production") {
        const body = await request.json();
        return await saveProductionToGitHub(env, body.data, cors);
      }

      if (url.pathname === "/upload-tech-spec") {
        const body = await request.json();
        return await uploadTechSpecToBitrix(env, body, cors);
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

async function saveProductionToGitHub(env, data, cors) {
  let nextData = data;

  try {
    const currentData = await readJsonFromGitHub(env, "public/data/production.json");
    if (isStoredProductionData(currentData) && isStoredProductionData(data)) {
      nextData = mergeStoredProductionData(currentData, data);
    }
  } catch {
    // If the current file cannot be read, save the incoming production snapshot.
  }

  return await saveJsonToGitHub(
    env,
    "public/data/production.json",
    `Update Verkup production ${new Date().toISOString()}`,
    nextData,
    cors,
  );
}

async function readJsonFromGitHub(env, path) {
  const response = await loadJsonFromGitHub(env, path, {});
  if (!response.ok) throw new Error("GitHub data load failed");
  return await response.json();
}

function mergeStoredProductionData(base, incoming) {
  const preferIncomingRecords = isDateNewer(incoming.generatedAt, base.generatedAt);

  return {
    ...base,
    generatedAt: preferIncomingRecords ? incoming.generatedAt : base.generatedAt,
    employees: mergeRecordsById(base.employees || [], incoming.employees || [], preferIncomingRecords),
    registrations: mergeRecordsById(
      base.registrations || [],
      incoming.registrations || [],
      preferIncomingRecords,
    ),
    registrationLinks: mergeRecordsById(
      base.registrationLinks || [],
      incoming.registrationLinks || [],
      preferIncomingRecords,
    ),
    assignments: mergeRecordsById(base.assignments || [], incoming.assignments || [], preferIncomingRecords),
    payouts: mergeRecordsById(base.payouts || [], incoming.payouts || [], preferIncomingRecords),
  };
}

function mergeRecordsById(baseRecords, incomingRecords, preferIncomingRecords) {
  const records = new Map();
  for (const record of baseRecords) records.set(String(record.id), record);
  for (const record of incomingRecords) {
    const key = String(record.id);
    if (preferIncomingRecords || !records.has(key)) records.set(key, record);
  }
  return [...records.values()];
}

function isStoredProductionData(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray(value.employees) &&
      Array.isArray(value.assignments),
  );
}

function isDateNewer(candidate, baseline) {
  const candidateMs = Date.parse(candidate || "");
  const baselineMs = Date.parse(baseline || "");
  return Number.isFinite(candidateMs) && Number.isFinite(baselineMs) && candidateMs > baselineMs;
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

async function sendProductionPush(env, body, cors) {
  const serviceUrl = String(env.PUSH_SERVICE_URL || "").trim();
  const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions : [];
  const payload = {
    body: String(body.body || ""),
    employeeId: String(body.employeeId || ""),
    title: String(body.title || "Новая сборка Verkup"),
    url: String(body.url || ""),
  };

  if (!subscriptions.length) {
    return json({ ok: true, sent: 0 }, 200, cors);
  }

  if (env.PUSH_VAPID_PRIVATE_KEY && env.PUSH_VAPID_PUBLIC_KEY) {
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => sendWebPushNotification(env, subscription, payload)),
    );
    const sent = results.filter(
      (result) =>
        result.status === "fulfilled" && result.value.status >= 200 && result.value.status < 300,
    ).length;
    const expired = results.filter(
      (result) =>
        result.status === "fulfilled" &&
        (result.value.status === 404 || result.value.status === 410),
    ).length;

    return json(
      {
        ok: true,
        configured: true,
        sent,
        expired,
        failed: results.length - sent - expired,
        service: "web-push",
      },
      200,
      cors,
    );
  }

  if (!serviceUrl) {
    return json(
      {
        ok: true,
        configured: false,
        sent: 0,
        message: "PUSH_SERVICE_URL or PUSH_VAPID_PRIVATE_KEY is not configured",
      },
      202,
      cors,
    );
  }

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (env.PUSH_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${env.PUSH_SERVICE_TOKEN}`;
  }

  const response = await fetch(serviceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      body: String(body.body || ""),
      employeeId: String(body.employeeId || ""),
      subscriptions,
      title: String(body.title || "Новая сборка Verkup"),
      url: String(body.url || ""),
    }),
  });

  if (!response.ok) {
    throw new Error(`Push service responded ${response.status}`);
  }

  return json({ ok: true, sent: subscriptions.length }, 200, cors);
}

async function sendWebPushNotification(env, subscription, payload) {
  const endpoint = String(subscription?.endpoint || "");
  if (!endpoint) return { status: 400 };

  const audience = new URL(endpoint).origin;
  const token = await createVapidToken(env, audience);
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || "").trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${publicKey}`,
      TTL: String(env.PUSH_TTL_SECONDS || 60 * 60 * 24 * 7),
      Urgency: "high",
      Topic: webPushTopic(payload.employeeId || "assignment"),
    },
  });

  return { status: response.status };
}

async function createVapidToken(env, audience) {
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.PUSH_VAPID_PRIVATE_KEY || "").trim();
  const subject = String(env.PUSH_VAPID_SUBJECT || "mailto:verkup@example.com").trim();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlEncodeJson({
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: subject,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importVapidPrivateKey(publicKey, privateKey),
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(normalizeEcdsaSignature(new Uint8Array(signature)))}`;
}

async function importVapidPrivateKey(publicKey, privateKey) {
  const publicBytes = base64UrlDecode(publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error("PUSH_VAPID_PUBLIC_KEY must be an uncompressed P-256 public key");
  }

  return await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
      d: privateKey,
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

function normalizeEcdsaSignature(signature) {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) return signature;

  let offset = signature[1] & 0x80 ? 2 + (signature[1] & 0x7f) : 2;
  const r = readDerInteger(signature, offset);
  offset = r.offset;
  const s = readDerInteger(signature, offset);
  return concatBytes(leftPad32(r.value), leftPad32(s.value));
}

function readDerInteger(bytes, offset) {
  if (bytes[offset] !== 0x02) throw new Error("Invalid ECDSA signature");
  const length = bytes[offset + 1];
  const start = offset + 2;
  const value = bytes.slice(start, start + length);
  return {
    offset: start + length,
    value: value[0] === 0 ? value.slice(1) : value,
  };
}

function leftPad32(bytes) {
  if (bytes.length === 32) return bytes;
  if (bytes.length > 32) return bytes.slice(bytes.length - 32);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return padded;
}

function concatBytes(first, second) {
  const result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

function base64UrlEncodeJson(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const base64 = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from([...binary].map((char) => char.charCodeAt(0)));
}

function webPushTopic(value) {
  return String(value || "assignment")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 32) || "assignment";
}

async function loadLiveDeals(env) {
  if (liveCache.dealsPromise) return liveCache.dealsPromise;

  liveCache.dealsPromise = fetchLiveDeals(env)
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
    code: "tz",
    id: env.BITRIX_TZ_STAGE_ID || "DETAILS",
    name: env.BITRIX_TZ_STAGE_NAME || "Подготовка ТЗ",
  });
  addLiveStageTarget(env, dictionaries.stageMap, targetStageIds, stageCodesById, {
    code: "tzApproval",
    id: env.BITRIX_TZ_APPROVAL_STAGE_ID || "13",
    name: env.BITRIX_TZ_APPROVAL_STAGE_NAME || "Согласование ТЗ",
  });
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
  addLiveStageTarget(env, dictionaries.stageMap, targetStageIds, stageCodesById, {
    code: "defect",
    id: env.BITRIX_DEFECT_STAGE_ID || "9",
    name: env.BITRIX_DEFECT_STAGE_NAME || "КОСЯК в заказе",
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
    "UF_*",
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
        if (user) {
          users.set(String(id), normalizeBitrixUser(env, user, id));
        }
      } catch {
        users.set(String(id), createResponsibleFallback(env, id));
      }
    }),
  );
  return users;
}

function normalizeBitrixUser(env, user, id) {
  const idText = String(id || "");
  const name = [user.LAST_NAME, user.NAME, user.SECOND_NAME].filter(Boolean).join(" ").trim();
  return {
    id: idText,
    name: name || idText,
    phone: extractBitrixUserPhone(user),
    internalPhone: extractBitrixUserInternalPhone(user),
    email: firstText(user.EMAIL, user.WORK_EMAIL, user.PERSONAL_EMAIL),
    position: firstText(user.WORK_POSITION, user.UF_POSITION, user.PERSONAL_PROFESSION),
    department: firstText(user.WORK_DEPARTMENT),
    supervisor: normalizeBitrixSupervisor(user.UF_HEAD),
    avatarUrl: extractBitrixUserPhoto(env, user),
    bitrixUrl: bitrixUserUrl(env, idText),
    chatUrl: bitrixChatUrl(env, idText),
    videoUrl: bitrixChatUrl(env, idText),
    lastSeenAt: normalizeDateText(
      user.LAST_ACTIVITY_DATE || user.LAST_ACTIVITY || user.LAST_LOGIN || user.TIMESTAMP_X,
    ),
  };
}

function createResponsibleFallback(env, id) {
  const idText = String(id || "");
  return {
    id: idText,
    name: idText,
    phone: "",
    bitrixUrl: idText ? bitrixUserUrl(env, idText) : "",
    chatUrl: idText ? bitrixChatUrl(env, idText) : "",
    videoUrl: idText ? bitrixChatUrl(env, idText) : "",
  };
}

function cleanResponsibleCard(user) {
  if (!user) return undefined;
  return { ...user };
}

function bitrixUserUrl(env, id) {
  return `https://${env.BITRIX_DOMAIN || new URL(env.BITRIX_WEBHOOK_URL).host}/company/personal/user/${id}/`;
}

function bitrixChatUrl(env, id) {
  return `https://${env.BITRIX_DOMAIN || new URL(env.BITRIX_WEBHOOK_URL).host}/online/?IM_DIALOG=U${id}`;
}

function normalizeBitrixSupervisor(value) {
  const text = firstText(value);
  if (!text) return "";
  return /^\d+$/.test(text) ? `ID ${text}` : text;
}

function extractBitrixUserPhoto(env, user) {
  for (const field of ["PERSONAL_PHOTO", "WORK_LOGO", "PERSONAL_PHOTO_URL"]) {
    const url = firstText(user?.[field]);
    if (url && !/^\d+$/.test(url)) return absoluteBitrixFileUrl(url, env.BITRIX_DOMAIN || new URL(env.BITRIX_WEBHOOK_URL).host);
  }
  return "";
}

function normalizeDateText(value) {
  const text = firstText(value);
  if (!text || /^\d+$/.test(text)) return "";
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

const BITRIX_USER_PHONE_FIELDS = [
  "PERSONAL_MOBILE",
  "PERSONAL_MOBILE_PHONE",
  "UF_MOBILE_PHONE",
  "WORK_PHONE",
  "PERSONAL_PHONE",
  "UF_PHONE",
  "UF_MOBILE",
  "UF_WORK_PHONE",
  "UF_PERSONAL_MOBILE",
  "UF_PERSONAL_PHONE",
  "UF_CRM_PHONE",
];

const BITRIX_USER_INTERNAL_PHONE_FIELDS = [
  "UF_PHONE_INNER",
  "UF_PHONE_INTERNAL",
  "UF_INNER_PHONE",
  "UF_INTERNAL_PHONE",
  "UF_EXTENSION",
  "WORK_PHONE_INNER",
  "UF_WORK_PHONE_INNER",
];

function extractBitrixUserPhone(user) {
  for (const field of BITRIX_USER_PHONE_FIELDS) {
    const phone = extractPhoneValue(user[field], false);
    if (phone) return phone;
  }

  for (const [field, value] of Object.entries(user || {})) {
    const phone = extractPhoneValue(value, isPhoneFieldName(field));
    if (phone) return phone;
  }

  return "";
}

function extractBitrixUserInternalPhone(user) {
  for (const field of BITRIX_USER_INTERNAL_PHONE_FIELDS) {
    const phone = extractPhoneValue(user[field], true);
    if (phone) return phone;
  }

  for (const [field, value] of Object.entries(user || {})) {
    if (!isInternalPhoneFieldName(field)) continue;
    const phone = extractPhoneValue(value, true);
    if (phone) return phone;
  }

  return "";
}

function isPhoneFieldName(field) {
  return /PHONE|MOBILE|TEL/i.test(String(field || "")) && !isInternalPhoneFieldName(field);
}

function isInternalPhoneFieldName(field) {
  return /INNER|INTERNAL|EXTENSION/i.test(String(field || ""));
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
  const responsibleId = String(deal.ASSIGNED_BY_ID || "");
  const responsibleUser = users.get(responsibleId);
  const installationAddress = valueByField(deal, fields.installAddress) || inferDealTextField(deal, [
    "INSTALL_ADDRESS",
    "INSTALLATION_ADDRESS",
    "MOUNT_ADDRESS",
    "MOUNTING_ADDRESS",
    "ADDRESS",
    "АДРЕС",
    "МОНТАЖ",
  ]);
  const installationClientName = valueByField(deal, fields.installClientName) || inferDealTextField(deal, [
    "INSTALL_CLIENT",
    "INSTALLATION_CLIENT",
    "CLIENT_NAME",
    "CUSTOMER",
    "КЛИЕНТ",
    "ЗАКАЗЧИК",
  ]);
  const installationClientPhone = valueByField(deal, fields.installClientPhone) || inferDealPhoneField(deal);
  const installationComment = valueByField(deal, fields.installComment) || inferDealTextField(deal, [
    "INSTALL_COMMENT",
    "INSTALLATION_COMMENT",
    "MOUNT_COMMENT",
    "COMMENT",
    "КОММЕНТ",
    "ПРИМЕЧ",
  ]);
  const installationFiles = extractBitrixDealFiles(
    fields.installFiles ? deal[fields.installFiles] : inferDealFileField(deal),
    bitrixDomain,
  );

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
    responsibleId,
    responsible: responsibleUser?.name || responsibleId,
    responsiblePhone: responsibleUser?.phone || "",
    responsibleCard: cleanResponsibleCard(responsibleUser || (responsibleId ? createResponsibleFallback(env, responsibleId) : undefined)),
    startDate: valueByField(deal, fields.startDate) || deal.BEGINDATE || "",
    expectedFinishDate: valueByField(deal, fields.expectedFinishDate) || deal.CLOSEDATE || "",
    createdDate: deal.DATE_CREATE || "",
    stageName,
    bitrixUrl: `https://${bitrixDomain}/crm/deal/details/${id}/`,
    installationAddress,
    installationClientName,
    installationClientPhone,
    installationComment,
    installationFiles,
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
    installAddress: env.BITRIX_FIELD_INSTALL_ADDRESS || "",
    installClientName: env.BITRIX_FIELD_INSTALL_CLIENT_NAME || "",
    installClientPhone: env.BITRIX_FIELD_INSTALL_CLIENT_PHONE || "",
    installComment: env.BITRIX_FIELD_INSTALL_COMMENT || "",
    installFiles: env.BITRIX_FIELD_INSTALL_FILES || "",
    startDate: env.BITRIX_FIELD_START_DATE || "",
    expectedFinishDate: env.BITRIX_FIELD_EXPECTED_FINISH_DATE || "",
  };
}

function liveCustomFields(env) {
  return Object.values(liveFieldNames(env)).filter(Boolean);
}

function inferLiveStageCode(env, stageTitle) {
  const normalized = normalize(stageTitle);
  if (normalized.includes(normalize(env.BITRIX_TZ_STAGE_NAME || "Подготовка ТЗ"))) return "tz";
  if (normalized.includes(normalize(env.BITRIX_TZ_APPROVAL_STAGE_NAME || "Согласование ТЗ"))) return "tzApproval";
  if (normalized.includes(normalize(env.BITRIX_PRODUCTION_STAGE_NAME || "В производстве"))) {
    return "production";
  }
  if (
    normalized.includes(normalize(env.BITRIX_DEFECT_STAGE_NAME || "КОСЯК в заказе")) ||
    normalized.includes(normalize("Косяк"))
  ) {
    return "defect";
  }
  return "launch";
}

function valueByField(row, fieldName) {
  if (!fieldName) return "";
  const value = row[fieldName];
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (text) return text;
  }
  return "";
}

function normalizeTextValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = normalizeTextValue(item);
      if (text) return text;
    }
    return "";
  }

  if (value && typeof value === "object") {
    for (const key of ["VALUE", "TEXT", "NAME", "TITLE", "URL", "SRC"]) {
      const text = normalizeTextValue(value[key]);
      if (text) return text;
    }
    return "";
  }

  return String(value || "").replace(/\s+/g, " ").trim();
}

function inferDealTextField(deal, needles) {
  const normalizedNeedles = needles.map(normalize);
  for (const [field, value] of Object.entries(deal || {})) {
    const normalizedField = normalize(field);
    if (!normalizedNeedles.some((needle) => normalizedField.includes(needle))) continue;
    if (/FILE|PHOTO|IMAGE|ФАЙЛ|ФОТО/i.test(field)) continue;
    const text = firstText(value);
    if (text && !/^\d+$/.test(text)) return text;
  }
  return "";
}

function inferDealPhoneField(deal) {
  for (const [field, value] of Object.entries(deal || {})) {
    if (!/PHONE|TEL|MOBILE|ТЕЛ/i.test(field)) continue;
    const phone = extractPhoneValue(value, true);
    if (phone) return phone;
  }
  return "";
}

function inferDealFileField(deal) {
  for (const [field, value] of Object.entries(deal || {})) {
    if (!/FILE|PHOTO|IMAGE|ATTACH|ФАЙЛ|ФОТО|МАКЕТ/i.test(field)) continue;
    const files = extractBitrixDealFiles(value, "");
    if (files.length) return value;
  }
  return undefined;
}

function extractBitrixDealFiles(value, bitrixDomain) {
  const files = [];
  collectBitrixDealFiles(value, files, bitrixDomain);
  return files;
}

function collectBitrixDealFiles(value, files, bitrixDomain) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBitrixDealFiles(item, files, bitrixDomain);
    return;
  }

  if (typeof value === "object") {
    const url = firstText(value.URL, value.SRC, value.DOWNLOAD_URL, value.downloadUrl, value.url);
    const id = firstText(value.ID, value.id, value.FILE_ID, value.fileId) || (url ? String(files.length + 1) : "");
    const name = firstText(value.ORIGINAL_NAME, value.FILE_NAME, value.NAME, value.TITLE, value.name) || `Файл ${id || files.length + 1}`;
    if (url) {
      const absoluteUrl = absoluteBitrixFileUrl(url, bitrixDomain);
      files.push({
        id: String(id),
        name,
        url: absoluteUrl,
        downloadUrl: absoluteUrl,
        type: /\.(png|jpe?g|webp|gif)$/i.test(name) || /image/i.test(firstText(value.CONTENT_TYPE, value.type))
          ? "image"
          : "file",
      });
      return;
    }

    for (const item of Object.values(value)) collectBitrixDealFiles(item, files, bitrixDomain);
    return;
  }

  const text = String(value || "").trim();
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) {
    const absoluteUrl = absoluteBitrixFileUrl(text, bitrixDomain);
    const name = decodeURIComponent(absoluteUrl.split("/").pop() || `Файл ${files.length + 1}`);
    files.push({
      id: String(files.length + 1),
      name,
      url: absoluteUrl,
      downloadUrl: absoluteUrl,
      type: /\.(png|jpe?g|webp|gif)$/i.test(name) ? "image" : "file",
    });
  }
}

function absoluteBitrixFileUrl(value, bitrixDomain) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:|data:)/i.test(url)) return url;
  if (url.startsWith("/") && bitrixDomain) return `https://${bitrixDomain}${url}`;
  return url;
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

  if (target === "tz" || target === "techspec" || target === "tech-spec") {
    return String(env.BITRIX_TZ_STAGE_ID || "DETAILS");
  }
  if (target === "tzapproval" || target === "tz-approval") {
    return String(env.BITRIX_TZ_APPROVAL_STAGE_ID || "13");
  }
  if (target === "launch") return String(env.BITRIX_LAUNCH_STAGE_ID || "4");
  if (target === "production") return String(env.BITRIX_PRODUCTION_STAGE_ID || "10");
  if (target === "defect" || target === "defects" || target === "kosyak") {
    return String(env.BITRIX_DEFECT_STAGE_ID || "9");
  }

  const error = new Error("targetStage must be tz, tzApproval, launch, production or defect");
  error.status = 400;
  throw error;
}

async function uploadTechSpecToBitrix(env, body, cors) {
  requireEnv(env, "BITRIX_WEBHOOK_URL");

  const dealId = String(body.dealId || "").trim();
  const fileName = String(body.fileName || "").trim() || `tech-spec-${dealId}.jpg`;
  const fileBase64 = String(body.fileBase64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .trim();
  const fieldName = String(
    env.BITRIX_TECH_SPEC_FILE_FIELD ||
      env.BITRIX_FIELD_TECH_SPEC_FILE ||
      env.BITRIX_FIELD_PRODUCTION_FILES ||
      "UF_CRM_1780210628536",
  ).trim();

  if (!dealId) return json({ error: "dealId is required" }, 400, cors);
  if (!fileBase64) return json({ error: "fileBase64 is required" }, 400, cors);
  if (!fieldName) return json({ error: "Bitrix tech spec file field is not configured" }, 500, cors);

  try {
    const result = await callBitrixRest(env, "crm.deal.update", {
      id: dealId,
      fields: {
        [fieldName]: [
          {
            fileData: [fileName, fileBase64],
          },
        ],
      },
    });
    return json({ ok: true, field: fieldName, result }, 200, cors);
  } catch (firstError) {
    const result = await callBitrixRest(env, "crm.deal.update", {
      id: dealId,
      fields: {
        [fieldName]: {
          fileData: [fileName, fileBase64],
        },
      },
    });
    return json({ ok: true, field: fieldName, result, fallback: true, firstError: firstError.message }, 200, cors);
  }
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
      : originMatchesAllowed(origin, allowed)
        ? origin
        : allowed[0] || origin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function originMatchesAllowed(origin, allowed) {
  return allowed.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes("*")) return false;

    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(origin);
  });
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
