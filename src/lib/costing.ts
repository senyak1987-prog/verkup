import type { CostPosition, Deal, DealCalculation } from "../types";

const EXCLUDED_SECTIONS = new Set(["defects"]);
const MOUNTING_SECTION = "mounting";
const AUTO_CONSUMABLES_RATE = 0.07;

export function positionTotal(position: CostPosition) {
  const total = roundMoney(positionQuantity(position) * (Number(position.unitCost) || 0));
  const minCost = Number(position.minCost) || 0;
  return minCost ? Math.max(total, minCost) : total;
}

export function positionQuantity(position: CostPosition) {
  const qty = Number(position.qty) || 0;

  if (position.calcMode === "area") {
    const width = Number(position.width) || 0;
    const height = Number(position.height) || 0;
    const area = width * height;
    return roundMoney(area ? area : qty);
  }

  if (position.calcMode === "linear") {
    const length = Number(position.length) || 0;
    return roundMoney(length ? length * qty : qty);
  }

  return roundMoney(qty);
}

export function cleanCost(calculation?: DealCalculation) {
  return roundMoney(baseCleanCost(calculation) + autoConsumablesCost(calculation));
}

export function baseCleanCost(calculation?: DealCalculation) {
  if (!calculation) return 0;
  return roundMoney(
    calculation.positions
      .filter((position) => !EXCLUDED_SECTIONS.has(position.section))
      .reduce((sum, position) => sum + positionTotal(position), 0),
  );
}

export function autoConsumablesCost(calculation?: DealCalculation) {
  return roundMoney(baseCleanCost(calculation) * AUTO_CONSUMABLES_RATE);
}

export function manufacturingCost(calculation?: DealCalculation) {
  if (!calculation) return 0;
  const positionsCost = calculation.positions
    .filter(
      (position) =>
        !EXCLUDED_SECTIONS.has(position.section) && position.section !== MOUNTING_SECTION,
    )
    .reduce((sum, position) => sum + positionTotal(position), 0);
  return roundMoney(positionsCost + autoConsumablesCost(calculation));
}

export function mountingCost(calculation?: DealCalculation) {
  if (!calculation) return 0;
  return roundMoney(
    calculation.positions
      .filter((position) => position.section === MOUNTING_SECTION)
      .reduce((sum, position) => sum + positionTotal(position), 0),
  );
}

export function defectsCost(calculation?: DealCalculation) {
  if (!calculation) return 0;
  return roundMoney(
    calculation.positions
      .filter((position) => position.section === "defects")
      .reduce((sum, position) => sum + positionTotal(position), 0),
  );
}

export function finalCost(calculation?: DealCalculation) {
  return roundMoney(cleanCost(calculation) + defectsCost(calculation));
}

export function agentSaleFromCost(cost: number, ratio = 0.58) {
  if (!cost || !ratio) return 0;
  return roundMoney(cost / ratio);
}

export function isAgentDeal(deal: Deal) {
  return [deal.source, deal.type, deal.classification]
    .join(" ")
    .toLowerCase()
    .includes("агент");
}

export function saleBreakdownForDeal(
  deal: Deal,
  calculation?: DealCalculation,
  ratio = 0.58,
) {
  if (isAgentDeal(deal)) {
    const productionSale = agentSaleFromCost(manufacturingCost(calculation), ratio);
    const installSale = agentSaleFromCost(mountingCost(calculation), ratio);
    return {
      productionSale,
      installSale,
      totalSale: roundMoney(productionSale + installSale),
    };
  }

  const productionSale = Number(deal.saleAmount) || 0;
  const installSale = Number(deal.installSaleAmount) || 0;
  return {
    productionSale,
    installSale,
    totalSale: roundMoney(productionSale + installSale),
  };
}

export function saleAmountForDeal(deal: Deal, calculation?: DealCalculation, ratio = 0.58) {
  return saleBreakdownForDeal(deal, calculation, ratio).totalSale;
}

export function margin(deal: Deal, calculation?: DealCalculation, ratio = 0.58) {
  const sale = saleAmountForDeal(deal, calculation, ratio);
  const cost = finalCost(calculation);
  if (!sale) return 0;
  return roundMoney((sale - cost) / sale);
}

export function profit(deal: Deal, calculation?: DealCalculation, ratio = 0.58) {
  return roundMoney(saleAmountForDeal(deal, calculation, ratio) - finalCost(calculation));
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}
