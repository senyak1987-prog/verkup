import type { CatalogItem, CostSection } from "../types";

export const sectionLabels: Record<CostSection, string> = {
  materials: "Материалы",
  lighting: "Светотехника",
  assembly: "Сборка",
  consumables: "Расходники вручную",
  subcontract: "Подряд",
  milling: "Фрезеровка",
  print: "Печать",
  plotter: "Плоттер",
  mounting: "Монтаж",
  defects: "Косяки",
  other: "Прочие",
};

export const catalogGroups = [
  { id: "materials", label: "Материалы", sections: ["materials"] },
  { id: "lighting", label: "Светотехника", sections: ["lighting", "consumables"] },
  { id: "milling", label: "Фрезеровка", sections: ["milling"] },
  { id: "print", label: "Пленки / печать", sections: ["print", "plotter"] },
  { id: "assembly", label: "Сборка / работа", sections: ["assembly", "mounting", "subcontract"] },
  { id: "other", label: "Прочие", sections: ["other"] },
  { id: "defects", label: "Косяки", sections: ["defects"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  sections: ReadonlyArray<CostSection>;
}>;

export function filterCatalogItems(items: CatalogItem[], query: string, limit: number) {
  const needle = query.trim().toLowerCase();

  return items
    .filter((item) => {
      if (!needle) return true;
      return [
        item.title,
        item.source,
        item.unit,
        item.materialGroup,
        item.materialFamily,
        item.materialSubgroup,
        item.materialGroupPath,
        sectionLabels[item.section],
      ]
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
    favorite: false,
  };
}

export function normalizeCatalogItem(item: CatalogItem) {
  const title = item.title.trim();
  if (!title) return undefined;

  const materialGroup = item.materialGroup?.trim() || "";
  const materialFamily = item.materialFamily?.trim() || "";
  const materialSubgroup = item.materialSubgroup?.trim() || "";
  const materialGroupPath =
    item.materialGroupPath?.trim() || [materialGroup, materialSubgroup].filter(Boolean).join(" / ");

  return {
    ...item,
    id: item.id || createCatalogId(item.section, title),
    title,
    unit: item.unit.trim() || "шт",
    unitCost: Number.isFinite(item.unitCost) ? item.unitCost : 0,
    source: item.source.trim() || "Ручной справочник",
    materialGroup: materialGroup || undefined,
    materialFamily: materialFamily || undefined,
    materialSubgroup: materialSubgroup || undefined,
    materialGroupPath: materialGroupPath || undefined,
    favorite: Boolean(item.favorite),
  };
}

export function upsertCatalogItem(items: CatalogItem[], item: CatalogItem) {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => (current.id === item.id ? item : current))
    : [...items, item];
}

export function materialGroupOptions(items: CatalogItem[]) {
  return [...new Set(items
    .filter((item) => item.section === "materials")
    .map((item) => item.materialGroup || "Без группы")
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export function materialFamilyOptions(items: CatalogItem[], materialGroup?: string) {
  return [...new Set(items
    .filter((item) => item.section === "materials")
    .filter((item) => !materialGroup || (item.materialGroup || "Без группы") === materialGroup)
    .map(materialFamilyValue)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export function materialFamilyValue(item: CatalogItem) {
  return item.materialFamily || item.materialSubgroup || "Без подгруппы";
}

export function materialGroupLabel(item: CatalogItem) {
  const family = item.materialFamily?.trim();
  const subgroup = item.materialSubgroup?.trim();
  const fullPath = item.materialGroupPath || [item.materialGroup, subgroup].filter(Boolean).join(" / ");

  if (!family) return fullPath;
  if (fullPath.toLowerCase().includes(family.toLowerCase())) return fullPath;

  return [item.materialGroup, family, subgroup].filter(Boolean).join(" / ");
}

export function toggleCatalogFavorite(items: CatalogItem[], itemId: string) {
  return items.map((item) =>
    item.id === itemId ? { ...item, favorite: !item.favorite } : item,
  );
}

function createCatalogId(section: CostSection, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return `${section}-${slug || "position"}-${crypto.randomUUID().slice(0, 8)}`;
}
