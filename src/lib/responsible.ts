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
  return [card?.phone, fallbackPhone].map(cleanPhoneText).find(isFullPhone) || "";
}

export function responsibleInternalPhoneFromCard(card?: ResponsibleCard | null, fallbackPhone?: string | null) {
  return [card?.internalPhone, card?.phone, fallbackPhone].map(cleanPhoneText).find(isInternalPhone) || "";
}

export function isFullPhone(value?: string | null) {
  const text = cleanPhoneText(value);
  if (!text) return false;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function isInternalPhone(value?: string | null) {
  const text = cleanPhoneText(value);
  if (!text) return false;
  const digits = text.replace(/\D/g, "");
  const plainDigits = text.replace(/[^\d]/g, "");
  return /^\d{2,6}$/.test(digits) && digits === plainDigits;
}

function cleanPhoneText(value?: string | null) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
