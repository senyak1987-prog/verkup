import type {
  Deal,
  DealTechSpec,
  Installation,
  InstallationStatus,
  ProductionAssignment,
  ProductionEmployee,
} from "../types";
import { accessRoleFor } from "./access";

export const installationStatusLabels: Record<InstallationStatus, string> = {
  not_scheduled: "Не запланирован",
  scheduled: "Запланирован",
  assigned: "Назначен",
  in_progress: "В работе",
  arrived: "На месте",
  review_pending: "На проверке",
  completed: "Проверен",
  needs_revision: "Доработка",
  canceled: "Отменен",
  no_installation: "Без монтажа",
};

export const installationStatusOrder: InstallationStatus[] = [
  "not_scheduled",
  "scheduled",
  "assigned",
  "in_progress",
  "arrived",
  "review_pending",
  "needs_revision",
  "completed",
  "canceled",
  "no_installation",
];

export function isInstaller(employee: ProductionEmployee) {
  return accessRoleFor(employee) === "maker" && employee.role === "assembler" && employee.active !== false;
}

export function isDealMountingType(deal: Deal) {
  const text = [deal.type, deal.classification, deal.stageName].join(" ").toLowerCase();
  return text.includes("монтаж") || (Number(deal.installSaleAmount) || 0) > 0;
}

export function currentProductionAssignmentsForDeal(
  assignments: ProductionAssignment[],
  dealId: string,
  spec?: DealTechSpec,
) {
  const byPart = latestAssignmentByPart(assignments);
  const partAssignments =
    spec && spec.draft.items.length > 1
      ? spec.draft.items
          .map((item) => byPart.get(assignmentPartKey(dealId, item.id)))
          .filter((assignment): assignment is ProductionAssignment => Boolean(assignment))
      : [];

  if (partAssignments.length) return partAssignments;

  const dealAssignment = byPart.get(assignmentPartKey(dealId));
  if (dealAssignment) return [dealAssignment];

  const fallback = [...assignments]
    .filter((assignment) => assignment.dealId === dealId)
    .sort((first, second) => Date.parse(second.assignedAt) - Date.parse(first.assignedAt))[0];
  return fallback ? [fallback] : [];
}

export function isDealReadyForInstallation(
  deal: Deal,
  assignments: ProductionAssignment[],
  spec?: DealTechSpec,
) {
  const currentAssignments = currentProductionAssignmentsForDeal(assignments, deal.id, spec);
  return currentAssignments.length > 0 && currentAssignments.every((assignment) => assignment.status === "readyForShipment");
}

export function installationForDeal(installations: Installation[], dealId: string) {
  return [...installations]
    .filter((installation) => installation.dealId === dealId)
    .sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))[0];
}

export function installationDateKey(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayDateKey() {
  return installationDateKey(new Date().toISOString());
}

export function formatInstallationDate(value?: string) {
  if (!value) return "Без даты";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatInstallationTime(timeFrom?: string, timeTo?: string) {
  const from = (timeFrom || "").trim();
  const to = (timeTo || "").trim();
  if (from && to) return `${from}-${to}`;
  return from || to || "Время не указано";
}

function latestAssignmentByPart(assignments: ProductionAssignment[]) {
  const map = new Map<string, ProductionAssignment>();
  for (const assignment of assignments) {
    const key = assignmentPartKey(assignment.dealId, assignment.techSpecItemId);
    const current = map.get(key);
    if (!current || Date.parse(assignment.assignedAt) >= Date.parse(current.assignedAt)) {
      map.set(key, assignment);
    }
  }
  return map;
}

function assignmentPartKey(dealId: string, techSpecItemId?: string) {
  return `${dealId}::${techSpecItemId || "deal"}`;
}
