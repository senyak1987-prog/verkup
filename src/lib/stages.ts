import type { Deal, DealStageCode } from "../types";

export const stageLabels: Record<DealStageCode, string> = {
  launch: "Сделки к запуску",
  production: "В производстве",
};

export function stageCodeForDeal(deal: Deal): DealStageCode {
  if (deal.stageCode) return deal.stageCode;
  return normalize(deal.stageName) === normalize("В производстве") ? "production" : "launch";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
