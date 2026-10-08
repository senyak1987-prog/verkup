import { useEffect, useRef, useState } from "react";

export const LETTER_CENTIMETRE_PRICE = 120;
export const LOGO_CENTIMETRE_PRICE = 180;
export function calculateLogoPrice(heightMm: number, enabled = true) {
  const heightCm = enabled && Number.isFinite(heightMm) ? Math.max(0, heightMm) / 10 : 0;
  return { heightCm, total: roundMoney(heightCm * LOGO_CENTIMETRE_PRICE) };
}
export const SIGN_CART_STORAGE_KEY = "verkup-sign-cart-v1";
export const SIGN_CART_MAX_ITEMS = 20;
export const SIGN_CART_MAX_QUANTITY = 99;
const MAX_CART_LENGTH = 3_800_000;
const MAX_PROJECT_LENGTH = 3_000_000;
const MAX_THUMBNAIL_LENGTH = 120_000;

export type LetterPrice = {
  letterCount: number;
  heightCm: number;
  /** Price of one letter at the selected height. */
  unitPrice: number;
  total: number;
};

/** Spaces and punctuation do not count as priced letters. */
export function calculateLetterPrice(text: string, heightMm: number): LetterPrice {
  const letterCount = typeof text === "string"
    ? Array.from(text.normalize("NFC").matchAll(/[\p{L}\p{N}]/gu)).length
    : 0;
  const heightCm = Number.isFinite(heightMm) ? Math.max(0, heightMm) / 10 : 0;
  const unitPrice = roundMoney(heightCm * LETTER_CENTIMETRE_PRICE);
  return { letterCount, heightCm, unitPrice, total: roundMoney(unitPrice * letterCount) };
}

export function hasUnpricedSymbols(text: string) {
  return /[^\p{L}\p{N}\s]/u.test(text.normalize("NFC"));
}

export function requiresFrameApproval(heightMm: number) {
  return Number.isFinite(heightMm) && heightMm > 550;
}

export type CartItem<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  project: T;
  label: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  /** Known price per sign; null means the entire sign needs a quote. */
  price: number | null;
  requiresApproval: boolean;
  approvalNote?: string;
  quantity: number;
  thumbnailSvg?: string;
};

export type CartItemInput<T extends Record<string, unknown> = Record<string, unknown>> =
  Omit<CartItem<T>, "id" | "quantity"> & { quantity?: number };

export function snapshotProject<T extends Record<string, unknown>>(project: T): T {
  if (!isRecord(project)) throw new Error("Не удалось сохранить настройки макета.");
  assertSerializable(project);
  const serialized = JSON.stringify(project);
  if (serialized.length > MAX_PROJECT_LENGTH) {
    throw new Error("Макет слишком большой для корзины. Уменьшите загруженные изображения.");
  }
  return JSON.parse(serialized) as T;
}

/** Validate a local envelope before allowing it back into the UI. */
export function validateStoredCart<T extends Record<string, unknown> = Record<string, unknown>>(
  raw: unknown,
): CartItem<T>[] {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length > SIGN_CART_MAX_ITEMS) {
    throw new Error("Сохраненную корзину не удалось прочитать. Добавьте макеты снова.");
  }
  const ids = new Set<string>();
  const items = raw.items.map((item: unknown) => {
    const validated = validateCartItem<T>(item);
    if (ids.has(validated.id)) throw new Error("В сохраненной корзине есть повторяющиеся позиции.");
    ids.add(validated.id);
    return validated;
  });
  serializeCart(items);
  return items;
}

type CartState<T extends Record<string, unknown>> = { items: CartItem<T>[]; error: string };

export function useSignCart<T extends Record<string, unknown> = Record<string, unknown>>() {
  const [state, setState] = useState<CartState<T>>(() => loadCart<T>());
  const itemsRef = useRef(state.items);

  useEffect(() => {
    try {
      localStorage.setItem(SIGN_CART_STORAGE_KEY, serializeCart(state.items));
    } catch {
      setState(current => ({
        ...current,
        error: "Не удалось сохранить корзину на устройстве. Она доступна в этой вкладке; уменьшите изображения или освободите место в браузере.",
      }));
    }
  }, [state.items]);

  function commit(items: CartItem<T>[]) {
    try {
      serializeCart(items);
      itemsRef.current = items;
      setState({ items, error: "" });
      return true;
    } catch (error) {
      setState(current => ({ ...current, error: errorMessage(error) }));
      return false;
    }
  }

  function addItem(input: CartItemInput<T>) {
    if (itemsRef.current.length >= SIGN_CART_MAX_ITEMS) {
      setState(current => ({ ...current, error: "В корзине уже 20 макетов. Удалите ненужную позицию перед добавлением новой." }));
      return false;
    }
    try {
      const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `sign-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const item = validateCartItem<T>({ ...input, id, quantity: input.quantity ?? 1 });
      return commit([...itemsRef.current, item]);
    } catch (error) {
      setState(current => ({ ...current, error: errorMessage(error) }));
      return false;
    }
  }

  function updateQuantity(id: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    const nextQuantity = Math.max(1, Math.min(SIGN_CART_MAX_QUANTITY, Math.round(quantity)));
    commit(itemsRef.current.map(item => item.id === id ? { ...item, quantity: nextQuantity } : item));
  }

  function removeItem(id: string) {
    commit(itemsRef.current.filter(item => item.id !== id));
  }

  return {
    items: state.items,
    addItem,
    updateQuantity,
    removeItem,
    clear: () => commit([]),
    error: state.error,
    dismissError: () => setState(current => ({ ...current, error: "" })),
  };
}

function validateCartItem<T extends Record<string, unknown>>(raw: unknown): CartItem<T> {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 100 ||
    typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > 160 ||
    !validNumber(raw.widthMm, 1, 100_000) || !validNumber(raw.heightMm, 1, 10_000) ||
    !validNumber(raw.depthMm, 0, 1000) ||
    !(raw.price === null || validNumber(raw.price, 0, 1_000_000_000)) ||
    typeof raw.requiresApproval !== "boolean" ||
    !validNumber(raw.quantity, 1, SIGN_CART_MAX_QUANTITY) || !Number.isInteger(raw.quantity) ||
    (raw.approvalNote !== undefined && typeof raw.approvalNote !== "string") ||
    !isRecord(raw.project)) {
    throw new Error("Параметры позиции корзины некорректны. Добавьте макет снова.");
  }
  const thumbnailSvg = typeof raw.thumbnailSvg === "string" && raw.thumbnailSvg.length <= MAX_THUMBNAIL_LENGTH &&
    /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(raw.thumbnailSvg) &&
    !/<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:)/i.test(raw.thumbnailSvg)
    ? raw.thumbnailSvg : undefined;
  return {
    id: raw.id,
    label: raw.label.trim(),
    project: snapshotProject(raw.project as T),
    widthMm: raw.widthMm as number,
    heightMm: raw.heightMm as number,
    depthMm: raw.depthMm as number,
    price: raw.price === null ? null : roundMoney(raw.price as number),
    requiresApproval: raw.requiresApproval || raw.price === null,
    approvalNote: typeof raw.approvalNote === "string" ? raw.approvalNote.slice(0, 500) : undefined,
    quantity: raw.quantity as number,
    thumbnailSvg,
  };
}

function loadCart<T extends Record<string, unknown>>(): CartState<T> {
  try {
    const saved = localStorage.getItem(SIGN_CART_STORAGE_KEY);
    if (!saved) return { items: [], error: "" };
    if (saved.length > MAX_CART_LENGTH) throw new Error("Сохраненная корзина слишком большая. Добавьте макеты снова с меньшими изображениями.");
    return { items: validateStoredCart<T>(JSON.parse(saved)), error: "" };
  } catch (error) {
    return { items: [], error: errorMessage(error, "Сохраненная корзина недоступна. Новые макеты можно добавить в этой вкладке.") };
  }
}

function serializeCart<T extends Record<string, unknown>>(items: CartItem<T>[]) {
  const serialized = JSON.stringify({ version: 1, items });
  if (serialized.length > MAX_CART_LENGTH) {
    throw new Error("В корзине слишком много изображений. Удалите ненужный макет или уменьшите его изображение.");
  }
  return serialized;
}

function assertSerializable(value: unknown, depth = 0) {
  if (depth > 10) throw new Error("Настройки макета имеют неподдерживаемую структуру.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= MAX_PROJECT_LENGTH) return;
  if (Array.isArray(value) && value.length <= 200) {
    value.forEach(item => assertSerializable(item, depth + 1));
    return;
  }
  if (isRecord(value) && Object.keys(value).length <= 200) {
    for (const [key, nested] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Настройки макета имеют неподдерживаемые поля.");
      assertSerializable(nested, depth + 1);
    }
    return;
  }
  throw new Error("Не удалось сохранить настройки макета. Проверьте его параметры.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function errorMessage(error: unknown, fallback = "Не удалось добавить макет в корзину. Попробуйте снова.") {
  if (error instanceof SyntaxError || (typeof DOMException !== "undefined" && error instanceof DOMException)) return fallback;
  return error instanceof Error ? error.message : fallback;
}
