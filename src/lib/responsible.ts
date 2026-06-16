import type { ResponsibleCard } from "../types";

const numericResponsiblePattern = /^\d+$/;

export function isUnresolvedResponsible(value?: string | null) {
  return numericResponsiblePattern.test(String(value || "").trim());
}

export function displayResponsible(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return isUnresolvedResponsible(text) ? `ID ${text} (не распознан)` : text;
}

export function responsibleForDraft(value?: string | null) {
  const text = String(value || "").trim();
  return isUnresolvedResponsible(text) ? "" : text;
}

export function responsibleNameFromCard(card?: ResponsibleCard | null, fallbackName?: string | null) {
  return displayResponsible(card?.name || fallbackName);
}

export function responsiblePhoneFromCard(card?: ResponsibleCard | null, fallbackPhone?: string | null) {
  return String(card?.phone || fallbackPhone || "").trim();
}
