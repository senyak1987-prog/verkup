import type {
  CatalogItem,
  MaterialAlias,
  MaterialPriceHistory,
  MaterialStockItem,
  MaterialStockStatus,
  PriceUpdateProposal,
  StockIssue,
  StockReceipt,
  StockReceiptItem,
  StockTransaction,
  StoredWarehouse,
} from "../types";

export type ParsedInvoiceRow = {
  rawName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  vat?: number;
};

export type MaterialMatch = {
  materialId?: string;
  materialName?: string;
  unit?: string;
  confidence: number;
};

export function createEmptyStoredWarehouse(): StoredWarehouse {
  return {
    generatedAt: new Date().toISOString(),
    items: [],
    transactions: [],
    receipts: [],
    issues: [],
    documents: [],
    priceProposals: [],
    materialAliases: [],
    priceHistory: [],
  };
}

export function normalizeWarehouse(data?: Partial<StoredWarehouse>): StoredWarehouse {
  const fallback = createEmptyStoredWarehouse();
  return {
    generatedAt: data?.generatedAt || fallback.generatedAt,
    items: Array.isArray(data?.items) ? data.items.map(normalizeStockItem) : [],
    transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    receipts: Array.isArray(data?.receipts) ? data.receipts : [],
    issues: Array.isArray(data?.issues) ? data.issues : [],
    documents: Array.isArray(data?.documents) ? data.documents : [],
    priceProposals: Array.isArray(data?.priceProposals) ? data.priceProposals : [],
    materialAliases: Array.isArray(data?.materialAliases) ? data.materialAliases : [],
    priceHistory: Array.isArray(data?.priceHistory) ? data.priceHistory : [],
  };
}

export function warehouseRowsFromCatalog(
  catalogItems: CatalogItem[],
  warehouse: StoredWarehouse,
): MaterialStockItem[] {
  const stockById = new Map(warehouse.items.map((item) => [item.materialId, item]));
  const catalogRows = catalogItems.map((item) => {
    const stock = stockById.get(item.id);
    if (stock) {
      return normalizeStockItem({
        ...stock,
        materialName: stock.materialName || item.title,
        category: stock.category || item.section,
        unit: stock.unit || item.unit,
        lastPurchasePrice: stock.lastPurchasePrice || item.unitCost || 0,
      });
    }

    return normalizeStockItem({
      materialId: item.id,
      materialName: item.title,
      category: item.section,
      unit: item.unit,
      quantityOnHand: 0,
      reservedQuantity: 0,
      availableQuantity: 0,
      averagePrice: 0,
      lastPurchasePrice: item.unitCost || 0,
      minQuantity: 0,
      updatedAt: warehouse.generatedAt,
    });
  });

  const catalogIds = new Set(catalogItems.map((item) => item.id));
  const detachedStock = warehouse.items.filter((item) => !catalogIds.has(item.materialId)).map(normalizeStockItem);

  return [...catalogRows, ...detachedStock].sort((a, b) =>
    `${a.category || ""} ${a.materialName}`.localeCompare(`${b.category || ""} ${b.materialName}`, "ru"),
  );
}

export function stockStatus(item: MaterialStockItem): MaterialStockStatus {
  if (item.quantityOnHand <= 0) return "empty";
  if (item.minQuantity > 0 && item.availableQuantity <= item.minQuantity) return "low";
  return "ok";
}

export function matchMaterial(
  rawName: string,
  catalogItems: CatalogItem[],
  aliases: MaterialAlias[] = [],
  supplier?: string,
): MaterialMatch {
  const normalizedRaw = normalizeName(rawName);
  if (!normalizedRaw) return { confidence: 0 };

  const alias = aliases.find((item) => {
    const sameSupplier = !supplier || !item.supplier || item.supplier === supplier;
    return sameSupplier && normalizeName(item.rawName) === normalizedRaw;
  });
  if (alias) {
    const catalogItem = catalogItems.find((item) => item.id === alias.materialId);
    return {
      materialId: alias.materialId,
      materialName: alias.materialName,
      unit: catalogItem?.unit,
      confidence: 100,
    };
  }

  const rawTokens = tokens(normalizedRaw);
  let best: { item: CatalogItem; score: number } | undefined;

  for (const item of catalogItems) {
    const candidateName = normalizeName([item.title, item.materialGroup, item.materialFamily, item.source].filter(Boolean).join(" "));
    const candidateTokens = tokens(candidateName);
    if (!candidateTokens.length) continue;

    const overlap = rawTokens.filter((token) => candidateTokens.includes(token)).length;
    const containment =
      candidateName.includes(normalizedRaw) || normalizedRaw.includes(normalizeName(item.title))
        ? 35
        : 0;
    const score = Math.min(99, Math.round((overlap / Math.max(rawTokens.length, 1)) * 70 + containment));
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 35) return { confidence: best?.score || 0 };
  return {
    materialId: best.item.id,
    materialName: best.item.title,
    unit: best.item.unit,
    confidence: best.score,
  };
}

export function receiptItemsFromParsedRows(
  rows: ParsedInvoiceRow[],
  catalogItems: CatalogItem[],
  aliases: MaterialAlias[] = [],
  supplier?: string,
): StockReceiptItem[] {
  return rows.map((row) => {
    const match = matchMaterial(row.rawName, catalogItems, aliases, supplier);
    return {
      id: createId("receipt-item"),
      materialId: match.materialId,
      rawName: row.rawName,
      matchedMaterialName: match.materialName,
      quantity: cleanNumber(row.quantity),
      unit: row.unit || match.unit || "шт",
      unitPrice: cleanNumber(row.unitPrice),
      totalPrice: cleanNumber(row.totalPrice) || cleanNumber(row.quantity) * cleanNumber(row.unitPrice),
      vat: row.vat,
      confidence: match.confidence,
      status: match.materialId && match.confidence >= 75 ? "matched" : "needs_review",
    };
  });
}

export function postReceipt(
  warehouse: StoredWarehouse,
  receipt: StockReceipt,
  catalogItems: CatalogItem[],
  actor?: string,
): StoredWarehouse {
  const now = new Date().toISOString();
  const sourceReceipt = {
    ...receipt,
    status: "posted" as const,
    postedAt: receipt.postedAt || now,
    totalAmount: receipt.items.reduce((sum, item) => sum + cleanNumber(item.totalPrice), 0),
  };
  const existingReceipt = warehouse.receipts.find((item) => item.id === sourceReceipt.id);
  if (existingReceipt?.status === "posted") return warehouse;

  const nextItems = new Map(warehouse.items.map((item) => [item.materialId, normalizeStockItem(item)]));
  const nextTransactions: StockTransaction[] = [...warehouse.transactions];
  const nextProposals: PriceUpdateProposal[] = [...warehouse.priceProposals];

  for (const item of sourceReceipt.items) {
    if (!item.materialId) continue;
    const catalogItem = catalogItems.find((catalog) => catalog.id === item.materialId);
    const materialName = item.matchedMaterialName || catalogItem?.title || item.rawName;
    const quantity = cleanNumber(item.quantity);
    const unitPrice = cleanNumber(item.unitPrice);
    if (quantity <= 0) continue;

    const previous = nextItems.get(item.materialId);
    const previousQuantity = previous?.quantityOnHand || 0;
    const previousAverage = previous?.averagePrice || 0;
    const nextQuantity = previousQuantity + quantity;
    const nextAverage =
      nextQuantity > 0
        ? ((previousQuantity * previousAverage) + (quantity * unitPrice)) / nextQuantity
        : unitPrice;

    nextItems.set(
      item.materialId,
      normalizeStockItem({
        materialId: item.materialId,
        materialName,
        category: previous?.category || catalogItem?.section,
        unit: item.unit || previous?.unit || catalogItem?.unit || "шт",
        quantityOnHand: nextQuantity,
        reservedQuantity: previous?.reservedQuantity || 0,
        availableQuantity: nextQuantity - (previous?.reservedQuantity || 0),
        averagePrice: roundMoney(nextAverage),
        lastPurchasePrice: unitPrice,
        lastPurchaseDate: sourceReceipt.documentDate || sourceReceipt.date,
        minQuantity: previous?.minQuantity || 0,
        supplier: sourceReceipt.supplier || previous?.supplier,
        updatedAt: now,
      }),
    );

    nextTransactions.push({
      id: createId("stock-tx"),
      type: "receipt",
      materialId: item.materialId,
      materialName,
      quantity,
      unit: item.unit || catalogItem?.unit || "шт",
      unitPrice,
      totalPrice: roundMoney(quantity * unitPrice),
      documentId: sourceReceipt.sourceFileId,
      receiptId: sourceReceipt.id,
      supplier: sourceReceipt.supplier,
      createdAt: now,
      createdBy: actor,
    });

    const oldPrice = cleanNumber(catalogItem?.unitCost);
    if (catalogItem && unitPrice > 0 && Math.abs(oldPrice - unitPrice) >= 1) {
      const duplicate = nextProposals.some(
        (proposal) =>
          proposal.status === "pending" &&
          proposal.materialId === item.materialId &&
          proposal.newPrice === unitPrice,
      );
      if (!duplicate) {
        nextProposals.push({
          id: createId("price-proposal"),
          materialId: item.materialId,
          materialName,
          oldPrice,
          newPrice: unitPrice,
          differencePercent: oldPrice > 0 ? Math.round(((unitPrice - oldPrice) / oldPrice) * 1000) / 10 : 100,
          sourceReceiptId: sourceReceipt.id,
          sourceDocumentId: sourceReceipt.sourceFileId,
          status: "pending",
          createdAt: now,
        });
      }
    }
  }

  const receipts = [
    ...warehouse.receipts.filter((item) => item.id !== sourceReceipt.id),
    sourceReceipt,
  ];

  return normalizeWarehouse({
    ...warehouse,
    generatedAt: now,
    items: [...nextItems.values()],
    receipts,
    transactions: nextTransactions,
    priceProposals: nextProposals,
  });
}

export function createStockIssue(
  warehouse: StoredWarehouse,
  issue: StockIssue,
  actor?: string,
): StoredWarehouse {
  const now = new Date().toISOString();
  const nextItems = new Map(warehouse.items.map((item) => [item.materialId, normalizeStockItem(item)]));
  const transactions: StockTransaction[] = [...warehouse.transactions];

  for (const item of issue.items) {
    if (!item.materialId) continue;
    const previous = nextItems.get(item.materialId);
    if (!previous) continue;
    const quantity = cleanNumber(item.quantity);
    if (quantity <= 0) continue;
    const nextQuantity = Math.max(0, previous.quantityOnHand - quantity);
    nextItems.set(
      item.materialId,
      normalizeStockItem({
        ...previous,
        quantityOnHand: nextQuantity,
        availableQuantity: nextQuantity - previous.reservedQuantity,
        updatedAt: now,
      }),
    );
    transactions.push({
      id: createId("stock-tx"),
      type: "issue",
      materialId: item.materialId,
      materialName: item.matchedMaterialName || previous.materialName || item.rawName,
      quantity,
      unit: item.unit || previous.unit,
      unitPrice: item.unitPrice || previous.averagePrice || previous.lastPurchasePrice,
      totalPrice: roundMoney(quantity * (item.unitPrice || previous.averagePrice || previous.lastPurchasePrice)),
      dealId: issue.dealId,
      comment: issue.comment,
      createdAt: now,
      createdBy: actor,
    });
  }

  return normalizeWarehouse({
    ...warehouse,
    generatedAt: now,
    items: [...nextItems.values()],
    issues: [...warehouse.issues.filter((item) => item.id !== issue.id), issue],
    transactions,
  });
}

export function approvePriceProposal(
  warehouse: StoredWarehouse,
  catalogItems: CatalogItem[],
  proposalId: string,
  actor?: string,
) {
  const now = new Date().toISOString();
  const proposal = warehouse.priceProposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") {
    return { warehouse, catalogItems };
  }

  const nextCatalogItems = catalogItems.map((item) =>
    item.id === proposal.materialId ? { ...item, unitCost: proposal.newPrice } : item,
  );
  const history: MaterialPriceHistory = {
    id: createId("price-history"),
    materialId: proposal.materialId,
    oldPrice: proposal.oldPrice,
    newPrice: proposal.newPrice,
    source: "invoice",
    sourceDocumentId: proposal.sourceDocumentId,
    changedAt: now,
    changedBy: actor,
  };

  return {
    catalogItems: nextCatalogItems,
    warehouse: normalizeWarehouse({
      ...warehouse,
      generatedAt: now,
      priceProposals: warehouse.priceProposals.map((item) =>
        item.id === proposalId
          ? { ...item, status: "approved", decidedAt: now, decidedBy: actor }
          : item,
      ),
      priceHistory: [history, ...warehouse.priceHistory],
    }),
  };
}

export function rejectPriceProposal(
  warehouse: StoredWarehouse,
  proposalId: string,
  actor?: string,
): StoredWarehouse {
  const now = new Date().toISOString();
  return normalizeWarehouse({
    ...warehouse,
    generatedAt: now,
    priceProposals: warehouse.priceProposals.map((item) =>
      item.id === proposalId
        ? { ...item, status: "rejected", decidedAt: now, decidedBy: actor }
        : item,
    ),
  });
}

export function addMaterialAlias(
  warehouse: StoredWarehouse,
  alias: Omit<MaterialAlias, "id" | "createdAt">,
): StoredWarehouse {
  const normalizedRaw = normalizeName(alias.rawName);
  const exists = warehouse.materialAliases.some(
    (item) =>
      normalizeName(item.rawName) === normalizedRaw &&
      item.materialId === alias.materialId &&
      (!alias.supplier || item.supplier === alias.supplier),
  );
  if (exists) return warehouse;

  return normalizeWarehouse({
    ...warehouse,
    generatedAt: new Date().toISOString(),
    materialAliases: [
      {
        ...alias,
        id: createId("alias"),
        createdAt: new Date().toISOString(),
      },
      ...warehouse.materialAliases,
    ],
  });
}

export function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function cleanNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStockItem(item: Partial<MaterialStockItem>): MaterialStockItem {
  const quantityOnHand = cleanNumber(item.quantityOnHand);
  const reservedQuantity = cleanNumber(item.reservedQuantity);
  return {
    materialId: item.materialId || createId("material"),
    materialName: item.materialName || "Материал",
    category: item.category,
    unit: item.unit || "шт",
    quantityOnHand,
    reservedQuantity,
    availableQuantity: quantityOnHand - reservedQuantity,
    averagePrice: cleanNumber(item.averagePrice),
    lastPurchasePrice: cleanNumber(item.lastPurchasePrice),
    lastPurchaseDate: item.lastPurchaseDate,
    minQuantity: cleanNumber(item.minQuantity),
    supplier: item.supplier,
    updatedAt: item.updatedAt || new Date().toISOString(),
  };
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeName(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
