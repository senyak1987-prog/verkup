import type { CatalogItem, CostSection } from "../types";

export const sectionLabels: Record<CostSection, string> = {
  materials: "Материалы",
  assembly: "Сборка",
  consumables: "Расходники",
  subcontract: "Подряд",
  milling: "Фрезеровка",
  print: "Печать",
  plotter: "Плоттер",
  mounting: "Монтаж",
  defects: "Косяки",
  other: "Разное",
};

export function filterCatalogItems(items: CatalogItem[], query: string, limit: number) {
  const needle = query.trim().toLowerCase();

  return items
    .filter((item) => {
      if (!needle) return true;
      return [item.title, item.source, item.unit, sectionLabels[item.section]]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .slice(0, limit);
}

export function createEmptyCatalogItem(): CatalogItem {
  return {
    id: "",
    section: "materials",
    title: "",
    unit: "шт",
    unitCost: 0,
    source: "Ручной справочник",
  };
}

export function normalizeCatalogItem(item: CatalogItem) {
  const title = item.title.trim();
  if (!title) return undefined;

  return {
    ...item,
    id: item.id || createCatalogId(item.section, title),
    title,
    unit: item.unit.trim() || "шт",
    unitCost: Number.isFinite(item.unitCost) ? item.unitCost : 0,
    source: item.source.trim() || "Ручной справочник",
  };
}

export function upsertCatalogItem(items: CatalogItem[], item: CatalogItem) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
}

function createCatalogId(section: CostSection, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `${section}-${slug || "position"}-${crypto.randomUUID().slice(0, 8)}`;
}
