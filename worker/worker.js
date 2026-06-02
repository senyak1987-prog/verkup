const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
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

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, cors);
      }

      requireEnv(env, "GITHUB_TOKEN");
      requireEnv(env, "SAVE_API_KEY");
      requireSaveKey(request, env);

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
        const targetStageId = String(body.targetStageId || env.BITRIX_PRODUCTION_STAGE_ID || "10").trim();

        if (!dealId) {
          return json({ error: "dealId is required" }, 400, cors);
        }

        await dispatchMoveWorkflow(env, dealId, targetStageId);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: error.message || "Unexpected API error" }, status, cors);
    }
  },
};

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

function requireSaveKey(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerKey = request.headers.get("X-Verkup-Key") || "";
  const actual = bearer || headerKey;

  if (actual !== env.SAVE_API_KEY) {
    const error = new Error("Неверный ключ сохранения");
    error.status = 401;
    throw error;
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
      : allowed.includes(origin)
        ? origin
        : allowed[0] || origin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Verkup-Key",
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
