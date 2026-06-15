import type { Deal, DealStageCode } from "../types";

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

function normalize(value: string) {
  return value.trim().toLowerCase();
}
