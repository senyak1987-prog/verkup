import type { ResponsibleCard } from "../types";

const numericResponsiblePattern = /^\d+$/;

const knownResponsibleCardsByName: Record<string, Partial<ResponsibleCard>> = {
  "алексей федоренко": {
    name: "Алексей Федоренко",
    position: "Менеджер по продажам",
    phone: "89995543801",
    internalPhone: "709",
    email: "af@verkup.ru",
    supervisor: "Никита Беспалов",
    lastSeenText: "Был в сети 16 июня в 17:58",
  },
  "антон исаков": {
    name: "Антон Исаков",
    position: "Менеджер по продажам",
    phone: "+7 926 838-15-46",
    email: "ai@verkup.ru",
    supervisor: "Никита Беспалов",
    lastSeenText: "Был в сети 16 июня в 19:40",
  },
};

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

export function hydrateResponsibleCard(card?: ResponsibleCard | null, fallbackName?: string | null): ResponsibleCard | undefined {
  const key = normalizeResponsibleKey(card?.name || fallbackName);
  const knownCard = key ? knownResponsibleCardsByName[key] : undefined;
  if (!card && !knownCard && !fallbackName) return undefined;
  const cardPhone = cleanPhoneText(card?.phone);
  const knownPhone = cleanPhoneText(knownCard?.phone);
  const cardInternalPhone = cleanPhoneText(card?.internalPhone);
  const knownInternalPhone = cleanPhoneText(knownCard?.internalPhone);

  return {
    id: card?.id || "",
    name: card?.name || knownCard?.name || String(fallbackName || "").trim(),
    avatarUrl: card?.avatarUrl || knownCard?.avatarUrl || "",
    position: card?.position || knownCard?.position || "",
    phone: (isFullPhone(cardPhone) ? cardPhone : "") || knownPhone || "",
    internalPhone: cardInternalPhone || (isInternalPhone(cardPhone) ? cardPhone : "") || knownInternalPhone || "",
    email: card?.email || knownCard?.email || "",
    supervisor: card?.supervisor || knownCard?.supervisor || "",
    department: card?.department || knownCard?.department || "",
    bitrixUrl: card?.bitrixUrl || knownCard?.bitrixUrl || "",
    chatUrl: card?.chatUrl || knownCard?.chatUrl || "",
    videoUrl: card?.videoUrl || knownCard?.videoUrl || "",
    lastSeenAt: card?.lastSeenAt || knownCard?.lastSeenAt || "",
    lastSeenText: card?.lastSeenText || knownCard?.lastSeenText || "",
  };
}

export function responsiblePhoneFromCard(card?: ResponsibleCard | null, fallbackPhone?: string | null) {
  return [card?.phone, fallbackPhone].map(cleanPhoneText).find(isFullPhone) || "";
}

export function responsibleInternalPhoneFromCard(card?: ResponsibleCard | null, fallbackPhone?: string | null) {
  return [card?.internalPhone, card?.phone, fallbackPhone].map(cleanPhoneText).find(isInternalPhone) || "";
}

export function responsiblePhoneForTechSpec(card?: ResponsibleCard | null, fallbackPhone?: string | null) {
  const phone = responsiblePhoneFromCard(card, fallbackPhone);
  if (phone) return phone;

  const internalPhone = responsibleInternalPhoneFromCard(card, fallbackPhone);
  return internalPhone ? `вн. ${internalPhone}` : "";
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

function normalizeResponsibleKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU");
}
