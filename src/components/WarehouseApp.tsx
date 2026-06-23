import {
  Brain,
  Check,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  PackageMinus,
  PackagePlus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as XLSX from "xlsx";
import { formatMoney } from "../lib/costing";
import {
  addMaterialAlias,
  approvePriceProposal,
  cleanNumber,
  createEmptyStoredWarehouse,
  createId,
  createStockIssue,
  ParsedInvoiceRow,
  postReceipt,
  receiptItemsFromParsedRows,
  rejectPriceProposal,
  stockStatus,
  warehouseRowsFromCatalog,
} from "../lib/warehouse";
import { saveCatalogs, saveWarehouse, uploadWarehouseDocument } from "../lib/saveApi";
import type {
  CatalogItem,
  Deal,
  MaterialStockItem,
  ProductionEmployee,
  StockDocument,
  StockReceipt,
  StockReceiptItem,
  StockIssue,
  StoredWarehouse,
} from "../types";

type WarehouseAppProps = {
  catalogItems: CatalogItem[];
  currentUser?: ProductionEmployee;
  deals: Deal[];
  saveApiUrl: string;
  storedWarehouse?: StoredWarehouse;
  onCatalogChange: (items: CatalogItem[]) => void;
  onChange: (data: StoredWarehouse, options?: { saveNow?: boolean }) => void;
};

type WarehouseTab = "stock" | "receipts" | "issues" | "documents" | "prices" | "settings";

type UploadState = "idle" | "uploading" | "parsed" | "manual" | "error";

const warehouseTabs: Array<{ id: WarehouseTab; label: string }> = [
  { id: "stock", label: "Остатки" },
  { id: "receipts", label: "Приход" },
  { id: "issues", label: "Расход" },
  { id: "documents", label: "Документы" },
  { id: "prices", label: "Изменение цен" },
  { id: "settings", label: "Настройки" },
];

export function WarehouseApp({
  catalogItems,
  currentUser,
  deals,
  saveApiUrl,
  storedWarehouse,
  onCatalogChange,
  onChange,
}: WarehouseAppProps) {
  const warehouse = storedWarehouse || createEmptyStoredWarehouse();
  const [activeTab, setActiveTab] = useState<WarehouseTab>("stock");
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptItems, setReceiptItems] = useState<StockReceiptItem[]>([]);
  const [linkedDocumentId, setLinkedDocumentId] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [issueMaterialId, setIssueMaterialId] = useState("");
  const [issueQuantity, setIssueQuantity] = useState("");
  const [issueDealId, setIssueDealId] = useState("");
  const [issueComment, setIssueComment] = useState("");

  const stockRows = useMemo(
    () => warehouseRowsFromCatalog(catalogItems, warehouse),
    [catalogItems, warehouse],
  );
  const filteredStockRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return stockRows;
    return stockRows.filter((item) =>
      [item.materialName, item.category, item.supplier]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, stockRows]);

  const stockSummary = useMemo(() => {
    const activeStock = warehouse.items;
    return {
      total: activeStock.length,
      low: activeStock.filter((item) => stockStatus(item) === "low").length,
      empty: activeStock.filter((item) => stockStatus(item) === "empty").length,
      amount: activeStock.reduce((sum, item) => sum + item.quantityOnHand * (item.averagePrice || item.lastPurchasePrice), 0),
    };
  }, [warehouse.items]);

  const pendingPriceProposals = warehouse.priceProposals.filter((proposal) => proposal.status === "pending");
  const canPostReceipt = receiptItems.some((item) => item.materialId && item.quantity > 0);

  function updateWarehouse(next: StoredWarehouse, options: { saveNow?: boolean } = { saveNow: true }) {
    onChange(next, options);
  }

  async function persistWarehouse(next: StoredWarehouse) {
    updateWarehouse(next, { saveNow: true });
    if (saveApiUrl) {
      await saveWarehouse({ apiUrl: saveApiUrl }, next).catch(() => undefined);
    }
  }

  async function handleInvoiceFile(file: File) {
    setUploadState("uploading");
    setUploadMessage("Загружаю документ и готовлю строки...");

    let document: StockDocument | undefined;
    try {
      if (saveApiUrl) {
        const response = await uploadWarehouseDocument(
          { apiUrl: saveApiUrl },
          {
            actor: currentUser?.name,
            file,
            type: documentTypeForFile(file),
          },
        );
        const nextData = response.data || warehouse;
        document = response.documents?.[0] as StockDocument | undefined;
        if (document) {
          setLinkedDocumentId(document.id);
        }
        updateWarehouse(nextData, { saveNow: false });
      }

      const parsedRows = await parseInvoiceFile(file);
      if (!parsedRows.length) {
        setUploadState("manual");
        setUploadMessage(
          fileLooksLikeSpreadsheet(file)
            ? "Не удалось уверенно найти строки. Проверьте файл и внесите приход вручную."
            : "Фото и сканы требуют OCR. Документ сохранен, строки нужно внести вручную.",
        );
        setActiveTab("receipts");
        return;
      }

      const items = receiptItemsFromParsedRows(
        parsedRows,
        catalogItems,
        warehouse.materialAliases,
        supplier,
      );
      setReceiptItems(items);
      setUploadState("parsed");
      setUploadMessage(`AI-помощник подготовил ${items.length} строк. Проверьте сопоставления перед проведением.`);
      setActiveTab("receipts");
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "Не удалось обработать накладную.");
    }
  }

  function addManualReceiptRow() {
    setReceiptItems((items) => [
      ...items,
      {
        id: createId("receipt-item"),
        rawName: "",
        quantity: 1,
        unit: "шт",
        unitPrice: 0,
        totalPrice: 0,
        confidence: 0,
        status: "needs_review",
      },
    ]);
    setActiveTab("receipts");
  }

  function patchReceiptItem(itemId: string, patch: Partial<StockReceiptItem>) {
    setReceiptItems((items) =>
      items.map((item) => {
        if (item.id !== itemId) return item;
        const next = { ...item, ...patch };
        const quantity = cleanNumber(next.quantity);
        const unitPrice = cleanNumber(next.unitPrice);
        return {
          ...next,
          quantity,
          unitPrice,
          totalPrice: cleanNumber(next.totalPrice) || quantity * unitPrice,
        };
      }),
    );
  }

  function selectReceiptMaterial(itemId: string, materialId: string) {
    const material = catalogItems.find((item) => item.id === materialId);
    patchReceiptItem(itemId, {
      materialId: material?.id,
      matchedMaterialName: material?.title,
      unit: material?.unit || "шт",
      confidence: material ? 100 : 0,
      status: material ? "matched" : "needs_review",
    });
  }

  async function handlePostReceipt() {
    if (!canPostReceipt) return;

    const now = new Date().toISOString();
    const receipt: StockReceipt = {
      id: createId("receipt"),
      date: documentDate || now.slice(0, 10),
      supplier: supplier.trim() || undefined,
      documentNumber: documentNumber.trim() || undefined,
      documentDate: documentDate || undefined,
      sourceFileId: linkedDocumentId || undefined,
      totalAmount: receiptItems.reduce((sum, item) => sum + cleanNumber(item.totalPrice), 0),
      status: "approved",
      items: receiptItems.map((item) => ({
        ...item,
        status: item.materialId ? "approved" : "needs_review",
      })),
      createdAt: now,
      createdBy: currentUser?.name,
    };

    const withAliases = receipt.items.reduce((data, item) => {
      if (!item.materialId || !item.matchedMaterialName || !item.rawName.trim()) return data;
      return addMaterialAlias(data, {
        rawName: item.rawName,
        materialId: item.materialId,
        materialName: item.matchedMaterialName,
        supplier: supplier.trim() || undefined,
        createdBy: currentUser?.name,
      });
    }, warehouse);
    const next = postReceipt(withAliases, receipt, catalogItems, currentUser?.name);
    await persistWarehouse(next);
    setReceiptItems([]);
    setSupplier("");
    setDocumentNumber("");
    setLinkedDocumentId("");
    setUploadState("idle");
    setUploadMessage("Приход проведен. Остатки обновлены.");
    setActiveTab("stock");
  }

  async function handleIssue() {
    const material = stockRows.find((item) => item.materialId === issueMaterialId);
    const quantity = cleanNumber(issueQuantity);
    if (!material || quantity <= 0) return;
    const now = new Date().toISOString();
    const issue: StockIssue = {
      id: createId("issue"),
      date: now.slice(0, 10),
      dealId: issueDealId || undefined,
      comment: issueComment.trim() || undefined,
      createdAt: now,
      createdBy: currentUser?.name,
      items: [
        {
          id: createId("issue-item"),
          materialId: material.materialId,
          rawName: material.materialName,
          matchedMaterialName: material.materialName,
          quantity,
          unit: material.unit,
          unitPrice: material.averagePrice || material.lastPurchasePrice,
          totalPrice: quantity * (material.averagePrice || material.lastPurchasePrice),
          confidence: 100,
          status: "approved",
        },
      ],
    };

    const next = createStockIssue(warehouse, issue, currentUser?.name);
    await persistWarehouse(next);
    setIssueMaterialId("");
    setIssueQuantity("");
    setIssueDealId("");
    setIssueComment("");
    setActiveTab("stock");
  }

  async function handleApprovePrice(proposalId: string) {
    const result = approvePriceProposal(warehouse, catalogItems, proposalId, currentUser?.name);
    onCatalogChange(result.catalogItems);
    updateWarehouse(result.warehouse, { saveNow: true });
    if (saveApiUrl) {
      await Promise.all([
        saveCatalogs({ apiUrl: saveApiUrl }, { generatedAt: new Date().toISOString(), items: result.catalogItems }).catch(() => undefined),
        saveWarehouse({ apiUrl: saveApiUrl }, result.warehouse).catch(() => undefined),
      ]);
    }
  }

  async function handleRejectPrice(proposalId: string) {
    const next = rejectPriceProposal(warehouse, proposalId, currentUser?.name);
    await persistWarehouse(next);
  }

  return (
    <main className="warehouse-app">
      <section className="warehouse-hero">
        <div>
          <span className="eyebrow">Склад материалов</span>
          <h1>Склад</h1>
          <p>Приходы, расходы, остатки и обновление цен справочника после проверки накладных.</p>
        </div>
        <div className="warehouse-actions">
          <label className="primary file-action">
            <Upload size={18} />
            Загрузить накладную
            <input
              accept="image/*,.pdf,.xlsx,.xls,.csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void handleInvoiceFile(file);
              }}
              type="file"
            />
          </label>
          <button className="secondary" onClick={addManualReceiptRow} type="button">
            <PackagePlus size={18} />
            Приход вручную
          </button>
        </div>
      </section>

      <section className="warehouse-summary">
        <SummaryCard label="Материалов на складе" value={String(stockSummary.total)} />
        <SummaryCard label="Сумма остатка" value={formatMoney(stockSummary.amount)} />
        <SummaryCard label="Мало" value={String(stockSummary.low)} tone={stockSummary.low ? "warning" : undefined} />
        <SummaryCard label="Закончились" value={String(stockSummary.empty)} tone={stockSummary.empty ? "danger" : undefined} />
      </section>

      <section className="warehouse-ai-panel">
        <Brain size={22} />
        <div>
          <strong>AI-помощник накладных</strong>
          <span>
            Excel/CSV разбираются автоматически, материалы сопоставляются со справочником и алиасами. Фото и скан-PDF сохраняются как документы и требуют ручной проверки или отдельного OCR.
          </span>
        </div>
        {uploadState !== "idle" ? (
          <span className={`warehouse-upload-status ${uploadState}`}>
            {uploadState === "uploading" ? "Обработка..." : uploadMessage}
          </span>
        ) : null}
      </section>

      <nav className="warehouse-tabs" aria-label="Разделы склада">
        {warehouseTabs.map((tab) => (
          <button
            className={activeTab === tab.id ? "active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
            {tab.id === "prices" && pendingPriceProposals.length ? <span>{pendingPriceProposals.length}</span> : null}
          </button>
        ))}
      </nav>

      {activeTab === "stock" && (
        <section className="warehouse-panel">
          <div className="warehouse-toolbar">
            <label className="search-field">
              <Search size={18} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по материалу, категории, поставщику"
                value={query}
              />
            </label>
          </div>
          <div className="warehouse-stock-list">
            {filteredStockRows.slice(0, 300).map((item) => (
              <StockRow item={item} key={item.materialId} />
            ))}
          </div>
        </section>
      )}

      {activeTab === "receipts" && (
        <section className="warehouse-panel">
          <div className="warehouse-form-grid">
            <label>
              Поставщик
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Например, Ремекс" />
            </label>
            <label>
              Номер накладной
              <input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="№ документа" />
            </label>
            <label>
              Дата накладной
              <input value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} type="date" />
            </label>
          </div>
          <ReceiptEditor
            catalogItems={catalogItems}
            items={receiptItems}
            onAdd={addManualReceiptRow}
            onPatch={patchReceiptItem}
            onRemove={(itemId) => setReceiptItems((items) => items.filter((item) => item.id !== itemId))}
            onSelectMaterial={selectReceiptMaterial}
          />
          <div className="warehouse-panel-actions">
            <button className="primary" disabled={!canPostReceipt} onClick={() => void handlePostReceipt()} type="button">
              <Check size={18} />
              Провести приход
            </button>
            <button className="secondary" onClick={() => setReceiptItems([])} type="button">
              <X size={18} />
              Очистить
            </button>
          </div>
          <HistoryList
            empty="Приходов пока нет."
            items={warehouse.receipts}
            render={(receipt) => (
              <div className="warehouse-history-row" key={receipt.id}>
                <strong>{receipt.documentNumber || "Приход"} · {receipt.supplier || "Поставщик не указан"}</strong>
                <span>{receipt.date} · {receipt.items.length} поз. · {formatMoney(receipt.totalAmount)}</span>
                <em>{statusLabel(receipt.status)}</em>
              </div>
            )}
          />
        </section>
      )}

      {activeTab === "issues" && (
        <section className="warehouse-panel">
          <div className="warehouse-form-grid">
            <label>
              Материал
              <select value={issueMaterialId} onChange={(event) => setIssueMaterialId(event.target.value)}>
                <option value="">Выберите материал</option>
                {stockRows.map((item) => (
                  <option key={item.materialId} value={item.materialId}>
                    {item.materialName} · доступно {item.availableQuantity} {item.unit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Количество
              <input value={issueQuantity} onChange={(event) => setIssueQuantity(event.target.value)} inputMode="decimal" placeholder="0" />
            </label>
            <label>
              Сделка
              <select value={issueDealId} onChange={(event) => setIssueDealId(event.target.value)}>
                <option value="">Без сделки</option>
                {deals.slice(0, 500).map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    #{deal.number} {deal.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="warehouse-wide-field">
            Комментарий
            <textarea value={issueComment} onChange={(event) => setIssueComment(event.target.value)} placeholder="Причина списания" />
          </label>
          <div className="warehouse-panel-actions">
            <button className="primary" disabled={!issueMaterialId || cleanNumber(issueQuantity) <= 0} onClick={() => void handleIssue()} type="button">
              <PackageMinus size={18} />
              Списать
            </button>
          </div>
          <HistoryList
            empty="Расходов пока нет."
            items={warehouse.issues}
            render={(issue) => (
              <div className="warehouse-history-row" key={issue.id}>
                <strong>{issue.dealId ? `Сделка ${dealLabel(issue.dealId, deals)}` : "Ручной расход"}</strong>
                <span>{issue.date} · {issue.items.length} поз.</span>
                <em>{issue.comment || "Без комментария"}</em>
              </div>
            )}
          />
        </section>
      )}

      {activeTab === "documents" && (
        <section className="warehouse-panel">
          <HistoryList
            empty="Документы склада пока не загружены."
            items={warehouse.documents}
            render={(document) => (
              <a className="warehouse-document-row" href={document.url} key={document.id} rel="noreferrer" target="_blank">
                {documentIcon(document.type)}
                <div>
                  <strong>{document.originalName}</strong>
                  <span>{new Date(document.uploadedAt).toLocaleString("ru-RU")} · {documentStatusLabel(document.processingStatus)}</span>
                </div>
              </a>
            )}
          />
        </section>
      )}

      {activeTab === "prices" && (
        <section className="warehouse-panel">
          {pendingPriceProposals.length ? (
            <div className="warehouse-price-list">
              {pendingPriceProposals.map((proposal) => (
                <div className="warehouse-price-row" key={proposal.id}>
                  <div>
                    <strong>{proposal.materialName}</strong>
                    <span>
                      Было {formatMoney(proposal.oldPrice)} · стало {formatMoney(proposal.newPrice)} · {proposal.differencePercent > 0 ? "+" : ""}{proposal.differencePercent}%
                    </span>
                  </div>
                  <div className="warehouse-row-actions">
                    <button className="primary compact" onClick={() => void handleApprovePrice(proposal.id)} type="button">
                      Обновить цену
                    </button>
                    <button className="secondary compact" onClick={() => void handleRejectPrice(proposal.id)} type="button">
                      Оставить старую
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="warehouse-empty">Предложений по изменению цен пока нет.</div>
          )}
        </section>
      )}

      {activeTab === "settings" && (
        <section className="warehouse-panel">
          <div className="warehouse-settings-grid">
            <div>
              <strong>Сопоставления материалов</strong>
              <span>{warehouse.materialAliases.length} правил. Они помогают AI-помощнику узнавать названия из накладных.</span>
            </div>
            <div>
              <strong>История цен</strong>
              <span>{warehouse.priceHistory.length} изменений. Новые цены применяются только после подтверждения.</span>
            </div>
            <div>
              <strong>Ограничение OCR</strong>
              <span>Для фото и скан-PDF нужен отдельный OCR-сервис. Сейчас они сохраняются как документы для ручной проверки.</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <article className={`warehouse-summary-card ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StockRow({ item }: { item: MaterialStockItem }) {
  const status = stockStatus(item);
  return (
    <article className="warehouse-stock-row">
      <div>
        <strong>{item.materialName}</strong>
        <span>{item.category || "Без категории"} · {item.unit}</span>
      </div>
      <div>
        <span>Остаток</span>
        <strong>{compactNumber(item.quantityOnHand)} {item.unit}</strong>
      </div>
      <div>
        <span>Доступно</span>
        <strong>{compactNumber(item.availableQuantity)} {item.unit}</strong>
      </div>
      <div>
        <span>Средняя</span>
        <strong>{formatMoney(item.averagePrice || item.lastPurchasePrice)}</strong>
      </div>
      <span className={`stock-status ${status}`}>{stockStatusLabel(status)}</span>
    </article>
  );
}

function ReceiptEditor({
  catalogItems,
  items,
  onAdd,
  onPatch,
  onRemove,
  onSelectMaterial,
}: {
  catalogItems: CatalogItem[];
  items: StockReceiptItem[];
  onAdd: () => void;
  onPatch: (itemId: string, patch: Partial<StockReceiptItem>) => void;
  onRemove: (itemId: string) => void;
  onSelectMaterial: (itemId: string, materialId: string) => void;
}) {
  return (
    <div className="warehouse-receipt-editor">
      <div className="warehouse-receipt-head">
        <strong>Строки прихода</strong>
        <button className="secondary compact" onClick={onAdd} type="button">
          <PackagePlus size={16} />
          Добавить строку
        </button>
      </div>
      {items.length ? (
        <div className="warehouse-receipt-rows">
          {items.map((item) => (
            <div className="warehouse-receipt-row" key={item.id}>
              <label>
                Наименование из накладной
                <input value={item.rawName} onChange={(event) => onPatch(item.id, { rawName: event.target.value })} />
              </label>
              <label>
                Материал в справочнике
                <select value={item.materialId || ""} onChange={(event) => onSelectMaterial(item.id, event.target.value)}>
                  <option value="">Нужно сопоставить</option>
                  {catalogItems.map((catalogItem) => (
                    <option key={catalogItem.id} value={catalogItem.id}>
                      {catalogItem.title} · {formatMoney(catalogItem.unitCost)} / {catalogItem.unit}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Кол-во
                <input value={String(item.quantity || "")} onChange={(event) => onPatch(item.id, { quantity: cleanNumber(event.target.value) })} inputMode="decimal" />
              </label>
              <label>
                Ед.
                <input value={item.unit} onChange={(event) => onPatch(item.id, { unit: event.target.value })} />
              </label>
              <label>
                Цена
                <input value={String(item.unitPrice || "")} onChange={(event) => onPatch(item.id, { unitPrice: cleanNumber(event.target.value), totalPrice: 0 })} inputMode="decimal" />
              </label>
              <span className={`warehouse-confidence ${item.confidence && item.confidence >= 75 ? "ok" : "warn"}`}>
                {item.confidence ? `${item.confidence}%` : "ручн."}
              </span>
              <button className="icon-button danger" onClick={() => onRemove(item.id)} type="button" aria-label="Удалить строку">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="warehouse-empty">Загрузите накладную или добавьте строки вручную.</div>
      )}
    </div>
  );
}

function HistoryList<T>({
  empty,
  items,
  render,
}: {
  empty: string;
  items: T[];
  render: (item: T) => ReactNode;
}) {
  if (!items.length) return <div className="warehouse-empty">{empty}</div>;
  return <div className="warehouse-history-list">{items.slice().reverse().slice(0, 50).map(render)}</div>;
}

async function parseInvoiceFile(file: File): Promise<ParsedInvoiceRow[]> {
  if (file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv")) {
    return parseTableRows(csvToRows(await file.text()));
  }
  if (fileLooksLikeSpreadsheet(file)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as unknown[][];
    return parseTableRows(rows);
  }
  return [];
}

function parseTableRows(rows: unknown[][]): ParsedInvoiceRow[] {
  const usefulRows = rows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));
  if (!usefulRows.length) return [];

  const headerIndex = usefulRows.findIndex((row) => row.some((cell) => /наимен|товар|материал|номенклат/i.test(cell)));
  const header = headerIndex >= 0 ? usefulRows[headerIndex] : [];
  const dataRows = usefulRows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  const columns = detectColumns(header);

  return dataRows
    .map((row) => {
      const rawName = row[columns.name] || row[0] || "";
      const quantity = cleanNumber(row[columns.quantity] || row[1]);
      const unit = row[columns.unit] || row[2] || "шт";
      const unitPrice = cleanNumber(row[columns.price] || row[3]);
      const totalPrice = cleanNumber(row[columns.total] || row[4]) || quantity * unitPrice;
      return { rawName, quantity, unit, unitPrice, totalPrice };
    })
    .filter((row) => row.rawName && row.quantity > 0 && (row.unitPrice > 0 || row.totalPrice > 0))
    .slice(0, 200);
}

function detectColumns(header: string[]) {
  const find = (patterns: RegExp[], fallback: number) => {
    const index = header.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
    return index >= 0 ? index : fallback;
  };
  return {
    name: find([/наимен/i, /товар/i, /материал/i, /номенклат/i], 0),
    quantity: find([/кол/i, /кол-во/i, /qty/i], 1),
    unit: find([/ед/i, /unit/i], 2),
    price: find([/цен/i, /price/i], 3),
    total: find([/сум/i, /итог/i, /total/i], 4),
  };
}

function csvToRows(text: string): string[][] {
  const delimiter = (text.match(/;/g)?.length || 0) >= (text.match(/,/g)?.length || 0) ? ";" : ",";
  return text
    .split(/\r?\n/)
    .map((line) => line.split(delimiter).map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

function documentTypeForFile(file: File) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "invoice_photo" as const;
  if (name.endsWith(".pdf") || file.type.includes("pdf")) return "invoice_pdf" as const;
  return "invoice_excel" as const;
}

function fileLooksLikeSpreadsheet(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv") || file.type.includes("spreadsheet");
}

function documentIcon(type: StockDocument["type"]) {
  if (type === "invoice_photo") return <ImageIcon size={22} />;
  if (type === "invoice_pdf") return <FileText size={22} />;
  return <FileSpreadsheet size={22} />;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    parsed: "Разобрано",
    needs_review: "Нужна проверка",
    approved: "Подтверждено",
    posted: "Проведено",
    canceled: "Отменено",
  };
  return labels[status] || status;
}

function documentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: "Загружено",
    parsing: "Обработка",
    parsed: "Разобрано",
    needs_review: "Нужна ручная проверка",
    error: "Ошибка",
  };
  return labels[status] || status;
}

function stockStatusLabel(status: string) {
  if (status === "empty") return "Закончился";
  if (status === "low") return "Мало";
  return "Достаточно";
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value || 0);
}

function dealLabel(dealId: string, deals: Deal[]) {
  const deal = deals.find((item) => item.id === dealId);
  return deal ? `#${deal.number} ${deal.title}` : dealId;
}
