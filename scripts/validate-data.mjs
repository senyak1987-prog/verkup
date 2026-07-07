import fs from "node:fs/promises";
import path from "node:path";

const dealsPath = path.resolve("public/data/deals.json");
const data = JSON.parse(await fs.readFile(dealsPath, "utf8"));
const items = Array.isArray(data.items) ? data.items : [];
const strictResponsibleValidation = isTruthy(process.env.STRICT_RESPONSIBLE_VALIDATION);

const unresolved = items
  .filter((deal) => isNumericResponsible(responsibleName(deal)))
  .map((deal) => ({
    number: deal.number || deal.id || "-",
    responsible: responsibleName(deal),
    title: deal.title || "",
  }));

if (unresolved.length) {
  const log = strictResponsibleValidation ? console.error : console.warn;
  log(
    `${strictResponsibleValidation ? "Ошибка" : "Предупреждение"}: в deals.json остались Bitrix ID вместо ФИО ответственных: ${unresolved.length}`,
  );
  for (const deal of unresolved.slice(0, 20)) {
    log(`#${deal.number}: ${deal.responsible} ${deal.title}`);
  }
  if (unresolved.length > 20) {
    log(`...и еще ${unresolved.length - 20}`);
  }
  log("Проверьте доступ webhook к методу user.get. Сайт продолжит работать, но вместо ФИО может показать ID.");
  if (strictResponsibleValidation) {
    process.exit(1);
  }
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

if (unresolved.length) {
  console.log(`OK: данные проверены (${items.length}), ответственные с ID: ${unresolved.length}.`);
} else {
  console.log(`OK: ответственные расшифрованы во всех сделках (${items.length}).`);
}

function responsibleName(deal) {
  return String(deal.responsibleCard?.name || deal.responsible || "").trim();
}

function responsiblePhone(deal) {
  const phone = String(deal.responsibleCard?.phone || deal.responsiblePhone || "").trim();
  return isFullPhone(phone) ? phone : "";
}

function isNumericResponsible(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function isFullPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}
