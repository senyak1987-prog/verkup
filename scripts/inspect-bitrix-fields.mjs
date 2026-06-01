const webhookUrl = required("BITRIX_WEBHOOK_URL").replace(/\/?$/, "/");

const fields = await callRest("crm.deal.fields", {});

const rows = Object.entries(fields.result || {}).map(([id, field]) => ({
  id,
  title: field.title || field.formLabel || field.listLabel || "",
  type: field.type || "",
}));

for (const row of rows) {
  console.log(`${row.id}\t${row.type}\t${row.title}`);
}

async function callRest(method, params) {
  const response = await fetch(`${webhookUrl}${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`${method} failed: ${response.status}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error_description || json.error);
  return json;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
