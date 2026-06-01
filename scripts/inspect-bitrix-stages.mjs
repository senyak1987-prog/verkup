const webhookUrl = required("BITRIX_WEBHOOK_URL").replace(/\/?$/, "/");

await printStatuses("DEAL_STAGE");

try {
  const categories = await callRest("crm.dealcategory.list", {});
  for (const category of categories.result || []) {
    console.log(`\nCATEGORY ${category.ID}: ${category.NAME}`);
    await printStatuses(`DEAL_STAGE_${category.ID}`);
    try {
      const stages = await callRest("crm.dealcategory.stage.list", { id: category.ID });
      for (const stage of stages.result || []) {
        console.log(`${stage.STATUS_ID || stage.ID}\t${stage.NAME || stage.TITLE || ""}`);
      }
    } catch {
      // Optional method.
    }
  }
} catch {
  // Optional method.
}

async function printStatuses(entityId) {
  try {
    const response = await callRest("crm.status.list", { filter: { ENTITY_ID: entityId } });
    console.log(`\n${entityId}`);
    for (const item of response.result || []) {
      console.log(`${item.STATUS_ID}\t${item.NAME}`);
    }
  } catch (error) {
    console.log(`\n${entityId}\t${error.message}`);
  }
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
