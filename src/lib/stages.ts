import type { BitrixStage, Deal, DealStageCode } from "../types";

export const stageLabels: Record<DealStageCode, string> = {
  tz: "Подготовка ТЗ",
  tzApproval: "Согласование ТЗ",
  launch: "Сделки к запуску",
  production: "В производстве",
  defect: "Косяк",
};

export function stageCodeForDeal(deal: Deal): DealStageCode {
  if (deal.stageCode) return deal.stageCode;
  const stageName = normalize(deal.stageName);
  if (stageName.includes(normalize("Подготовка ТЗ"))) return "tz";
  if (stageName.includes(normalize("Согласование ТЗ"))) return "tzApproval";
  if (stageName.includes(normalize("В производстве"))) return "production";
  if (stageName.includes(normalize("Косяк"))) return "defect";
  return "launch";
}

export type DealStageOption = BitrixStage & {
  count: number;
};

export function stageIdForDeal(deal: Deal) {
  return (deal.stageId || deal.stageCode || stageCodeForDeal(deal) || "unknown").trim();
}

export function stageNameForDeal(deal: Deal) {
  return deal.stageName || stageLabels[stageCodeForDeal(deal)] || "Без стадии";
}

export function buildDealStageOptions(deals: Deal[], stages: BitrixStage[] = []): DealStageOption[] {
  const counts = new Map<string, number>();
  for (const deal of deals) {
    const id = stageIdForDeal(deal);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const relevantStages = selectRelevantDealStages(deals, stages);
  const options = new Map<string, DealStageOption>();
  for (const stage of relevantStages) {
    const id = String(stage.id || "").trim();
    if (!id) continue;
    options.set(id, {
      ...stage,
      id,
      name: stage.name || id,
      count: counts.get(id) || 0,
    });
  }

  for (const deal of deals) {
    const id = stageIdForDeal(deal);
    if (options.has(id)) continue;
    options.set(id, {
      id,
      name: stageNameForDeal(deal),
      code: deal.stageCode,
      count: counts.get(id) || 0,
    });
  }

  return [...options.values()].sort((first, second) => {
    const firstSort = Number.isFinite(first.sort) ? Number(first.sort) : 999999;
    const secondSort = Number.isFinite(second.sort) ? Number(second.sort) : 999999;
    if (firstSort !== secondSort) return firstSort - secondSort;
    return first.name.localeCompare(second.name, "ru");
  });
}

export function stageCodeFromStageId(stageId: string, stages: BitrixStage[] = []): DealStageCode | undefined {
  const stage = stages.find((item) => item.id === stageId);
  const code = stage?.code;
  return isDealStageCode(code) ? code : undefined;
}

function isDealStageCode(value?: string): value is DealStageCode {
  return value === "tz" || value === "tzApproval" || value === "launch" || value === "production" || value === "defect";
}

function selectRelevantDealStages(deals: Deal[], stages: BitrixStage[]) {
  const normalizedStages = stages.filter((stage) => String(stage.id || "").trim());
  if (normalizedStages.length <= 1) return normalizedStages;

  const groups = new Map<string, BitrixStage[]>();
  for (const stage of normalizedStages) {
    const key = bitrixStageGroupKey(stage);
    const group = groups.get(key) || [];
    group.push(stage);
    groups.set(key, group);
  }

  if (groups.size <= 1) return normalizedStages;

  const dealStageIds = new Set(deals.map(stageIdForDeal).filter(Boolean));
  const scoredGroups = [...groups.entries()].map(([key, group]) => ({
    key,
    group,
    isDefaultDealStage: group.some(isDefaultDealStage),
    matchCount: group.reduce((sum, stage) => sum + (dealStageIds.has(String(stage.id || "").trim()) ? 1 : 0), 0),
  }));

  scoredGroups.sort((first, second) => {
    if (first.matchCount !== second.matchCount) return second.matchCount - first.matchCount;
    if (first.isDefaultDealStage !== second.isDefaultDealStage) return first.isDefaultDealStage ? -1 : 1;
    return first.key.localeCompare(second.key);
  });

  return scoredGroups[0]?.group || normalizedStages;
}

function bitrixStageGroupKey(stage: BitrixStage) {
  const entityId = String(stage.entityId || "").trim();
  if (entityId) return entityId;
  return `category:${String(stage.categoryId || "").trim()}`;
}

function isDefaultDealStage(stage: BitrixStage) {
  const entityId = String(stage.entityId || "").trim();
  const categoryId = String(stage.categoryId || "").trim();
  return entityId === "DEAL_STAGE" || (!entityId && (categoryId === "" || categoryId === "0"));
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
