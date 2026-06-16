import fs from "node:fs/promises";
import path from "node:path";

const dealsPath = path.resolve("public/data/deals.json");
const data = JSON.parse(await fs.readFile(dealsPath, "utf8"));
const items = Array.isArray(data.items) ? data.items : [];

const unresolved = items
  .filter((deal) => isNumericResponsible(responsibleName(deal)))
  .map((deal) => ({
    number: deal.number || deal.id || "-",
    responsible: responsibleName(deal),
    title: deal.title || "",
  }));

if (unresolved.length) {
  console.error(`В deals.json остались Bitrix ID вместо ФИО ответственных: ${unresolved.length}`);
  for (const deal of unresolved.slice(0, 20)) {
    console.error(`#${deal.number}: ${deal.responsible} ${deal.title}`);
  }
  if (unresolved.length > 20) {
    console.error(`...и еще ${unresolved.length - 20}`);
  }
  console.error("Запустите npm run sync:bitrix и проверьте доступ webhook к методу user.get.");
  process.exit(1);
}

const missingPhones = items
  .filter((deal) => responsibleName(deal) && !responsiblePhone(deal))
  .map((deal) => ({
    number: deal.number || deal.id || "-",
    responsible: responsibleName(deal),
    title: deal.title || "",
  }));

if (missingPhones.length) {
  console.warn(`Предупреждение: у ответственных без телефона сделок: ${missingPhones.length}`);
  for (const deal of missingPhones.slice(0, 20)) {
    console.warn(`#${deal.number}: ${deal.responsible} ${deal.title}`);
  }
  if (missingPhones.length > 20) {
    console.warn(`...и еще ${missingPhones.length - 20}`);
  }
  console.warn("ТЗ можно подготовить, но телефон в него не подтянется, пока он не заполнен в карточке Bitrix.");
}

console.log(`OK: ответственные расшифрованы во всех сделках (${items.length}).`);

function responsibleName(deal) {
  return String(deal.responsibleCard?.name || deal.responsible || "").trim();
}

function responsiblePhone(deal) {
  return String(deal.responsibleCard?.phone || deal.responsiblePhone || "").trim();
}

function isNumericResponsible(value) {
  return /^\d+$/.test(String(value || "").trim());
}
