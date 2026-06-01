import { ExternalLink, Pencil, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Deal, DealCalculation } from "../types";
import {
  cleanCost,
  finalCost,
  formatMoney,
  formatPercent,
  margin,
  profit,
  saleBreakdownForDeal,
  saleAmountForDeal,
} from "../lib/costing";

const COLUMN_STORAGE_KEY = "verkupDealColumnWidths";

const tableColumns = [
  { id: "deal", label: "Сделка", defaultWidth: 280, minWidth: 180 },
  { id: "source", label: "Источник", defaultWidth: 110, minWidth: 90 },
  { id: "type", label: "Тип", defaultWidth: 240, minWidth: 130 },
  { id: "responsible", label: "Ответственный", defaultWidth: 160, minWidth: 110 },
  { id: "dates", label: "Даты", defaultWidth: 120, minWidth: 100 },
  { id: "sales", label: "Продажа / монтаж", defaultWidth: 230, minWidth: 150 },
  { id: "cost", label: "Себестоимость", defaultWidth: 190, minWidth: 150 },
  { id: "profit", label: "Прибыль", defaultWidth: 110, minWidth: 90 },
  { id: "actions", label: "", defaultWidth: 80, minWidth: 72 },
] as const;

type ColumnId = (typeof tableColumns)[number]["id"];
type ColumnWidths = Record<ColumnId, number>;

type DealTableProps = {
  deals: Deal[];
  calculations: Map<string, DealCalculation>;
  agentRatio: number;
  selectedDealId?: string;
  onSelect: (deal: Deal) => void;
  query: string;
  onQueryChange: (value: string) => void;
};

export function DealTable({
  deals,
  calculations,
  agentRatio,
  selectedDealId,
  onSelect,
  query,
  onQueryChange,
}: DealTableProps) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => loadColumnWidths());

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const tableWidth = useMemo(
    () => tableColumns.reduce((sum, column) => sum + columnWidths[column.id], 0),
    [columnWidths],
  );

  const totals = deals.reduce(
    (acc, deal) => {
      const calculation = calculations.get(deal.id);
      acc.sale += saleAmountForDeal(deal, calculation, agentRatio);
      acc.clean += cleanCost(calculation);
      acc.final += finalCost(calculation);
      acc.profit += profit(deal, calculation, agentRatio);
      return acc;
    },
    { sale: 0, clean: 0, final: 0, profit: 0 },
  );

  function startColumnResize(column: (typeof tableColumns)[number], event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[column.id];
    document.body.classList.add("is-resizing-columns");

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextWidth = clamp(startWidth + pointerEvent.clientX - startX, column.minWidth, 520);
      setColumnWidths((current) => ({ ...current, [column.id]: nextWidth }));
    }

    function handlePointerUp() {
      document.body.classList.remove("is-resizing-columns");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function resetColumnWidth(column: (typeof tableColumns)[number]) {
    setColumnWidths((current) => ({ ...current, [column.id]: column.defaultWidth }));
  }

  function resetAllColumnWidths() {
    setColumnWidths(defaultColumnWidths());
  }

  return (
    <main className="deal-list">
      <div className="toolbar">
        <div>
          <h1>Сделки к запуску</h1>
          <p>{deals.length} сделок на стадии производства</p>
        </div>
        <div className="toolbar-actions">
          <label className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Поиск по номеру, названию, менеджеру"
            />
          </label>
          <button
            className="icon-button"
            title="Сбросить ширину столбцов"
            onClick={resetAllColumnWidths}
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      <section className="kpis">
        <Kpi label="Продажа" value={formatMoney(totals.sale)} />
        <Kpi label="Чистый себес" value={formatMoney(totals.clean)} />
        <Kpi label="С косяками" value={formatMoney(totals.final)} />
        <Kpi label="Прибыль" value={formatMoney(totals.profit)} />
      </section>

      <div className="table-wrap">
        <table className="deals-table" style={{ width: `max(100%, ${tableWidth}px)` }}>
          <colgroup>
            {tableColumns.map((column) => (
              <col key={column.id} style={{ width: `${columnWidths[column.id]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {tableColumns.map((column) => (
                <th key={column.id} className="resizable-th">
                  {column.label}
                  <span
                    aria-label={`Изменить ширину: ${column.label || "действия"}`}
                    className="column-resizer"
                    role="separator"
                    title="Потяните, чтобы изменить ширину. Двойной клик сбрасывает колонку."
                    onDoubleClick={() => resetColumnWidth(column)}
                    onPointerDown={(event) => startColumnResize(column, event)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => {
              const calculation = calculations.get(deal.id);
              const sales = saleBreakdownForDeal(deal, calculation, agentRatio);
              const isSelected = selectedDealId === deal.id;
              return (
                <tr key={deal.id} className={isSelected ? "selected" : ""}>
                  <td>
                    <button className="deal-title" onClick={() => onSelect(deal)}>
                      <strong>#{deal.number}</strong>
                      <span>{deal.title}</span>
                    </button>
                    <small>{deal.classification || "Без классификации"}</small>
                  </td>
                  <td>{deal.source || "-"}</td>
                  <td>{deal.type || "-"}</td>
                  <td>{deal.responsible || "-"}</td>
                  <td>
                    <span>{formatDate(deal.startDate) || "запуск не указан"}</span>
                    <small>{formatDate(deal.expectedFinishDate) || "финиш не указан"}</small>
                  </td>
                  <td>
                    {formatMoney(sales.totalSale)}
                    <small>
                      изготовление {formatMoney(sales.productionSale)} · монтаж{" "}
                      {formatMoney(sales.installSale)}
                    </small>
                  </td>
                  <td>
                    <button className="cost-chip" onClick={() => onSelect(deal)}>
                      <span>{formatMoney(finalCost(calculation))}</span>
                      <small>
                        чистый {formatMoney(cleanCost(calculation))} ·{" "}
                        {formatPercent(margin(deal, calculation, agentRatio))}
                      </small>
                    </button>
                  </td>
                  <td className={profit(deal, calculation, agentRatio) < 0 ? "negative" : ""}>
                    {formatMoney(profit(deal, calculation, agentRatio))}
                  </td>
                  <td className="row-actions">
                    <button title="Открыть расчет" onClick={() => onSelect(deal)}>
                      <Pencil size={17} />
                    </button>
                    <a title="Открыть в Битрикс24" href={deal.bitrixUrl} target="_blank">
                      <ExternalLink size={17} />
                    </a>
                  </td>
                </tr>
              );
            })}
            {!deals.length && (
              <tr>
                <td className="empty" colSpan={9}>
                  Сделки не найдены. Проверьте синхронизацию Bitrix24 или фильтр поиска.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function defaultColumnWidths(): ColumnWidths {
  return tableColumns.reduce((widths, column) => {
    widths[column.id] = column.defaultWidth;
    return widths;
  }, {} as ColumnWidths);
}

function loadColumnWidths(): ColumnWidths {
  const defaults = defaultColumnWidths();

  try {
    const saved = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved) as Partial<Record<ColumnId, number>>;
    return tableColumns.reduce((widths, column) => {
      widths[column.id] = clamp(
        Number(parsed[column.id]) || column.defaultWidth,
        column.minWidth,
        520,
      );
      return widths;
    }, {} as ColumnWidths);
  } catch {
    return defaults;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU").format(date);
}
