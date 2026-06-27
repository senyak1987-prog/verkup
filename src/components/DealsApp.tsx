import { useMemo, useState, type ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  CheckCircle2,
  ExternalLink,
  Factory,
  Image as ImageIcon,
  Search,
  UserRound,
  Wrench,
} from "lucide-react";
import { finalCost, formatMoney, profit, saleAmountForDeal } from "../lib/costing";
import { stageIdForDeal, stageNameForDeal, type DealStageOption } from "../lib/stages";
import type {
  Deal,
  DealCalculation,
  DealTechSpec,
  Installation,
  InstallationStatus,
  ProductionAssignment,
  ProductionEmployee,
  ProductionWorkerStatus,
  StoredInstallations,
  StoredProduction,
} from "../types";

type DealFocusFilter = "all" | "costed" | "techSpec" | "production" | "installation" | "attention";

type DealsAppProps = {
  deals: Deal[];
  calculations: Map<string, DealCalculation>;
  techSpecs: Map<string, DealTechSpec>;
  production: StoredProduction;
  installations: StoredInstallations;
  agentRatio: number;
  stageOptions: DealStageOption[];
  onOpenDeal: (dealId: string, target: "cost" | "techSpec") => void;
  onStageChange?: (deal: Deal, stageId: string, stageName?: string) => void;
};

const focusFilters: Array<{ id: DealFocusFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "costed", label: "С расчетом" },
  { id: "techSpec", label: "Есть ТЗ" },
  { id: "production", label: "Сборка" },
  { id: "installation", label: "Монтаж" },
  { id: "attention", label: "Контроль" },
];

export function DealsApp({
  deals,
  calculations,
  techSpecs,
  production,
  installations,
  agentRatio,
  stageOptions,
  onOpenDeal,
  onStageChange,
}: DealsAppProps) {
  const [query, setQuery] = useState("");
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [focusFilter, setFocusFilter] = useState<DealFocusFilter>("all");

  const employeeById = useMemo(
    () => new Map(production.employees.map((employee) => [employee.id, employee])),
    [production.employees],
  );

  const productionByDeal = useMemo(() => groupByDeal(production.assignments), [production.assignments]);
  const installationsByDeal = useMemo(() => groupByDeal(installations.installations), [installations.installations]);

  const totals = useMemo(() => {
    let costed = 0;
    let withTechSpec = 0;
    let inProduction = 0;
    let withInstallation = 0;
    let photoReports = 0;

    for (const deal of deals) {
      const calculation = calculations.get(deal.id);
      const assignments = productionByDeal.get(deal.id) || [];
      const dealInstallations = installationsByDeal.get(deal.id) || [];
      if (calculation && finalCost(calculation) > 0) costed += 1;
      if (techSpecs.has(deal.id)) withTechSpec += 1;
      if (assignments.length) inProduction += 1;
      if (dealInstallations.length) withInstallation += 1;
      photoReports += countProductionPhotos(assignments) + countInstallationPhotos(dealInstallations);
    }

    return { costed, withTechSpec, inProduction, withInstallation, photoReports };
  }, [calculations, deals, installationsByDeal, productionByDeal, techSpecs]);

  const filteredDeals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const selectedStages = new Set(selectedStageIds);

    return deals.filter((deal) => {
      const calculation = calculations.get(deal.id);
      const assignments = productionByDeal.get(deal.id) || [];
      const dealInstallations = installationsByDeal.get(deal.id) || [];
      const hasStage = selectedStages.size === 0 || selectedStages.has(stageIdForDeal(deal));
      if (!hasStage) return false;

      if (focusFilter === "costed" && (!calculation || finalCost(calculation) <= 0)) return false;
      if (focusFilter === "techSpec" && !techSpecs.has(deal.id)) return false;
      if (focusFilter === "production" && assignments.length === 0) return false;
      if (focusFilter === "installation" && dealInstallations.length === 0 && !isInstallationDeal(deal)) return false;
      if (focusFilter === "attention" && !needsAttention(deal, assignments, dealInstallations)) return false;

      if (!needle) return true;
      return [
        deal.number,
        deal.title,
        deal.source,
        deal.type,
        deal.classification,
        deal.responsible,
        deal.stageName,
        deal.installationAddress,
        deal.installationClientName,
        deal.installationClientPhone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [calculations, deals, focusFilter, installationsByDeal, productionByDeal, query, selectedStageIds, techSpecs]);

  function toggleStage(stageId: string) {
    setSelectedStageIds((current) =>
      current.includes(stageId) ? current.filter((item) => item !== stageId) : [...current, stageId],
    );
  }

  return (
    <main className="deals-overview-app">
      <section className="workspace-page-hero deals-overview-hero">
        <span className="eyebrow">Единый журнал</span>
        <h1>Сделки</h1>
        <p>
          Все сделки из Bitrix, расчеты, ТЗ, сборка, монтажи, фотоотчеты и история работы в одном рабочем списке.
        </p>
      </section>

      <section className="deals-overview-kpis" aria-label="Сводка по сделкам">
        <DealsKpi label="Всего сделок" value={deals.length} />
        <DealsKpi label="С расчетом" value={totals.costed} />
        <DealsKpi label="ТЗ заполнены" value={totals.withTechSpec} />
        <DealsKpi label="В сборке" value={totals.inProduction} />
        <DealsKpi label="Монтажи" value={totals.withInstallation} />
        <DealsKpi label="Фотоотчеты" value={totals.photoReports} />
      </section>

      <section className="deals-overview-toolbar" aria-label="Фильтр сделок">
        <label className="deals-overview-search">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по номеру, названию, менеджеру, адресу"
          />
        </label>

        <div className="deals-overview-focus" role="tablist" aria-label="Быстрые фильтры">
          {focusFilters.map((filter) => (
            <button
              key={filter.id}
              className={focusFilter === filter.id ? "active" : ""}
              onClick={() => setFocusFilter(filter.id)}
              type="button"
              role="tab"
              aria-selected={focusFilter === filter.id}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="deals-overview-stages" aria-label="Стадии Bitrix">
          <button
            className={selectedStageIds.length === 0 ? "active" : ""}
            onClick={() => setSelectedStageIds([])}
            type="button"
          >
            Все стадии <b>{deals.length}</b>
          </button>
          {stageOptions.map((stage) => (
            <button
              key={stage.id}
              className={selectedStageIds.includes(stage.id) ? "active" : ""}
              onClick={() => toggleStage(stage.id)}
              type="button"
              title={stage.name}
            >
              <span>{stage.name}</span>
              <b>{stage.count}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="deals-overview-resultbar">
        <span>{filteredDeals.length} сделок в выборке</span>
        {selectedStageIds.length > 0 || query || focusFilter !== "all" ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSelectedStageIds([]);
              setFocusFilter("all");
            }}
          >
            Сбросить фильтр
          </button>
        ) : null}
      </section>

      <section className="deals-overview-list" aria-label="Список сделок">
        {filteredDeals.length ? (
          filteredDeals.map((deal) => {
            const calculation = calculations.get(deal.id);
            const spec = techSpecs.get(deal.id);
            const assignments = productionByDeal.get(deal.id) || [];
            const dealInstallations = installationsByDeal.get(deal.id) || [];
            return (
              <DealOverviewCard
                key={deal.id}
                deal={deal}
                calculation={calculation}
                spec={spec}
                assignments={assignments}
                installations={dealInstallations}
                employeeById={employeeById}
                agentRatio={agentRatio}
                stageOptions={stageOptions}
                onOpenDeal={onOpenDeal}
                onStageChange={onStageChange}
              />
            );
          })
        ) : (
          <div className="deals-overview-empty">Сделок по выбранным условиям пока нет.</div>
        )}
      </section>
    </main>
  );
}

function DealOverviewCard({
  deal,
  calculation,
  spec,
  assignments,
  installations,
  employeeById,
  agentRatio,
  stageOptions,
  onOpenDeal,
  onStageChange,
}: {
  deal: Deal;
  calculation?: DealCalculation;
  spec?: DealTechSpec;
  assignments: ProductionAssignment[];
  installations: Installation[];
  employeeById: Map<string, ProductionEmployee>;
  agentRatio: number;
  stageOptions: DealStageOption[];
  onOpenDeal: (dealId: string, target: "cost" | "techSpec") => void;
  onStageChange?: (deal: Deal, stageId: string, stageName?: string) => void;
}) {
  const stageId = stageIdForDeal(deal);
  const productionPhotos = countProductionPhotos(assignments);
  const installationPhotos = countInstallationPhotos(installations);
  const lastAssignment = latestByDate(assignments, (assignment) => assignment.submittedAt || assignment.startedAt || assignment.assignedAt);
  const lastInstallation = latestByDate(installations, (installation) => installation.updatedAt || installation.date);
  const workers = unique(
    assignments
      .map((assignment) => employeeById.get(assignment.employeeId)?.name)
      .filter((name): name is string => Boolean(name)),
  );
  const sale = saleAmountForDeal(deal, calculation, agentRatio);
  const cost = calculation ? finalCost(calculation) : 0;
  const dealProfit = profit(deal, calculation, agentRatio);
  const previewPhotos = previewInstallationPhotos(installations);

  return (
    <article className="deal-overview-card" data-deal-id={deal.id}>
      <header className="deal-overview-card-head">
        <div className="deal-overview-main">
          <span className="deal-overview-number">#{deal.number}</span>
          <h2>{deal.title}</h2>
          <div className="deal-overview-meta">
            <span>{stageNameForDeal(deal)}</span>
            <span>{deal.type}</span>
            <span>{deal.classification}</span>
            <span>Срок: {formatDate(deal.expectedFinishDate)}</span>
          </div>
        </div>

        <div className="deal-overview-stage-control">
          <label>
            <span>Стадия Bitrix</span>
            <select
              value={stageId}
              onChange={(event) => {
                const nextStage = stageOptions.find((stage) => stage.id === event.target.value);
                onStageChange?.(deal, event.target.value, nextStage?.name);
              }}
            >
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="deal-overview-grid">
        <DealInfoPanel
          icon={<UserRound size={18} />}
          title="Bitrix"
          rows={[
            ["Ответственный", deal.responsible || "Не указан"],
            ["Источник", deal.source || "Не указан"],
            ["Запуск", formatDate(deal.startDate)],
          ]}
          avatarUrl={deal.responsibleCard?.avatarUrl}
          action={
            deal.bitrixUrl ? (
              <a href={deal.bitrixUrl} target="_blank" rel="noreferrer">
                Bitrix <ExternalLink size={14} />
              </a>
            ) : undefined
          }
        />

        <DealInfoPanel
          icon={<BriefcaseBusiness size={18} />}
          title="Финансы"
          rows={[
            ["Продажа", formatMoney(sale)],
            ["Себестоимость", formatMoney(cost)],
            ["Прибыль", formatMoney(dealProfit)],
          ]}
          tone={dealProfit < 0 ? "danger" : "success"}
        />

        <DealInfoPanel
          icon={<Factory size={18} />}
          title="Сборка"
          rows={[
            ["Макетчики", workers.length ? workers.join(", ") : "Не назначены"],
            ["Статус", lastAssignment ? productionStatusLabel(lastAssignment.workerStatus, lastAssignment.status) : "Нет назначений"],
            ["Фото", `${productionPhotos}`],
          ]}
          action={
            assignments.length ? (
              <button type="button" onClick={() => onOpenDeal(deal.id, "techSpec")}>
                Открыть ТЗ
              </button>
            ) : undefined
          }
        />

        <DealInfoPanel
          icon={<CalendarDays size={18} />}
          title="Монтаж"
          rows={[
            ["Монтажник", lastInstallation?.installerName || "Не назначен"],
            ["Дата", lastInstallation ? `${formatDate(lastInstallation.date)} ${lastInstallation.timeFrom || ""}` : "Нет монтажа"],
            ["Статус", lastInstallation ? installationStatusLabel(lastInstallation.status) : "Не создан"],
          ]}
          action={lastInstallation?.address ? <span>{lastInstallation.address}</span> : undefined}
        />
      </div>

      <footer className="deal-overview-footer">
        <div className="deal-overview-tz">
          <CheckCircle2 size={16} />
          <span>{spec ? `ТЗ: ${spec.draft.items.length} изделий` : "ТЗ еще не заполнено"}</span>
        </div>
        <div className="deal-overview-photos">
          <Camera size={16} />
          <span>Фото: {productionPhotos + installationPhotos}</span>
          {previewPhotos.map((photo) => (
            <img key={photo.url} src={photo.thumbnailUrl || photo.url} alt={photo.originalName || "Фото монтажа"} loading="lazy" />
          ))}
          {!previewPhotos.length && deal.installationFiles?.length ? (
            <span className="deal-overview-file-count">
              <ImageIcon size={15} /> Bitrix: {deal.installationFiles.length}
            </span>
          ) : null}
        </div>
        <div className="deal-overview-actions">
          <button type="button" onClick={() => onOpenDeal(deal.id, "cost")}>
            Открыть сделку
          </button>
          <button type="button" onClick={() => onOpenDeal(deal.id, "techSpec")}>
            ТЗ
          </button>
        </div>
      </footer>
    </article>
  );
}

function DealInfoPanel({
  icon,
  title,
  rows,
  action,
  avatarUrl,
  tone,
}: {
  icon: ReactNode;
  title: string;
  rows: Array<[string, string]>;
  action?: ReactNode;
  avatarUrl?: string;
  tone?: "success" | "danger";
}) {
  return (
    <section className={`deal-info-panel ${tone || ""}`}>
      <header>
        <span className="deal-info-icon">{avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : icon}</span>
        <strong>{title}</strong>
      </header>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {action ? <div className="deal-info-action">{action}</div> : null}
    </section>
  );
}

function DealsKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="deals-overview-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupByDeal<T extends { dealId: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const current = map.get(item.dealId) || [];
    current.push(item);
    map.set(item.dealId, current);
  }
  return map;
}

function countProductionPhotos(assignments: ProductionAssignment[]) {
  return assignments.reduce((sum, assignment) => sum + (assignment.completion?.photos.length || 0), 0);
}

function countInstallationPhotos(installations: Installation[]) {
  return installations.reduce((sum, installation) => sum + installation.photos.length, 0);
}

function previewInstallationPhotos(installations: Installation[]) {
  return installations.flatMap((installation) => installation.photos).slice(0, 3);
}

function latestByDate<T>(items: T[], getDate: (item: T) => string | undefined) {
  return [...items].sort((first, second) => {
    const firstTime = Date.parse(getDate(first) || "");
    const secondTime = Date.parse(getDate(second) || "");
    return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0);
  })[0];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function formatDate(value?: string) {
  if (!value) return "Не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU");
}

function isInstallationDeal(deal: Deal) {
  return `${deal.type} ${deal.installSaleAmount} ${deal.installationAddress}`.toLowerCase().includes("монтаж") || deal.installSaleAmount > 0;
}

function needsAttention(deal: Deal, assignments: ProductionAssignment[], installations: Installation[]) {
  const stageName = stageNameForDeal(deal).toLowerCase();
  return (
    stageName.includes("косяк") ||
    assignments.some((assignment) => assignment.workerStatus === "needsRevision") ||
    installations.some((installation) => installation.status === "needs_revision" || installation.status === "review_pending")
  );
}

function productionStatusLabel(workerStatus?: ProductionWorkerStatus, status?: ProductionAssignment["status"]) {
  if (workerStatus === "inWork") return "На сборке";
  if (workerStatus === "photosAdded") return "Фото добавлены";
  if (workerStatus === "reviewPending") return "На проверке";
  if (workerStatus === "checked") return "Проверено";
  if (workerStatus === "needsRevision") return "Нужна доработка";
  if (status === "readyForShipment") return "Готово к отгрузке";
  if (status === "submitted") return "Отправлено на проверку";
  if (status === "inProgress") return "На сборке";
  return "Назначено";
}

function installationStatusLabel(status: InstallationStatus) {
  const labels: Record<InstallationStatus, string> = {
    not_scheduled: "Не запланирован",
    scheduled: "Запланирован",
    assigned: "Назначен",
    in_progress: "В работе",
    arrived: "На месте",
    review_pending: "На проверке",
    completed: "Завершен",
    needs_revision: "Нужна доработка",
    canceled: "Отменен",
    no_installation: "Без монтажа",
  };
  return labels[status] || status;
}
