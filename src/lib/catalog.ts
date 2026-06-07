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

const lightingLegacyMaterialGroups = ["Светодиоды и аксессуары"] as const;

export type CatalogGroup = {
  id: string;
  label: string;
  sections: ReadonlyArray<CostSection>;
  materialGroups?: ReadonlyArray<string>;
  excludeMaterialGroups?: ReadonlyArray<string>;
};

export const catalogGroups: ReadonlyArray<CatalogGroup> = [
  {
    id: "materials",
    label: "Материалы",
    sections: ["materials"],
    excludeMaterialGroups: lightingLegacyMaterialGroups,
  },
  {
    id: "lighting",
    label: "Светотехника",
    sections: ["lighting", "consumables", "materials"],
    materialGroups: lightingLegacyMaterialGroups,
  },
  { id: "milling", label: "Фрезеровка", sections: ["milling"] },
  { id: "print", label: "Печать / Плоттер", sections: ["print", "plotter"] },
  { id: "other", label: "Прочие", sections: ["other", "assembly", "mounting", "subcontract", "defects"] },
];

export function filterCatalogItems(items: CatalogItem[], query: string, limit: number) {
  return smartCatalogSearch(items, query).slice(0, limit);
}

export function catalogItemInGroup(item: CatalogItem, group: CatalogGroup) {
  if (!group.sections.some((section) => section === item.section)) return false;

  const materialGroup = item.materialGroup || "Без группы";
  if (item.section === "materials") {
    if (group.materialGroups?.length) {
      return group.materialGroups.some((groupName) => groupName === materialGroup);
    }

    if (group.excludeMaterialGroups?.length) {
      return !group.excludeMaterialGroups.some((groupName) => groupName === materialGroup);
    }
  }

  return true;
}

export function catalogPrimarySubgroupValue(item: CatalogItem) {
  if (item.section === "materials") return item.materialGroup || "Без группы";
  return sectionLabels[item.section] || "Без раздела";
}

export function catalogSecondarySubgroupValue(item: CatalogItem) {
  if (item.section === "materials") return materialFamilyValue(item);

  const sourceParts = item.source
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  return sourceParts[1] || item.materialSubgroup || "Без подгруппы";
}

export function smartCatalogSearch(items: CatalogItem[], query: string) {
  const tokens = searchTokens(query);
  if (!tokens.length) return items;

  return items
    .map((item) => ({
      item,
      score: catalogSearchScore(item, tokens),
    }))
    .filter((match) => match.score > 0)
    .sort((first, second) => second.score - first.score || first.item.title.localeCompare(second.item.title, "ru"))
    .map((match) => match.item);
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
    productCode: item.productCode?.trim() || undefined,
    productUrl: item.productUrl?.trim() || undefined,
    imageUrl: item.imageUrl?.trim() || undefined,
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

function catalogSearchScore(item: CatalogItem, tokens: string[]) {
  const title = normalizeSearchText(item.title);
  const titleWords = title.split(" ").filter(Boolean);
  const haystack = normalizeSearchText(
    [
      item.title,
      item.source,
      item.unit,
      item.materialGroup,
      item.materialFamily,
      item.materialSubgroup,
      item.materialGroupPath,
      item.productCode,
      item.productUrl,
      sectionLabels[item.section],
    ].join(" "),
  );

  return tokens.reduce((score, token) => {
    if (haystack.includes(token)) {
      const startsTitle = titleWords[0]?.startsWith(token);
      const exactTitleWord = titleWords.some((word) => word === token);
      return (
        score +
        (title.includes(token) ? 90 : 55) +
        (startsTitle ? 75 : 0) +
        (exactTitleWord ? 25 : 0) +
        Math.max(0, 18 - token.length)
      );
    }

    const closeWordScore = haystack
      .split(" ")
      .reduce((best, word) => Math.max(best, fuzzyTokenScore(word, token)), 0);

    return closeWordScore ? score + closeWordScore : -1000;
  }, 0);
}

function fuzzyTokenScore(word: string, token: string) {
  if (token.length < 2 || word.length < 2) return 0;
  if (word.startsWith(token.slice(0, Math.min(3, token.length)))) return 44;

  let tokenIndex = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  for (let wordIndex = 0; wordIndex < word.length && tokenIndex < token.length; wordIndex += 1) {
    if (word[wordIndex] !== token[tokenIndex]) continue;
    if (lastMatchIndex >= 0) gaps += wordIndex - lastMatchIndex - 1;
    lastMatchIndex = wordIndex;
    tokenIndex += 1;
  }

  if (tokenIndex !== token.length) return 0;

  return Math.max(12, 42 - gaps - Math.max(0, word.length - token.length));
}

function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[×х]/g, "x")
    .replace(/м²/g, "м2")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
