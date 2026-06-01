import type { AppData, CatalogItem, StoredCalculations } from "../types";

export type GitHubSettings = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
};

export async function saveCalculationsToGitHub(
  settings: GitHubSettings,
  data: StoredCalculations,
) {
  return saveJsonToGitHub(
    settings,
    "public/data/calculations.json",
    `Update Verkup calculations ${new Date().toISOString()}`,
    data,
  );
}

export async function saveCatalogsToGitHub(
  settings: GitHubSettings,
  data: AppData<CatalogItem>,
) {
  return saveJsonToGitHub(
    settings,
    "public/data/catalogs.json",
    `Update Verkup catalogs ${new Date().toISOString()}`,
    data,
  );
}

async function saveJsonToGitHub(
  settings: GitHubSettings,
  path: string,
  message: string,
  data: unknown,
) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
  const current = await fetch(`${url}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  const currentJson = current.ok ? await current.json() : undefined;

  const payload = {
    message,
    branch: settings.branch,
    content: toBase64Utf8(`${JSON.stringify(data, null, 2)}\n`),
    sha: currentJson?.sha,
  };

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(settings.token),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub save failed: ${response.status} ${text}`);
  }

  return response.json();
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function toBase64Utf8(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}
