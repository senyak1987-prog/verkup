import { ArrowDownUp, ChevronDown, Database, ExternalLink, FilterX, Pencil, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Deal, DealCalculation } from "../types";
import type { DealStageOption } from "../lib/stages";
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
import { displayResponsible, isUnresolvedResponsible } from "../lib/responsible";
import { stageIdForDeal } from "../lib/stages";
import { EmployeeCard } from "./EmployeeCard";

const COLUMN_STORAGE_KEY = "verkupDealColumnWidths.v2";
const MULTIPLE_STAGE_FILTER_VALUE = "__multiple_stages__";
const DEAL_RENDER_BATCH = 80;
const MOBILE_DEAL_TABLE_MEDIA = "(max-width: 1180px)";

const tableColumns = [
  { id: "deal", label: "Сделка", defaultWidth: 185, minWidth: 160 },
  { id: "source", label: "Источник", defaultWidth: 95, minWidth: 90 },
  { id: "type", label: "Тип", defaultWidth: 125, minWidth: 110 },
  { id: "responsible", label: "Ответственный", defaultWidth: 135, minWidth: 120 },
  { id: "stage", label: "Стадия", defaultWidth: 150, minWidth: 130 },
  { id: "startDate", label: "Дата запуска", defaultWidth: 88, minWidth: 86 },
  { id: "finishDate", label: "Предп. закрытия", defaultWidth: 98, minWidth: 96 },
  { id: "sales", label: "Продажа / монтаж", defaultWidth: 120, minWidth: 110 },
  { id: "cost", label: "Себестоимость", defaultWidth: 110, minWidth: 105 },
  { id: "profit", label: "Прибыль", defaultWidth: 70, minWidth: 68 },
  { id: "actions", label: "", defaultWidth: 76, minWidth: 72 },
] as const;

type ColumnId = (typeof tableColumns)[number]["id"];
type TableColumn = (typeof tableColumns)[number];
type ColumnWidths = Record<ColumnId, number>;

type ColumnFilters = {
  source: string;
  responsible: string;
  type: string;
  classification: string;
};

const emptyColumnFilters: ColumnFilters = {
  source: "",
  responsible: "",
  type: "",
  classification: "",
};

type DealFilterOptions = {
  sources: string[];
  responsibles: string[];
  types: string[];
  classifications: string[];
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
  stageOptions?: DealStageOption[];
  selectedStageIds?: string[];
  onStageFilterChange?: (ids: string[]) => void;
  onStageChange?: (deal: Deal, stageId: string, stageName?: string) => void;
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
  stageOptions = [],
  selectedStageIds = [],
  onStageFilterChange,
  onStageChange,
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
  const [renderLimit, setRenderLimit] = useState(DEAL_RENDER_BATCH);
  const isMobileLayout = useMediaQuery(MOBILE_DEAL_TABLE_MEDIA);
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

  useEffect(() => {
    setRenderLimit(DEAL_RENDER_BATCH);
  }, [columnFilters, dateSort, query, selectedStageIds]);

  const tableWidth = useMemo(
    () => tableColumns.reduce((sum, column) => sum + columnWidths[column.id], 0),
    [columnWidths],
  );

  const filterOptions = useMemo(
    () => ({
      sources: uniqueValues(deals.map((deal) => deal.source)),
      responsibles: uniqueValues(deals.map((deal) => deal.responsible)),
      types: uniqueValues(deals.map((deal) => deal.type)),
      classifications: uniqueValues(deals.map((deal) => deal.classification)),
    }),
    [deals],
  );

  const visibleDeals = useMemo(() => {
    const filteredDeals = deals.filter((deal) => matchesColumnFilters(deal, columnFilters));
    if (!dateSort) return filteredDeals;
    return [...filteredDeals].sort((first, second) => compareDealsByDate(first, second, dateSort));
  }, [columnFilters, dateSort, deals]);

  const hasColumnFilters = Object.values(columnFilters).some(Boolean);
  const hasSmartFilters = hasColumnFilters || selectedStageIds.length > 0 || query.trim().length > 0;
  const hasTableFilters = hasColumnFilters || selectedStageIds.length > 0;
  const renderedDeals = useMemo(
    () => takeRenderedDeals(visibleDeals, renderLimit, selectedDealId),
    [renderLimit, selectedDealId, visibleDeals],
  );
  const hasMoreDeals = renderedDeals.length < visibleDeals.length;
  const stageFilterValue =
    selectedStageIds.length === 0
      ? ""
      : selectedStageIds.length === 1
        ? selectedStageIds[0]
        : MULTIPLE_STAGE_FILTER_VALUE;
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
    onStageFilterChange?.([]);
  }

  function resetSmartFilters() {
    setColumnFilters(emptyColumnFilters);
    onStageFilterChange?.([]);
    onQueryChange("");
  }

  function toggleDateSort(column: SortColumnId) {
    setDateSort((current) => {
      if (!current || current.column !== column) {
        return { column, direction: "asc" };
      }
      return { column, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  function applySingleStageFilter(value: string) {
    if (value === MULTIPLE_STAGE_FILTER_VALUE) return;
    onStageFilterChange?.(value ? [value] : []);
  }

  return (
    <main className="deal-list">
      <section className="workspace-page-hero cost-page-hero">
        <span className="eyebrow">Себестоимость</span>
        <h1>Сделки</h1>
        <p>Расчеты, ТЗ, статусы и производственная себестоимость в одном рабочем списке.</p>
      </section>

      <div className="toolbar smart-toolbar">
        <DealSmartSearch
          query={query}
          onQueryChange={onQueryChange}
          columnFilters={columnFilters}
          onColumnFiltersChange={patchColumnFilters}
          filterOptions={filterOptions}
          stageOptions={stageOptions}
          selectedStageIds={selectedStageIds}
          onStageFilterChange={onStageFilterChange}
          visibleCount={visibleDeals.length}
          totalCount={deals.length}
          onReset={resetSmartFilters}
        />
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="Сбросить ширину столбцов"
            onClick={resetAllColumnWidths}
          >
            <RotateCcw size={18} />
          </button>
          <button
            className={hasSmartFilters ? "icon-button active" : "icon-button"}
            disabled={!hasSmartFilters}
            title="Сбросить поиск и фильтры"
            onClick={resetSmartFilters}
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

      <section className="mobile-deal-filters" aria-label="Фильтры сделок">
        <label>
          <span>Источник</span>
          <select
            value={columnFilters.source}
            onChange={(event) => patchColumnFilters({ source: event.target.value })}
          >
            <option value="">Все</option>
            {filterOptions.sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Ответственный</span>
          <select
            value={columnFilters.responsible}
            onChange={(event) => patchColumnFilters({ responsible: event.target.value })}
          >
            <option value="">Все</option>
            {filterOptions.responsibles.map((responsible) => (
              <option key={responsible} value={responsible}>
                {displayResponsible(responsible)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Тип</span>
          <select
            value={columnFilters.type}
            onChange={(event) => patchColumnFilters({ type: event.target.value })}
          >
            <option value="">Все</option>
            {filterOptions.types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        {stageOptions.length ? (
          <label>
            <span>Стадия</span>
            <select
              value={stageFilterValue}
              onChange={(event) => applySingleStageFilter(event.target.value)}
            >
              <option value="">Все</option>
              {stageFilterValue === MULTIPLE_STAGE_FILTER_VALUE ? (
                <option value={MULTIPLE_STAGE_FILTER_VALUE}>Несколько стадий</option>
              ) : null}
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="secondary" disabled={!hasTableFilters} onClick={resetColumnFilters} type="button">
          <FilterX size={16} />
          Сбросить
        </button>
      </section>

      {isMobileLayout ? (
        <section className="mobile-deal-cards" aria-label="Сделки">
          {renderedDeals.map((deal) => {
            const calculation = calculations.get(deal.id);
            const sales = saleBreakdownForDeal(deal, calculation, agentRatio);
            const dealProfit = profit(deal, calculation, agentRatio);
            const isSelected = selectedDealId === deal.id;
            const animatedExpandedRow = animatedExpandedRowsByDeal.get(deal.id);
            const animatedExpandedContent =
              animatedExpandedRow && isSelected
                ? expandedRow
                : animatedExpandedRow?.content || expandedRowCacheRef.current.get(deal.id);

            return (
              <motion.article
                className={isSelected ? "mobile-deal-card selected" : "mobile-deal-card"}
                data-deal-id={deal.id}
                key={deal.id}
                layout
                whileTap={{ scale: 0.992 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <button className="mobile-deal-card-main" onClick={() => onSelect(deal)} type="button">
                  <span className="mobile-deal-number">#{deal.number}</span>
                  <span className="mobile-deal-title">
                    <strong>{deal.title || "Без названия"}</strong>
                    <small>{deal.classification || deal.type || "Без классификации"}</small>
                  </span>
                  <span className="mobile-deal-stage">{deal.stageName || deal.stageCode || "-"}</span>
                </button>
                {stageOptions.length ? (
                  <select
                    className="mobile-stage-select"
                    value={stageIdForDeal(deal)}
                    onChange={(event) => {
                      const option = stageOptions.find((item) => item.id === event.target.value);
                      onStageChange?.(deal, event.target.value, option?.name);
                    }}
                  >
                    {stageOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                ) : null}

                <div className="mobile-deal-meta">
                  <span>
                    <small>Ответственный</small>
                    <strong>{displayResponsible(deal.responsible) || "-"}</strong>
                  </span>
                  <span>
                    <small>Запуск</small>
                    <strong>{formatDate(deal.startDate) || "-"}</strong>
                  </span>
                  <span>
                    <small>Срок</small>
                    <strong>{formatDate(deal.expectedFinishDate) || "-"}</strong>
                  </span>
                  <span>
                    <small>Продажа</small>
                    <strong>{formatMoney(sales.totalSale)}</strong>
                  </span>
                  <span>
                    <small>Себестоимость</small>
                    <strong>{formatMoney(finalCost(calculation))}</strong>
                  </span>
                  <span className={dealProfit < 0 ? "negative" : ""}>
                    <small>Прибыль</small>
                    <strong>{formatMoney(dealProfit)}</strong>
                  </span>
                </div>

                <div className="mobile-deal-actions">
                  <button className="primary" onClick={() => onSelect(deal)} type="button">
                    <Pencil size={16} />
                    Себестоимость / ТЗ
                  </button>
                  <a className="secondary" href={deal.bitrixUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={16} />
                    Bitrix
                  </a>
                </div>

                {animatedExpandedRow && animatedExpandedContent ? (
                  <div className={`mobile-deal-expanded ${animatedExpandedRow.status}`}>
                    <div className="deal-expand-shell">
                      <div className="deal-expand-inner">{animatedExpandedContent}</div>
                    </div>
                  </div>
                ) : null}
              </motion.article>
            );
          })}
          {!visibleDeals.length ? (
            <div className="mobile-deal-empty">
              Сделки не найдены. Проверьте синхронизацию Bitrix24 или фильтр поиска.
            </div>
          ) : null}
        </section>
      ) : (
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
                    stageOptions={stageOptions}
                    stageFilterValue={stageFilterValue}
                    onChange={patchColumnFilters}
                    onStageFilterChange={applySingleStageFilter}
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
            {renderedDeals.map((deal) => {
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
                    data-deal-id={deal.id}
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
                    <td
                      className={
                        isUnresolvedResponsible(deal.responsible)
                          ? "responsible-cell unresolved"
                          : "responsible-cell"
                      }
                    >
                      <EmployeeCard
                        card={deal.responsibleCard}
                        compact
                        fallbackName={deal.responsible}
                        fallbackPhone={deal.responsiblePhone}
                      />
                    </td>
                    <td className="stage-cell" onClick={(event) => event.stopPropagation()}>
                      {stageOptions.length ? (
                        <select
                          className="stage-inline-select"
                          value={stageIdForDeal(deal)}
                          onChange={(event) => {
                            const option = stageOptions.find((item) => item.id === event.target.value);
                            onStageChange?.(deal, event.target.value, option?.name);
                          }}
                        >
                          {stageOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        deal.stageName || "-"
                      )}
                    </td>
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
                    <tr
                      className={`calculation-panel-row ${animatedExpandedRow.status}`}
                      data-deal-panel-id={deal.id}
                    >
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
      )}
      {hasMoreDeals ? (
        <button
          className="deal-render-more"
          onClick={() => setRenderLimit((current) => current + DEAL_RENDER_BATCH)}
          type="button"
        >
          Показать еще {Math.min(DEAL_RENDER_BATCH, visibleDeals.length - renderedDeals.length)} из {visibleDeals.length}
        </button>
      ) : null}
    </main>
  );
}

function DealSmartSearch({
  query,
  onQueryChange,
  columnFilters,
  onColumnFiltersChange,
  filterOptions,
  stageOptions,
  selectedStageIds,
  onStageFilterChange,
  visibleCount,
  totalCount,
  onReset,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  columnFilters: ColumnFilters;
  onColumnFiltersChange: (patch: Partial<ColumnFilters>) => void;
  filterOptions: DealFilterOptions;
  stageOptions: DealStageOption[];
  selectedStageIds: string[];
  onStageFilterChange?: (ids: string[]) => void;
  visibleCount: number;
  totalCount: number;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedStages = new Set(selectedStageIds);
  const hasFilters = Boolean(
    query.trim() ||
      selectedStageIds.length ||
      columnFilters.source ||
      columnFilters.responsible ||
      columnFilters.type ||
      columnFilters.classification,
  );
  const stageTotal = stageOptions.reduce((sum, option) => sum + option.count, 0);
  const stageChipText =
    selectedStageIds.length === 0
      ? "Все стадии"
      : selectedStageIds.length === 1
        ? stageOptions.find((option) => option.id === selectedStageIds[0])?.name || "1 стадия"
        : `${selectedStageIds.length} стадии`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function toggleStage(stageId: string) {
    if (!onStageFilterChange) return;
    const next = new Set(selectedStageIds);
    if (next.has(stageId)) next.delete(stageId);
    else next.add(stageId);
    onStageFilterChange([...next]);
  }

  function clearStageFilter(event: MouseEvent) {
    event.stopPropagation();
    onStageFilterChange?.([]);
  }

  function clearColumnFilter(key: keyof ColumnFilters) {
    onColumnFiltersChange({ [key]: "" } as Partial<ColumnFilters>);
  }

  function handleTopQueryChange(value: string) {
    onQueryChange(value);
    setOpen(false);
  }

  return (
    <div className="deal-smart-search" ref={rootRef}>
      <div className={open ? "deal-smart-search-box open" : "deal-smart-search-box"}>
        <Search className="deal-smart-search-icon" size={20} />
        <button
          className={selectedStageIds.length ? "deal-filter-chip active" : "deal-filter-chip"}
          title="Фильтр по стадиям Bitrix"
          type="button"
        >
          <span>{stageChipText}</span>
          <b>{selectedStageIds.length === 0 ? stageTotal || totalCount : selectedStageIds.length}</b>
          {selectedStageIds.length ? (
            <X size={13} onClick={clearStageFilter} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>

        {columnFilters.source ? (
          <button className="deal-filter-chip active muted" onClick={() => clearColumnFilter("source")} type="button">
            Источник: {columnFilters.source}
            <X size={13} />
          </button>
        ) : null}
        {columnFilters.type ? (
          <button className="deal-filter-chip active muted" onClick={() => clearColumnFilter("type")} type="button">
            Тип: {columnFilters.type}
            <X size={13} />
          </button>
        ) : null}
        {columnFilters.classification ? (
          <button className="deal-filter-chip active muted" onClick={() => clearColumnFilter("classification")} type="button">
            Класс: {columnFilters.classification}
            <X size={13} />
          </button>
        ) : null}
        {columnFilters.responsible ? (
          <button className="deal-filter-chip active muted" onClick={() => clearColumnFilter("responsible")} type="button">
            Ответственный: {displayResponsible(columnFilters.responsible)}
            <X size={13} />
          </button>
        ) : null}

        <input
          aria-label="Фильтр и поиск сделок"
          value={query}
          onChange={(event) => handleTopQueryChange(event.target.value)}
          onFocus={() => setOpen(false)}
          placeholder={hasFilters ? "Добавить поиск" : "Фильтр + поиск"}
        />

        <span className="deal-search-count">{visibleCount}</span>
        <button
          aria-expanded={open}
          aria-label="Открыть фильтры"
          className="deal-filter-open"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="deal-filter-panel"
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <aside className="deal-filter-presets">
              <button className={!hasFilters ? "active" : ""} onClick={onReset} type="button">
                Все сделки
                <span>{totalCount}</span>
              </button>
              <button onClick={() => onStageFilterChange?.([])} type="button">
                Все стадии
                <span>{stageTotal || totalCount}</span>
              </button>
              {stageOptions.slice(0, 6).map((option) => (
                <button
                  className={selectedStages.has(option.id) ? "active" : ""}
                  key={option.id}
                  onClick={() => toggleStage(option.id)}
                  type="button"
                >
                  {option.name}
                  <span>{option.count}</span>
                </button>
              ))}
            </aside>

            <div className="deal-filter-fields">
              <label className="deal-filter-field wide">
                <span>Название, номер, менеджер</span>
                <input value={query} onChange={(event) => onQueryChange(event.target.value)} />
              </label>
              <label className="deal-filter-field">
                <span>Ответственный</span>
                <select
                  value={columnFilters.responsible}
                  onChange={(event) => onColumnFiltersChange({ responsible: event.target.value })}
                >
                  <option value="">Все</option>
                  {filterOptions.responsibles.map((responsible) => (
                    <option key={responsible} value={responsible}>
                      {displayResponsible(responsible)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="deal-filter-field">
                <span>Источник</span>
                <select
                  value={columnFilters.source}
                  onChange={(event) => onColumnFiltersChange({ source: event.target.value })}
                >
                  <option value="">Все</option>
                  {filterOptions.sources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label className="deal-filter-field">
                <span>Тип</span>
                <select
                  value={columnFilters.type}
                  onChange={(event) => onColumnFiltersChange({ type: event.target.value })}
                >
                  <option value="">Все</option>
                  {filterOptions.types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="deal-filter-field">
                <span>Классификация</span>
                <select
                  value={columnFilters.classification}
                  onChange={(event) => onColumnFiltersChange({ classification: event.target.value })}
                >
                  <option value="">Все</option>
                  {filterOptions.classifications.map((classification) => (
                    <option key={classification} value={classification}>
                      {classification}
                    </option>
                  ))}
                </select>
              </label>
              <div className="deal-filter-stage-list">
                <span>Стадии Bitrix</span>
                <div>
                  {stageOptions.map((option) => (
                    <label key={option.id} title={`${option.name} (${option.count})`}>
                      <input
                        checked={selectedStages.has(option.id)}
                        onChange={() => toggleStage(option.id)}
                        type="checkbox"
                      />
                      <span className="deal-filter-stage-name">{option.name}</span>
                      <b>{option.count}</b>
                    </label>
                  ))}
                </div>
              </div>
              <div className="deal-filter-footer">
                <button className="primary" onClick={() => setOpen(false)} type="button">
                  Найти
                </button>
                <button className="ghost" disabled={!hasFilters} onClick={onReset} type="button">
                  Сбросить
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ColumnHeader({
  column,
  filters,
  sort,
  options,
  stageOptions,
  stageFilterValue,
  onChange,
  onStageFilterChange,
  onSort,
}: {
  column: TableColumn;
  filters: ColumnFilters;
  sort: DateSort;
  options: DealFilterOptions;
  stageOptions: DealStageOption[];
  stageFilterValue: string;
  onChange: (patch: Partial<ColumnFilters>) => void;
  onStageFilterChange: (stageId: string) => void;
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
      {column.id === "type" && (
        <select
          className="column-filter"
          value={filters.type}
          onChange={(event) => onChange({ type: event.target.value })}
          onClick={(event) => event.stopPropagation()}
        >
          <option value="">Все</option>
          {options.types.map((type) => (
            <option key={type} value={type}>
              {type}
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
              {displayResponsible(responsible)}
            </option>
          ))}
        </select>
      )}
      {column.id === "stage" && stageOptions.length > 0 && (
        <select
          className="column-filter"
          value={stageFilterValue}
          onChange={(event) => onStageFilterChange(event.target.value)}
          onClick={(event) => event.stopPropagation()}
        >
          <option value="">Все</option>
          {stageFilterValue === MULTIPLE_STAGE_FILTER_VALUE ? (
            <option value={MULTIPLE_STAGE_FILTER_VALUE}>Несколько стадий</option>
          ) : null}
          {stageOptions.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
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
  if (filters.type && deal.type !== filters.type) return false;
  if (filters.classification && deal.classification !== filters.classification) return false;
  return true;
}

function takeRenderedDeals(deals: Deal[], limit: number, selectedDealId?: string) {
  const rendered = deals.slice(0, limit);
  if (!selectedDealId || rendered.some((deal) => deal.id === selectedDealId)) return rendered;

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId);
  return selectedDeal ? [...rendered, selectedDeal] : rendered;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
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
