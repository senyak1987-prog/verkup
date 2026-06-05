import { ArrowDownUp, Database, ExternalLink, FilterX, Pencil, RotateCcw, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  { id: "deal", label: "Сделка", defaultWidth: 250, minWidth: 170 },
  { id: "source", label: "Источник", defaultWidth: 150, minWidth: 120 },
  { id: "type", label: "Тип", defaultWidth: 200, minWidth: 130 },
  { id: "responsible", label: "Ответственный", defaultWidth: 165, minWidth: 130 },
  { id: "startDate", label: "Дата запуска", defaultWidth: 125, minWidth: 110 },
  { id: "finishDate", label: "Предп. закрытия", defaultWidth: 145, minWidth: 125 },
  { id: "sales", label: "Продажа / монтаж", defaultWidth: 195, minWidth: 145 },
  { id: "cost", label: "Себестоимость", defaultWidth: 170, minWidth: 140 },
  { id: "profit", label: "Прибыль", defaultWidth: 105, minWidth: 85 },
  { id: "actions", label: "", defaultWidth: 80, minWidth: 72 },
] as const;

type ColumnId = (typeof tableColumns)[number]["id"];
type TableColumn = (typeof tableColumns)[number];
type ColumnWidths = Record<ColumnId, number>;

type ColumnFilters = {
  source: string;
  responsible: string;
};

const emptyColumnFilters: ColumnFilters = {
  source: "",
  responsible: "",
};

type SortColumnId = Extract<ColumnId, "startDate" | "finishDate">;
type DateSort = {
  column: SortColumnId;
  direction: "asc" | "desc";
} | null;

type AnimatedExpandedRow = {
  dealId: string;
  status: "opening" | "closing";
  content?: ReactNode;
};

type DealTableProps = {
  deals: Deal[];
  calculations: Map<string, DealCalculation>;
  agentRatio: number;
  selectedDealId?: string;
  topTabs: ReactNode;
  onSelect: (deal: Deal) => void;
  onOpenCatalog: () => void;
  catalogCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  expandedRow?: ReactNode;
};

export function DealTable({
  deals,
  calculations,
  agentRatio,
  selectedDealId,
  topTabs,
  onSelect,
  onOpenCatalog,
  catalogCount,
  query,
  onQueryChange,
  expandedRow,
}: DealTableProps) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => loadColumnWidths());
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(emptyColumnFilters);
  const [dateSort, setDateSort] = useState<DateSort>(null);
  const [animatedExpandedRows, setAnimatedExpandedRows] = useState<AnimatedExpandedRow[]>([]);
  const expandedRowCacheRef = useRef(new Map<string, ReactNode>());

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (selectedDealId && expandedRow) {
      expandedRowCacheRef.current.set(selectedDealId, expandedRow);
    }
  }, [expandedRow, selectedDealId]);

  useEffect(() => {
    setAnimatedExpandedRows((rows) => {
      const nextRows = rows
        .map((row) => {
          if (selectedDealId && row.dealId === selectedDealId) {
            return { dealId: row.dealId, status: "opening" as const };
          }

          return {
            dealId: row.dealId,
            status: "closing" as const,
            content: row.content || expandedRowCacheRef.current.get(row.dealId),
          };
        })
        .filter((row) => row.dealId === selectedDealId || row.status === "closing");

      if (selectedDealId && !nextRows.some((row) => row.dealId === selectedDealId)) {
        nextRows.push({ dealId: selectedDealId, status: "opening" });
      }

      return nextRows;
    });
  }, [selectedDealId]);

  useEffect(() => {
    if (!animatedExpandedRows.some((row) => row.status === "closing")) return;

    const timeoutId = window.setTimeout(() => {
      setAnimatedExpandedRows((rows) => rows.filter((row) => row.status !== "closing"));
    }, 230);

    return () => window.clearTimeout(timeoutId);
  }, [animatedExpandedRows]);

  const tableWidth = useMemo(
    () => tableColumns.reduce((sum, column) => sum + columnWidths[column.id], 0),
    [columnWidths],
  );

  const filterOptions = useMemo(
    () => ({
      sources: uniqueValues(deals.map((deal) => deal.source)),
      responsibles: uniqueValues(deals.map((deal) => deal.responsible)),
    }),
    [deals],
  );

  const visibleDeals = useMemo(() => {
    const filteredDeals = deals.filter((deal) => matchesColumnFilters(deal, columnFilters));
    if (!dateSort) return filteredDeals;
    return [...filteredDeals].sort((first, second) => compareDealsByDate(first, second, dateSort));
  }, [columnFilters, dateSort, deals]);

  const hasColumnFilters = Object.values(columnFilters).some(Boolean);
  const animatedExpandedRowsByDeal = useMemo(
    () => new Map(animatedExpandedRows.map((row) => [row.dealId, row])),
    [animatedExpandedRows],
  );

  const totals = visibleDeals.reduce(
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

  function patchColumnFilters(patch: Partial<ColumnFilters>) {
    setColumnFilters((current) => ({ ...current, ...patch }));
  }

  function resetColumnFilters() {
    setColumnFilters(emptyColumnFilters);
  }

  function toggleDateSort(column: SortColumnId) {
    setDateSort((current) => {
      if (!current || current.column !== column) {
        return { column, direction: "asc" };
      }
      return { column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <main className="deal-list">
      <div className="toolbar">
        <div>
          {topTabs}
          <p>{visibleDeals.length} сделок в текущей вкладке</p>
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
          <button
            className={hasColumnFilters ? "icon-button active" : "icon-button"}
            disabled={!hasColumnFilters}
            title="Сбросить фильтры"
            onClick={resetColumnFilters}
          >
            <FilterX size={18} />
          </button>
          <button className="secondary toolbar-catalog" onClick={onOpenCatalog}>
            <Database size={18} />
            Справочник
            <span>{catalogCount}</span>
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
                  <ColumnHeader
                    column={column}
                    filters={columnFilters}
                    sort={dateSort}
                    options={filterOptions}
                    onChange={patchColumnFilters}
                    onSort={toggleDateSort}
                  />
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
            {visibleDeals.map((deal) => {
              const calculation = calculations.get(deal.id);
              const sales = saleBreakdownForDeal(deal, calculation, agentRatio);
              const isSelected = selectedDealId === deal.id;
              const animatedExpandedRow = animatedExpandedRowsByDeal.get(deal.id);
              const animatedExpandedContent =
                animatedExpandedRow && isSelected
                  ? expandedRow
                  : animatedExpandedRow?.content || expandedRowCacheRef.current.get(deal.id);
              return (
                <Fragment key={deal.id}>
                  <tr
                    className={isSelected ? "selected clickable-row" : "clickable-row"}
                    onClick={() => onSelect(deal)}
                  >
                    <td>
                      <button
                        className="deal-title"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(deal);
                        }}
                      >
                        <strong>#{deal.number}</strong>
                        <span>{deal.title}</span>
                      </button>
                      <small>{deal.classification || "Без классификации"}</small>
                    </td>
                    <td>{deal.source || "-"}</td>
                    <td>{deal.type || "-"}</td>
                    <td>{deal.responsible || "-"}</td>
                    <td>{formatDate(deal.startDate) || "Не указана"}</td>
                    <td>{formatDate(deal.expectedFinishDate) || "Не указана"}</td>
                    <td>
                      {formatMoney(sales.totalSale)}
                      <small>
                        изготовление {formatMoney(sales.productionSale)} · монтаж{" "}
                        {formatMoney(sales.installSale)}
                      </small>
                    </td>
                    <td>
                      <button
                        className="cost-chip"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(deal);
                        }}
                      >
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
                    <td className="row-actions" onClick={(event) => event.stopPropagation()}>
                      <button title="Открыть расчет" onClick={() => onSelect(deal)}>
                        <Pencil size={17} />
                      </button>
                      <a title="Открыть в Битрикс24" href={deal.bitrixUrl} target="_blank">
                        <ExternalLink size={17} />
                      </a>
                    </td>
                  </tr>
                  {animatedExpandedRow && animatedExpandedContent && (
                    <tr className={`calculation-panel-row ${animatedExpandedRow.status}`}>
                      <td colSpan={tableColumns.length}>
                        <div className="deal-expand-shell">
                          <div className="deal-expand-inner">{animatedExpandedContent}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!visibleDeals.length && (
              <tr>
                <td className="empty" colSpan={tableColumns.length}>
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

function ColumnHeader({
  column,
  filters,
  sort,
  options,
  onChange,
  onSort,
}: {
  column: TableColumn;
  filters: ColumnFilters;
  sort: DateSort;
  options: { sources: string[]; responsibles: string[] };
  onChange: (patch: Partial<ColumnFilters>) => void;
  onSort: (column: SortColumnId) => void;
}) {
  const isDateColumn = column.id === "startDate" || column.id === "finishDate";
  const isActiveSort = isDateColumn && sort?.column === column.id;

  return (
    <div className="column-head">
      {isDateColumn ? (
        <button
          className={isActiveSort ? "sort-button active" : "sort-button"}
          onClick={() => onSort(column.id)}
          title={`Сортировать: ${column.label}`}
          type="button"
        >
          <span>{column.label}</span>
          {isActiveSort ? (sort.direction === "asc" ? "↑" : "↓") : <ArrowDownUp size={13} />}
        </button>
      ) : (
        <span className="column-label">{column.label}</span>
      )}
      {column.id === "source" && (
        <select
          className="column-filter"
          value={filters.source}
          onChange={(event) => onChange({ source: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        >
          <option value="">Все</option>
          {options.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      )}
      {column.id === "responsible" && (
        <select
          className="column-filter"
          value={filters.responsible}
          onChange={(event) => onChange({ responsible: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        >
          <option value="">Все</option>
          {options.responsibles.map((responsible) => (
            <option key={responsible} value={responsible}>
              {responsible}
            </option>
          ))}
        </select>
      )}
    </div>
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

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function matchesColumnFilters(deal: Deal, filters: ColumnFilters) {
  if (filters.source && deal.source !== filters.source) return false;
  if (filters.responsible && deal.responsible !== filters.responsible) return false;
  return true;
}

function compareDealsByDate(first: Deal, second: Deal, sort: NonNullable<DateSort>) {
  const firstValue = dealDateValue(first, sort.column);
  const secondValue = dealDateValue(second, sort.column);

  if (firstValue === secondValue) return Number(first.number) - Number(second.number);
  if (!Number.isFinite(firstValue)) return 1;
  if (!Number.isFinite(secondValue)) return -1;

  const result = firstValue - secondValue;
  return sort.direction === "asc" ? result : -result;
}

function dealDateValue(deal: Deal, column: SortColumnId) {
  const value = column === "startDate" ? deal.startDate : deal.expectedFinishDate;
  return value ? Date.parse(value) : Number.NaN;
}
