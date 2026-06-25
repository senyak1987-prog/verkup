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

  const options = new Map<string, DealStageOption>();
  for (const stage of stages) {
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

function normalize(value: string) {
  return value.trim().toLowerCase();
}
