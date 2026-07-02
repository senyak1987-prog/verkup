import {
  Bell,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BitrixDealFile,
  Deal,
  DealTechSpec,
  Installation,
  InstallationNotification,
  InstallationLocation,
  InstallationPhoto,
  InstallationPhotoType,
  InstallationStatus,
  ProductionEmployee,
  StoredInstallations,
  StoredProduction,
} from "../types";
import { accessRoleFor } from "../lib/access";
import {
  formatInstallationDate,
  formatInstallationTime,
  installationDateKey,
  installationForDeal,
  installationStatusLabels,
  installationStatusOrder,
  isDealReadyForInstallation,
  isInstaller,
  todayDateKey,
} from "../lib/installations";
import {
  changeInstallationStatus,
  createInstallation,
  deleteInstallation,
  deleteInstallationPhoto,
  markInstallationNotificationRead,
  updateInstallation,
  uploadInstallationPhoto,
} from "../lib/saveApi";
import { buildSearchIndex, rankBySearchIndex } from "../lib/searchIndex";

type InstallationViewMode = "day" | "week" | "month" | "year" | "list";
type InstallationMobileTab = "today" | "all" | "notifications" | "profile";
type PlannerWheelContext = {
  container: HTMLDivElement;
  event: globalThis.WheelEvent;
};

type AddressSuggestion = {
  kladrId?: string;
  source?: string;
  value: string;
};

type AddressSuggestionCacheEntry = {
  savedAt: number;
  suggestions: AddressSuggestion[];
};

const ADDRESS_SUGGEST_DEBOUNCE_MS = 120;
const ADDRESS_SUGGEST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ADDRESS_SUGGEST_CACHE_LIMIT = 80;
const ADDRESS_SUGGEST_STORAGE_KEY = "verkup:address-suggest:v1";
const addressSuggestionMemoryCache = new Map<string, AddressSuggestionCacheEntry>();

type InstallationCommitOptions = {
  saveNow?: boolean;
};

type InstallationsAppProps = {
  currentUser: ProductionEmployee;
  deals: Deal[];
  saveApiUrl?: string;
  storedInstallations: StoredInstallations;
  storedProduction: StoredProduction;
  techSpecs: Map<string, DealTechSpec>;
  onChange: (data: StoredInstallations, options?: InstallationCommitOptions) => void;
  onOpenDeal?: (dealId: string, target: "cost" | "techSpec") => void;
  onRefresh?: () => Promise<void> | void;
  onLogout?: () => void;
};

function installationSearchIndex(installation: Installation) {
  return buildSearchIndex([
    installation.dealNumber,
    installation.dealTitle,
    installation.address,
    installation.installerName,
    installation.clientName,
    installation.clientPhone,
    installation.comment,
    installation.resultComment,
    installation.status,
  ]);
}

type InstallationFormState = {
  address: string;
  clientName: string;
  clientPhone: string;
  comment: string;
  date: string;
  dealId: string;
  dealNumber: string;
  dealTitle: string;
  id?: string;
  installerId: string;
  timeFrom: string;
  timeTo: string;
  addressSource?: "bitrix" | "manual";
  sourceFiles?: BitrixDealFile[];
};

type UploadState = {
  message?: string;
  status: "idle" | "uploading" | "success" | "error";
};

type InstallationMapPoint = {
  address: string;
  coordinates?: [number, number];
  date?: string;
  dealId: string;
  id: string;
  kind: "installation" | "readyDeal" | "installer";
  status: InstallationStatus | "ready";
  statusLabel: string;
  subtitle: string;
  time?: string;
  title: string;
};

declare global {
  interface Window {
    ymaps?: any;
  }
}

const YANDEX_MAPS_API_KEY = String(
  window.VERKUP_CONFIG?.YANDEX_MAPS_API_KEY || import.meta.env.VITE_YANDEX_MAPS_API_KEY || "",
).trim();
const YANDEX_GEOCODER_PROXY_URL = String(window.VERKUP_CONFIG?.YANDEX_GEOCODER_PROXY_URL || "").trim();
const MOSCOW_CENTER = [55.751244, 37.618423];
let yandexMapsPromise: Promise<any> | null = null;

const statusFilters: Array<InstallationStatus | "all" | "queue"> = [
  "all",
  "queue",
  "not_scheduled",
  "assigned",
  "in_progress",
  "arrived",
  "review_pending",
  "needs_revision",
  "completed",
  "no_installation",
];

const statusFilterLabels: Record<InstallationStatus | "all" | "queue", string> = {
  all: "Все",
  queue: "Готовы",
  ...installationStatusLabels,
};

const minPlannerHour = 0;
const maxPlannerHour = 24;
const fullPlannerHourRange = { start: minPlannerHour, end: maxPlannerHour };
const defaultPlannerZoom = 1;
const minPlannerZoom = 0.65;
const maxPlannerZoom = 5.5;

export function InstallationsApp({
  currentUser,
  deals,
  saveApiUrl = "",
  storedInstallations,
  storedProduction,
  techSpecs,
  onChange,
  onOpenDeal,
  onRefresh,
  onLogout,
}: InstallationsAppProps) {
  const [dateKey, setDateKey] = useState(todayDateKey());
  const [viewMode, setViewMode] = useState<InstallationViewMode>("day");
  const [plannerZoom, setPlannerZoom] = useState(defaultPlannerZoom);
  const [mobileTab, setMobileTab] = useState<InstallationMobileTab>("today");
  const [query, setQuery] = useState("");
  const [installerFilter, setInstallerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<InstallationStatus | "all" | "queue">("all");
  const [editing, setEditing] = useState<InstallationFormState>();
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [uploadState, setUploadState] = useState<Record<string, UploadState>>({});
  const [routePointIds, setRoutePointIds] = useState<string[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const installations = storedInstallations.installations || [];
  const notifications = storedInstallations.notifications || [];
  const installers = useMemo(
    () => storedProduction.employees.filter(isInstaller).sort((first, second) => first.name.localeCompare(second.name)),
    [storedProduction.employees],
  );
  const dealsById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);
  const installationsByDeal = useMemo(() => {
    const map = new Map<string, Installation>();
    for (const deal of deals) {
      const installation = installationForDeal(installations, deal.id);
      if (installation) map.set(deal.id, installation);
    }
    return map;
  }, [deals, installations]);

  const readyDeals = useMemo(
    () =>
      deals
        .filter((deal) => isDealReadyForInstallation(deal, storedProduction.assignments, techSpecs.get(deal.id)))
        .filter((deal) => !installationsByDeal.get(deal.id) || installationsByDeal.get(deal.id)?.status === "not_scheduled")
        .sort((first, second) => (first.expectedFinishDate || "").localeCompare(second.expectedFinishDate || "")),
    [deals, installationsByDeal, storedProduction.assignments, techSpecs],
  );

  const isMobileInstaller = isInstaller(currentUser);
  const canReview = ["leader", "technologist", "shopChief", "installationChief"].includes(accessRoleFor(currentUser));
  const unreadNotifications = notifications.filter((notification) => !notification.readBy?.includes(currentUser.id));
  const visibleNotifications = notifications
    .filter((notification) => !notification.targetEmployeeId || notification.targetEmployeeId === currentUser.id || canReview)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

  const filteredInstallations = useMemo(() => {
    const byFilters = installations
      .filter((installation) => {
        if (isMobileInstaller && installation.installerId !== currentUser.id) return false;
        if (installerFilter !== "all" && installation.installerId !== installerFilter) return false;
        if (statusFilter !== "all" && statusFilter !== "queue" && installation.status !== statusFilter) return false;
        if (!isMobileInstaller && !isInstallationVisibleInPlanner(installation, viewMode, dateKey)) return false;
        return true;
      })
      .sort(compareInstallations);

    return rankBySearchIndex(byFilters, query, installationSearchIndex);
  }, [currentUser.id, dateKey, installerFilter, installations, isMobileInstaller, query, statusFilter, viewMode]);

  const selectedInstallation = selectedInstallationId
    ? installations.find((installation) => installation.id === selectedInstallationId)
    : undefined;
  const mapPoints = useMemo(
    () => buildInstallationMapPoints(filteredInstallations, readyDeals),
    [filteredInstallations, readyDeals],
  );
  const plannerHourRange = fullPlannerHourRange;
  const plannerHourSlots = useMemo(() => buildPlannerHourSlots(fullPlannerHourRange), []);

  useEffect(() => {
    setRoutePointIds((current) => current.filter((id) => mapPoints.some((point) => point.id === id)));
  }, [mapPoints]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeMenuOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && mobileMenuRef.current?.contains(target)) return;
      setMobileMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenuOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsidePress);
  }, [mobileMenuOpen]);

  if (isMobileInstaller) {
    const todayInstallations = filteredInstallations.filter((installation) => installationDateKey(installation.date) === dateKey);
    const list = mobileTab === "today" ? todayInstallations : filteredInstallations;
    return (
      <main className="installations-app installations-mobile" aria-label="Монтажи">
        <div className="worker-mobile-brand installation-mobile-brand" aria-label="Verkup">
          <span>
            <img alt="Verkup" src={`${import.meta.env.BASE_URL}verkup-logo-vector.svg`} />
          </span>
        </div>
        <InstallationMobileHeader
          currentUser={currentUser}
          menuOpen={mobileMenuOpen}
          menuRef={mobileMenuRef}
          unreadCount={unreadNotifications.length}
          onLogout={onLogout}
          onMenuToggle={() => setMobileMenuOpen((current) => !current)}
          onRefresh={() => {
            setMobileMenuOpen(false);
            void onRefresh?.();
          }}
          onSelectTab={(tab) => {
            setMobileTab(tab);
            setMobileMenuOpen(false);
          }}
        />
        <nav className="installation-mobile-tabs" aria-label="Разделы монтажника">
          <button className={mobileTab === "today" ? "active" : ""} onClick={() => setMobileTab("today")} type="button">
            Сегодня <span>{todayInstallations.length}</span>
          </button>
          <button className={mobileTab === "all" ? "active" : ""} onClick={() => setMobileTab("all")} type="button">
            Монтажи <span>{filteredInstallations.length}</span>
          </button>
          <button
            className={mobileTab === "notifications" ? "active" : ""}
            onClick={() => setMobileTab("notifications")}
            type="button"
          >
            Уведомления <span>{unreadNotifications.length}</span>
          </button>
          <button className={mobileTab === "profile" ? "active" : ""} onClick={() => setMobileTab("profile")} type="button">
            Профиль
          </button>
        </nav>

        {mobileTab === "today" || mobileTab === "all" ? (
          <section className="installation-mobile-controls">
            <div className="installation-mobile-date">
              <button aria-label="Предыдущий день" onClick={() => shiftDate(-1)} type="button">←</button>
              <input aria-label="Дата монтажей" type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
              <button aria-label="Следующий день" onClick={() => shiftDate(1)} type="button">→</button>
            </div>
            <label className="installation-mobile-search">
              <Search size={18} />
              <input
                placeholder="Поиск по сделке, адресу"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </section>
        ) : null}

        {toast ? <div className="installation-toast">{toast}</div> : null}

        {mobileTab === "notifications" ? (
          <NotificationList
            currentUser={currentUser}
            notifications={visibleNotifications}
            saveApiUrl={saveApiUrl}
            storedInstallations={storedInstallations}
            onChange={onChange}
            onOpen={(id) => {
              setSelectedInstallationId(id);
              setMobileTab("all");
            }}
          />
        ) : mobileTab === "profile" ? (
          <InstallationMobileProfile
            allCount={filteredInstallations.length}
            currentUser={currentUser}
            onLogout={onLogout}
            onRefresh={() => void onRefresh?.()}
            onSelectTab={setMobileTab}
            todayCount={todayInstallations.length}
            unreadCount={unreadNotifications.length}
          />
        ) : (
          <section className="installation-card-list">
            {list.length ? (
              list.map((installation) => (
                <InstallationWorkerCard
                  canReview={false}
                  currentUser={currentUser}
                  installation={installation}
                  key={installation.id}
                  onAction={handleStatusAction}
                  onPhotoDelete={handlePhotoDelete}
                  onPhotoUpload={handlePhotoUpload}
                  selected={selectedInstallationId === installation.id}
                  setSelected={() => setSelectedInstallationId((current) => (current === installation.id ? undefined : installation.id))}
                  uploadState={uploadState[installation.id]}
                />
              ))
            ) : (
              <EmptyState text="На выбранный день монтажей нет." />
            )}
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="installations-app" aria-label="Монтажи">
      <header className="installations-toolbar">
        <div>
          <span className="eyebrow">Планирование</span>
          <h1>Монтажи</h1>
        </div>
        <div className="installations-toolbar-actions">
          <button className="secondary compact" onClick={() => void onRefresh?.()} type="button">
            <RefreshCcw size={16} />
            Обновить
          </button>
        </div>
      </header>

      <section className="installations-filters">
        <label>
          <Search size={16} />
          <input
            placeholder="Поиск по сделке, адресу, клиенту"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select value={installerFilter} onChange={(event) => setInstallerFilter(event.target.value)}>
          <option value="all">Все монтажники</option>
          {installers.map((installer) => (
            <option key={installer.id} value={installer.id}>
              {installer.name}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InstallationStatus | "all" | "queue")}>
          {statusFilters.map((status) => (
            <option key={status} value={status}>
              {statusFilterLabels[status]}
            </option>
          ))}
        </select>
      </section>

      <section className="installations-summary-grid">
        <SummaryCard label="Готовы к отгрузке" value={readyDeals.length} />
        <SummaryCard label="Сегодня" value={installations.filter((item) => installationDateKey(item.date) === dateKey).length} />
        <SummaryCard label="На проверке" value={installations.filter((item) => item.status === "review_pending").length} />
        <SummaryCard label="Проблемы" value={installations.filter((item) => item.status === "needs_revision").length} />
      </section>

      {toast ? <div className="installation-toast">{toast}</div> : null}

      <section className="installations-layout">
        <aside className="installations-queue">
          <div className="installations-section-head">
            <h2>Готовы к отгрузке / монтажу</h2>
            <span>{readyDeals.length}</span>
          </div>
          {readyDeals.length ? (
            readyDeals.map((deal) => (
              <ReadyDealCard
                deal={deal}
                key={deal.id}
                onCreate={() => setEditing(formStateFromDeal(deal, dateKey))}
                onOpenDeal={onOpenDeal}
              />
            ))
          ) : (
            <EmptyState text="Готовых монтажных сделок пока нет." />
          )}
        </aside>

        <section className="installations-board">
          <div className="installations-board-top">
            <div className="installations-section-head">
              <h2>{plannerTitle(viewMode, dateKey)}</h2>
              <button className="primary compact" onClick={() => setEditing(emptyForm(dateKey))} type="button">
                <Plus size={16} />
                Создать монтаж
              </button>
            </div>
            <div className="installation-planner-toolbar" aria-label="Управление планом монтажей">
              <div className="installation-date-control">
                <button onClick={() => shiftDate(-1)} type="button">←</button>
                <input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
                <button onClick={() => shiftDate(1)} type="button">→</button>
                <button onClick={() => setDateKey(todayDateKey())} type="button">Сегодня</button>
              </div>
              <div className="installation-view-switch compact" role="group" aria-label="День и неделя">
                <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")} type="button">
                  День
                </button>
                <button className={viewMode === "week" ? "active" : ""} onClick={() => setViewMode("week")} type="button">
                  Неделя
                </button>
              </div>
              <div className="installation-month-view-control">
                <input
                  aria-label="Месяц монтажей"
                  type="month"
                  value={monthInputValue(dateKey)}
                  onChange={(event) => setMonthValue(event.target.value)}
                />
                <div className="installation-view-switch compact" role="group" aria-label="Месяц и год">
                  <button className={viewMode === "month" ? "active" : ""} onClick={() => setViewMode("month")} type="button">
                    Месяц
                  </button>
                  <button className={viewMode === "year" ? "active" : ""} onClick={() => setViewMode("year")} type="button">
                    Год
                  </button>
                </div>
              </div>
              <button
                className={`installation-list-mode-button ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                type="button"
              >
                Список монтажей
              </button>
            </div>
          </div>
          {viewMode !== "list" ? (
            <InstallationPlannerTimeline
              dateKey={dateKey}
              installers={installers}
              installations={filteredInstallations}
              plannerHourRange={plannerHourRange}
              plannerHourSlots={plannerHourSlots}
              plannerZoom={plannerZoom}
              selectedInstallationId={selectedInstallationId}
              viewMode={viewMode}
              onMonthSelect={(monthDateKey) => {
                setDateKey(monthDateKey);
                setViewMode("month");
              }}
              onEdit={(installation) => setEditing(formStateFromInstallation(installation))}
              onWheel={handlePlannerWheel}
              onSelect={(installation) => setSelectedInstallationId(installation.id)}
            />
          ) : (
            <section className="installation-card-list desktop-list">
              {filteredInstallations.length ? (
                filteredInstallations.map((installation) => (
                  <InstallationPlannerCard
                    canReview={canReview}
                    installation={installation}
                    key={installation.id}
                    onAction={handleStatusAction}
                    onDelete={handleDeleteInstallation}
                    onEdit={() => setEditing(formStateFromInstallation(installation))}
                    onOpenDeal={onOpenDeal}
                    onPhotoDelete={handlePhotoDelete}
                    selected={selectedInstallationId === installation.id}
                    setSelected={() => setSelectedInstallationId((current) => (current === installation.id ? undefined : installation.id))}
                  />
                ))
              ) : (
                <EmptyState text="Монтажей по фильтрам нет." />
              )}
            </section>
          )}
        </section>

        <aside className="installations-notifications">
          <NotificationList
            currentUser={currentUser}
            notifications={visibleNotifications}
            saveApiUrl={saveApiUrl}
            storedInstallations={storedInstallations}
            onChange={onChange}
            onOpen={(id) => setSelectedInstallationId(id)}
          />
        </aside>
      </section>

      <InstallationMapPanel
        points={mapPoints}
        routePointIds={routePointIds}
        onEditInstallation={(installationId) => {
          const installation = installations.find((item) => item.id === installationId);
          if (installation) setEditing(formStateFromInstallation(installation));
        }}
        onOpenDeal={onOpenDeal}
        onRoutePointToggle={(pointId) =>
          setRoutePointIds((current) =>
            current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId],
          )
        }
        onRouteReset={() => setRoutePointIds([])}
        onRouteSelectAll={() => setRoutePointIds(mapPoints.filter((point) => isRouteableMapPoint(point)).map((point) => point.id))}
      />

      {selectedInstallation ? (
        <InstallationDetails
          canReview={canReview}
          currentUser={currentUser}
          installation={selectedInstallation}
          onAction={handleStatusAction}
          onClose={() => setSelectedInstallationId(undefined)}
          onDelete={handleDeleteInstallation}
          onEdit={() => setEditing(formStateFromInstallation(selectedInstallation))}
          onOpenDeal={onOpenDeal}
          onPhotoDelete={handlePhotoDelete}
        />
      ) : null}

      {editing ? (
        <InstallationEditor
          deals={deals}
          installers={installers}
          saving={saving}
          saveApiUrl={saveApiUrl}
          state={editing}
          onCancel={() => setEditing(undefined)}
          onChange={setEditing}
          onSave={handleSaveInstallation}
        />
      ) : null}
    </main>
  );

  function shiftDate(offset: number) {
    if (viewMode === "year") {
      setDateKey(addYearsToDateKey(dateKey, offset));
      return;
    }
    if (viewMode === "month") {
      setDateKey(addMonthsToDateKey(dateKey, offset));
      return;
    }
    setDateKey(addDaysToDateKey(dateKey, viewMode === "week" ? offset * 15 : offset));
  }

  function handlePlannerWheel({ container, event }: PlannerWheelContext) {
    if (Math.abs(event.deltaY) < 1) return;
    event.preventDefault();
    event.stopPropagation();
    const zoomOut = event.deltaY > 0;
    const shiftRange = event.shiftKey || event.altKey;

    if (shiftRange) {
      if (viewMode === "day") {
        setDateKey((current) => addDaysToDateKey(current, zoomOut ? 1 : -1));
        return;
      }

      if (viewMode === "week") {
        setDateKey((current) => addDaysToDateKey(current, zoomOut ? 15 : -15));
        return;
      }

      if (viewMode === "month") {
        setDateKey((current) => addMonthsToDateKey(current, zoomOut ? 1 : -1));
        return;
      }

      if (viewMode === "year") {
        setDateKey((current) => addYearsToDateKey(current, zoomOut ? 1 : -1));
      }
      return;
    }

    if (viewMode === "day") {
      const scheduler = container.querySelector<HTMLElement>(".installation-scheduler");
      const pointerRatio = scheduler ? plannerPointerRatio(scheduler, event.clientX) : 0.5;
      const nextZoom = adjustPlannerZoom(plannerZoom, event.deltaY);
      setPlannerZoom(nextZoom);

      if (scheduler) {
        window.requestAnimationFrame(() => keepPlannerPointerPosition(scheduler, pointerRatio, event.clientX));
      }
      return;
    }

    if (viewMode === "week") {
      if (!zoomOut && plannerZoom >= maxPlannerZoom * 0.98) {
        setViewMode("day");
        return;
      }
      setPlannerZoom((current) => adjustPlannerZoom(current, event.deltaY));
      return;
    }

    if (viewMode === "month") {
      setPlannerZoom((current) => adjustPlannerZoom(current, event.deltaY));
      return;
    }

    if (viewMode === "year") {
      setDateKey((current) => addYearsToDateKey(current, zoomOut ? 1 : -1));
    }
  }

  function setMonthValue(value: string) {
    if (!value) return;
    setDateKey(dateKeyFromMonthInput(value, dateKey));
    if (viewMode === "day" || viewMode === "week") setViewMode("month");
  }

  async function handleSaveInstallation(state: InstallationFormState) {
    setSaving(true);
    try {
      const resolvedState = resolveInstallationFormState(state, deals);
      if (!resolvedState.dealId) {
        throw new Error("Укажите номер сделки для монтажа.");
      }
      const payload = {
        actor: currentUser.name,
        actorId: currentUser.id,
        address: resolvedState.address,
        addressEdited: resolvedState.addressSource === "manual",
        addressSource: resolvedState.addressSource || (resolvedState.address ? "manual" : undefined),
        clientName: resolvedState.clientName,
        clientPhone: resolvedState.clientPhone,
        comment: resolvedState.comment,
        date: resolvedState.date,
        dealId: resolvedState.dealId,
        dealNumber: resolvedState.dealNumber,
        dealTitle: resolvedState.dealTitle,
        installerId: resolvedState.installerId,
        installerName: installers.find((installer) => installer.id === resolvedState.installerId)?.name || "",
        status: resolvedState.installerId ? "assigned" : "not_scheduled",
        sourceFiles: resolvedState.sourceFiles || [],
        timeFrom: resolvedState.timeFrom,
        timeTo: resolvedState.timeTo,
      } as const;

      if (saveApiUrl) {
        const result = resolvedState.id
          ? await updateInstallation({ apiUrl: saveApiUrl }, resolvedState.id, payload)
          : await createInstallation({ apiUrl: saveApiUrl }, payload);
        onChange(result.data, { saveNow: true });
      } else {
        onChange(upsertLocalInstallation(storedInstallations, resolvedState.id, payload), { saveNow: true });
      }
      setEditing(undefined);
      showToast("Монтаж сохранен");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось сохранить монтаж");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusAction(installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) {
    try {
      const installerLocation =
        action === "start" || action === "arrive" ? await getInstallerLocationSnapshot() : undefined;
      if (saveApiUrl) {
        const result = await changeInstallationStatus({ apiUrl: saveApiUrl }, installation.id, action, {
          actor: currentUser.name,
          actorId: currentUser.id,
          installerLocation,
          note,
          resultComment: action === "complete" ? note : undefined,
          returnComment: action === "return" ? note : undefined,
        });
        onChange(result.data, { saveNow: true });
      } else {
        onChange(updateLocalInstallationStatus(storedInstallations, installation.id, action, currentUser, note, installerLocation), { saveNow: true });
      }
      showToast(statusActionSuccess(action));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось изменить статус");
    }
  }

  async function handlePhotoUpload(installation: Installation, files: FileList | File[], type: InstallationPhotoType = "after") {
    const fileList = Array.from(files);
    if (!fileList.length) return;
    setUploadState((current) => ({
      ...current,
      [installation.id]: { status: "uploading", message: `Загрузка ${fileList.length} фото...` },
    }));
    try {
      let latestData: StoredInstallations | undefined;
      for (const file of fileList) {
        const result = await uploadInstallationPhoto({ apiUrl: saveApiUrl }, {
          actor: currentUser.name,
          actorId: currentUser.id,
          dealId: installation.dealId,
          file,
          installationId: installation.id,
          type,
        });
        latestData = result.data;
      }
      if (latestData) onChange(latestData, { saveNow: true });
      setUploadState((current) => ({
        ...current,
        [installation.id]: { status: "success", message: "Фото добавлено" },
      }));
      showToast("Фото добавлено");
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        [installation.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "Фото не загрузилось",
        },
      }));
    }
  }

  async function handlePhotoDelete(installation: Installation, photo: InstallationPhoto) {
    try {
      if (saveApiUrl) {
        const result = await deleteInstallationPhoto({ apiUrl: saveApiUrl }, {
          installationId: installation.id,
          photoId: photo.id,
        });
        onChange(result.data, { saveNow: true });
      } else {
        onChange(removeLocalInstallationPhoto(storedInstallations, installation.id, photo.id), { saveNow: true });
      }
      showToast("Фото удалено");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось удалить фото");
    }
  }

  async function handleDeleteInstallation(installation: Installation) {
    const label = `#${installation.dealNumber || installation.dealId} ${installation.dealTitle || ""}`.trim();
    if (!window.confirm(`Удалить монтаж ${label}? Фото и уведомления по этому монтажу тоже будут удалены.`)) return;
    try {
      if (saveApiUrl) {
        const result = await deleteInstallation({ apiUrl: saveApiUrl }, installation.id, {
          actor: currentUser.name,
          actorId: currentUser.id,
        });
        onChange(result.data, { saveNow: true });
      } else {
        onChange(removeLocalInstallation(storedInstallations, installation.id), { saveNow: true });
      }
      setSelectedInstallationId((current) => (current === installation.id ? undefined : current));
      showToast("Монтаж удален");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Не удалось удалить монтаж");
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }
}

function InstallationMobileHeader({
  currentUser,
  menuOpen,
  menuRef,
  unreadCount,
  onLogout,
  onMenuToggle,
  onRefresh,
  onSelectTab,
}: {
  currentUser: ProductionEmployee;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement>;
  unreadCount: number;
  onLogout?: () => void;
  onMenuToggle: () => void;
  onRefresh: () => void;
  onSelectTab: (tab: InstallationMobileTab) => void;
}) {
  return (
    <header className="installation-mobile-header">
      <div className="worker-avatar">
        {currentUser.avatarDataUrl ? <img alt={currentUser.name} src={currentUser.avatarDataUrl} /> : initialsFor(currentUser.name)}
      </div>
      <div>
        <strong>{currentUser.name}</strong>
        <span>Монтажник</span>
      </div>
      <button
        aria-label="Уведомления"
        className="installation-bell"
        onClick={() => onSelectTab("notifications")}
        type="button"
      >
        <Bell size={20} />
        {unreadCount ? <span>{unreadCount}</span> : null}
      </button>
      <div className="worker-profile-menu-wrap installation-mobile-menu-wrap" ref={menuRef}>
        <button
          aria-expanded={menuOpen}
          aria-label="Меню монтажника"
          className="worker-profile-menu-trigger installation-mobile-menu-trigger"
          onClick={onMenuToggle}
          type="button"
        >
          <Menu size={22} />
        </button>
        {menuOpen ? (
          <div className="worker-profile-menu installation-mobile-menu">
            <button onClick={() => onSelectTab("today")} type="button">
              <CalendarDays size={16} />
              <span>Сегодня</span>
              <ChevronRight className="worker-menu-chevron" size={16} />
            </button>
            <button onClick={() => onSelectTab("all")} type="button">
              <ClipboardList size={16} />
              <span>Все монтажи</span>
              <ChevronRight className="worker-menu-chevron" size={16} />
            </button>
            <button onClick={() => onSelectTab("notifications")} type="button">
              <Bell size={16} />
              <span>Уведомления</span>
              {unreadCount ? <em>{unreadCount}</em> : null}
              <ChevronRight className="worker-menu-chevron" size={16} />
            </button>
            <button onClick={onRefresh} type="button">
              <RefreshCcw size={16} />
              <span>Обновить</span>
            </button>
            <button onClick={() => onSelectTab("profile")} type="button">
              <UserRound size={16} />
              <span>Профиль</span>
              <ChevronRight className="worker-menu-chevron" size={16} />
            </button>
            {onLogout ? (
              <button className="worker-menu-danger" onClick={onLogout} type="button">
                <LogOut size={16} />
                <span>Выйти</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function InstallationMobileProfile({
  allCount,
  currentUser,
  onLogout,
  onRefresh,
  onSelectTab,
  todayCount,
  unreadCount,
}: {
  allCount: number;
  currentUser: ProductionEmployee;
  onLogout?: () => void;
  onRefresh: () => void;
  onSelectTab: (tab: InstallationMobileTab) => void;
  todayCount: number;
  unreadCount: number;
}) {
  return (
    <section className="installation-mobile-profile">
      <div className="installation-profile-summary">
        <div className="worker-avatar">
          {currentUser.avatarDataUrl ? <img alt={currentUser.name} src={currentUser.avatarDataUrl} /> : initialsFor(currentUser.name)}
        </div>
        <div>
          <h2>{currentUser.name}</h2>
          <span>Монтажник</span>
        </div>
      </div>
      <div className="installation-profile-stats">
        <div>
          <span>Сегодня</span>
          <strong>{todayCount}</strong>
        </div>
        <div>
          <span>Всего</span>
          <strong>{allCount}</strong>
        </div>
        <div>
          <span>Новые</span>
          <strong>{unreadCount}</strong>
        </div>
      </div>
      <div className="installation-profile-actions">
        <button onClick={() => onSelectTab("today")} type="button">
          <CalendarDays size={18} />
          <span>Монтажи на день</span>
          <ChevronRight size={17} />
        </button>
        <button onClick={() => onSelectTab("all")} type="button">
          <ClipboardList size={18} />
          <span>Все мои монтажи</span>
          <ChevronRight size={17} />
        </button>
        <button onClick={() => onSelectTab("notifications")} type="button">
          <Bell size={18} />
          <span>Уведомления</span>
          {unreadCount ? <em>{unreadCount}</em> : null}
          <ChevronRight size={17} />
        </button>
        <button onClick={onRefresh} type="button">
          <RefreshCcw size={18} />
          <span>Обновить данные</span>
        </button>
        {onLogout ? (
          <button className="danger" onClick={onLogout} type="button">
            <LogOut size={18} />
            <span>Выйти</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="installation-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InstallationMapPanel({
  points,
  routePointIds,
  onEditInstallation,
  onOpenDeal,
  onRoutePointToggle,
  onRouteReset,
  onRouteSelectAll,
}: {
  points: InstallationMapPoint[];
  routePointIds: string[];
  onEditInstallation: (installationId: string) => void;
  onOpenDeal?: (dealId: string, target: "cost" | "techSpec") => void;
  onRoutePointToggle: (pointId: string) => void;
  onRouteReset: () => void;
  onRouteSelectAll: () => void;
}) {
  const routeablePoints = points.filter(isRouteableMapPoint);
  const installerPoints = points.filter((point) => point.kind === "installer");
  const routePoints = routeablePoints.filter((point) => routePointIds.includes(point.id));
  const selectedDealIds = new Set(routePoints.map((point) => point.dealId));
  const visibleMapPoints = routePoints.length
    ? [
        ...routePoints,
        ...installerPoints.filter((point) => selectedDealIds.has(point.dealId)),
      ]
    : points;
  const routeLink = buildYandexRouteLink(routePoints.length >= 2 ? routePoints : routePoints.length === 1 ? routePoints : routeablePoints.slice(0, 2));

  return (
    <section className="installation-map-panel">
      <div className="installations-section-head">
        <div>
          <h2>Карта монтажей</h2>
          <p>Адреса готовых сделок и назначенных монтажей. Адрес можно поправить в форме назначения.</p>
        </div>
        <span>{routeablePoints.length}</span>
      </div>
      <div className="installation-map-layout">
        <aside className="installation-map-sidebar" aria-label="Адреса на карте">
          <div className="installation-map-actions">
            <button className="secondary compact" disabled={!routeablePoints.length} onClick={onRouteSelectAll} type="button">
              Все точки
            </button>
            <button className="secondary compact" disabled={!routePointIds.length} onClick={onRouteReset} type="button">
              Сбросить
            </button>
            {routeLink ? (
              <a className="primary compact" href={routeLink} target="_blank" rel="noreferrer">
                <Navigation size={16} />
                Маршрут
              </a>
            ) : null}
          </div>
          <div className="installation-map-list">
            {routeablePoints.length ? (
              routeablePoints.map((point) => (
                <article className={`installation-map-item status-${point.status} ${routePointIds.includes(point.id) ? "selected" : ""}`} key={point.id}>
                  <label>
                    <input
                      checked={routePointIds.includes(point.id)}
                      onChange={() => onRoutePointToggle(point.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{point.title}</strong>
                      <small>{point.address}</small>
                    </span>
                  </label>
                  <div>
                    <em>{point.statusLabel}</em>
                    {point.time ? <time>{point.time}</time> : null}
                  </div>
                  <footer>
                    {point.kind === "installation" ? (
                      <button className="ghost compact" onClick={() => onEditInstallation(point.id)} type="button">
                        Адрес
                      </button>
                    ) : (
                      <span>Из Bitrix</span>
                    )}
                    {onOpenDeal ? (
                      <button className="ghost compact" onClick={() => onOpenDeal(point.dealId, "techSpec")} type="button">
                        ТЗ
                      </button>
                    ) : null}
                  </footer>
                </article>
              ))
            ) : (
              <EmptyState text="Адресов для карты пока нет. Проверьте поле адреса в Bitrix или назначьте монтаж вручную." />
            )}
          </div>
        </aside>
        <YandexInstallationsMap points={visibleMapPoints} routePoints={routePoints} />
      </div>
    </section>
  );
}

function YandexInstallationsMap({
  points,
  routePoints,
}: {
  points: InstallationMapPoint[];
  routePoints: InstallationMapPoint[];
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const collectionRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const [error, setError] = useState("");
  const signature = points
    .map((point) => `${point.id}:${point.address}:${point.coordinates?.join(",") || ""}:${point.status}`)
    .join("|");
  const routeSignature = routePoints
    .map((point) => `${point.id}:${point.address}:${point.coordinates?.join(",") || ""}`)
    .join("|");

  useEffect(() => {
    if (!YANDEX_MAPS_API_KEY || !mapElementRef.current) return;
    let disposed = false;

    loadYandexMaps(YANDEX_MAPS_API_KEY)
      .then((ymaps) => {
        ymaps.ready(async () => {
          if (disposed || !mapElementRef.current) return;
          setError("");
          if (!mapRef.current) {
            mapRef.current = new ymaps.Map(mapElementRef.current, {
              center: MOSCOW_CENTER,
              controls: ["zoomControl", "fullscreenControl"],
              zoom: 10,
            });
          }

          const map = mapRef.current;
          if (collectionRef.current) map.geoObjects.remove(collectionRef.current);
          if (routeRef.current) map.geoObjects.remove(routeRef.current);

          const collection = new ymaps.GeoObjectCollection();
          const geocoded = await Promise.all(
            points.map(async (point) => {
              try {
                if (point.coordinates) return { coordinates: point.coordinates, point };
                const coordinates = await geocodeInstallationAddress(ymaps, point.address);
                return coordinates ? { coordinates, point } : undefined;
              } catch {
                return undefined;
              }
            }),
          );

          let selectedPlacemark: any = null;
          const selectedRoutePointIds = new Set(routePoints.map((point) => point.id));
          for (const item of geocoded.filter(Boolean) as Array<{ coordinates: number[]; point: InstallationMapPoint }>) {
            const isSelected = selectedRoutePointIds.has(item.point.id);
            const preset =
              item.point.kind === "installer"
                ? "islands#greenPersonIcon"
                : isSelected
                  ? "islands#orangeDotIcon"
                  : item.point.kind === "readyDeal"
                    ? "islands#orangeDotIcon"
                    : "islands#blueDotIcon";
            const placemark = new ymaps.Placemark(
              item.coordinates,
              {
                balloonContent: `<strong>${escapeHtml(item.point.title)}</strong><br>${escapeHtml(item.point.address)}<br>${escapeHtml(item.point.statusLabel)}`,
                hintContent: item.point.title,
              },
              {
                preset,
              },
            );
            if (isSelected && routePoints.length === 1) selectedPlacemark = placemark;
            collection.add(placemark);
          }

          if (points.length && !collection.getLength()) {
            setError("Не удалось найти адрес на карте. Проверьте адрес в карточке монтажа.");
            return;
          }

          setError("");

          map.geoObjects.add(collection);
          collectionRef.current = collection;

          if (routePoints.length === 1 && selectedPlacemark) {
            const coordinates = selectedPlacemark.geometry.getCoordinates();
            const centerResult = map.setCenter(coordinates, 14, { duration: 200 });
            if (centerResult?.catch) centerResult.catch(() => undefined);
            window.setTimeout(() => selectedPlacemark.balloon.open(), 180);
          } else if (routePoints.length >= 2) {
            routeRef.current = new ymaps.multiRouter.MultiRoute(
              {
                params: { routingMode: "auto" },
                referencePoints: routePoints.map((point) => point.coordinates || point.address),
              },
              {
                boundsAutoApply: true,
                wayPointStartIconColor: "#ff7900",
                wayPointFinishIconColor: "#ff7900",
              },
            );
            map.geoObjects.add(routeRef.current);
          } else if (collection.getLength()) {
            const boundsResult = map.setBounds(collection.getBounds(), { checkZoomRange: true, zoomMargin: 42 });
            if (boundsResult?.catch) boundsResult.catch(() => undefined);
          }
        });
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить Яндекс.Карты");
      });

    return () => {
      disposed = true;
    };
  }, [signature, routeSignature]);

  if (!YANDEX_MAPS_API_KEY) {
    return (
      <div className="installation-map-fallback">
        <MapPin size={28} />
        <strong>Ключ Яндекс.Карт не настроен</strong>
        <span>Добавьте VITE_YANDEX_MAPS_API_KEY при сборке, и здесь появится интерактивная карта.</span>
        {points[0] ? (
          <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(points[0].address)}`} target="_blank" rel="noreferrer">
            Открыть первый адрес
          </a>
        ) : null}
      </div>
    );
  }

  if (error) {
    return (
      <div className="installation-map-fallback">
        <MapPin size={28} />
        <strong>Карта временно недоступна</strong>
        <span>{error}</span>
      </div>
    );
  }

  return <div className="installation-yandex-map" ref={mapElementRef} aria-label="Яндекс карта монтажей" />;
}

function ReadyDealCard({
  deal,
  onCreate,
  onOpenDeal,
}: {
  deal: Deal;
  onCreate: () => void;
  onOpenDeal?: (dealId: string, target: "cost" | "techSpec") => void;
}) {
  return (
    <article className="ready-installation-card">
      <div>
        <a href={deal.bitrixUrl || undefined} target="_blank" rel="noreferrer">#{deal.number}</a>
        <strong>{deal.title || "Без названия"}</strong>
        <span>{deal.type || "Тип не указан"}</span>
        {deal.installationAddress ? <span><MapPin size={13} /> {deal.installationAddress}</span> : <span>Адрес монтажа не указан</span>}
        <span>Срок: {formatInstallationDate(deal.expectedFinishDate)}</span>
        {deal.installationFiles?.length ? <span>Файлы Bitrix: {deal.installationFiles.length}</span> : null}
      </div>
      <div className="ready-installation-actions">
        <button className="primary compact" onClick={onCreate} type="button">Назначить</button>
        {onOpenDeal ? (
          <button className="secondary compact" onClick={() => onOpenDeal(deal.id, "techSpec")} type="button">ТЗ</button>
        ) : null}
      </div>
    </article>
  );
}

function InstallationPlannerTimeline({
  dateKey,
  installers,
  installations,
  plannerHourRange,
  plannerHourSlots,
  plannerZoom,
  selectedInstallationId,
  viewMode,
  onMonthSelect,
  onEdit,
  onWheel,
  onSelect,
}: {
  dateKey: string;
  installers: ProductionEmployee[];
  installations: Installation[];
  plannerHourRange: PlannerHourRange;
  plannerHourSlots: number[];
  plannerZoom: number;
  selectedInstallationId?: string;
  viewMode: Exclude<InstallationViewMode, "list">;
  onMonthSelect: (dateKey: string) => void;
  onEdit: (installation: Installation) => void;
  onWheel: (context: PlannerWheelContext) => void;
  onSelect: (installation: Installation) => void;
}) {
  const plannerShellRef = useRef<HTMLDivElement>(null);
  const unplanned = installations.filter(isUnplannedInstallation);
  const planned = installations.filter((installation) => !isUnplannedInstallation(installation));

  useEffect(() => {
    const node = plannerShellRef.current;
    if (!node) return;

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      onWheel({ container: node, event });
    };

    node.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleNativeWheel);
  }, [onWheel]);

  if (viewMode === "month") {
    return (
      <div className="installation-planner-shell" ref={plannerShellRef}>
        <MonthPlanner
          dateKey={dateKey}
          installations={planned}
          selectedInstallationId={selectedInstallationId}
          onEdit={onEdit}
          onSelect={onSelect}
        />
        <PlannerUnplannedPanel
          installations={unplanned}
          selectedInstallationId={selectedInstallationId}
          onEdit={onEdit}
          onSelect={onSelect}
        />
      </div>
    );
  }

  if (viewMode === "year") {
    return (
      <div className="installation-planner-shell" ref={plannerShellRef}>
        <YearPlanner
          dateKey={dateKey}
          installations={planned}
          onMonthSelect={onMonthSelect}
        />
        <PlannerUnplannedPanel
          installations={unplanned}
          selectedInstallationId={selectedInstallationId}
          onEdit={onEdit}
          onSelect={onSelect}
        />
      </div>
    );
  }

  const lanes: PlannerLane[] = [
    { id: "unassigned", name: "Неназначенные", unassigned: true },
    ...installers.map((installer) => ({ id: installer.id, name: installer.name })),
  ];
  const periodDays = viewMode === "week" ? dateKeysBetween(plannerRange("week", dateKey).start, plannerRange("week", dateKey).end) : [dateKey];
  const schedulerStyle =
    viewMode === "day"
      ? (() => {
          const hourWidth = Math.max(32, Math.round(54 * plannerZoom), Math.ceil(760 / plannerHourSlots.length));
          return {
            "--planner-hour-columns": plannerHourSlots.length,
            "--planner-hour-width": `${hourWidth}px`,
            "--planner-track-width": `${plannerHourSlots.length * hourWidth}px`,
          } as CSSProperties;
        })()
      : (() => {
          const dayWidth = Math.max(118, Math.ceil(900 / periodDays.length));
          return {
            "--planner-day-columns": periodDays.length,
            "--planner-day-width": `${dayWidth}px`,
            "--planner-track-width": `${periodDays.length * dayWidth}px`,
          } as CSSProperties;
        })();
  const schedulerGridStyle = {
    ...schedulerStyle,
    gridTemplateRows: `34px repeat(${Math.max(lanes.length, 1)}, var(--planner-row-height, 92px))`,
  } as CSSProperties;

  return (
    <div className="installation-planner-shell" ref={plannerShellRef}>
      <div
        className={`installation-scheduler installation-scheduler-${viewMode}`}
        style={schedulerGridStyle}
      >
        <div className="planner-corner">Монтажник</div>
        {viewMode === "day" ? (
          <div className="planner-scale planner-hour-scale">
            {plannerHourSlots.map((hour) => (
              <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
            ))}
          </div>
        ) : (
          <div className="planner-scale planner-day-scale">
            {periodDays.map((day) => (
              <span className={day === todayDateKey() ? "today" : ""} key={day}>
                {plannerDayLabel(day)}
              </span>
            ))}
          </div>
        )}

        {lanes.map((lane) => {
          const laneItems = planned.filter((item) => (lane.unassigned ? !item.installerId : item.installerId === lane.id));
          return (
            <div className="planner-row" key={lane.id}>
              <div className="planner-lane-head">
                <UserRound size={16} />
                <strong>{lane.name}</strong>
                <span>{laneItems.length}</span>
              </div>
              {viewMode === "day" ? (
                <div className="planner-row-track planner-time-track">
                  <div className="planner-track-grid" aria-hidden="true" />
                  {laneItems.map((installation) => (
                    <PlannerJobCard
                      installation={installation}
                      key={installation.id}
                      selected={selectedInstallationId === installation.id}
                      style={plannerTimeStyle(installation, plannerHourRange)}
                      variant="bar"
                      onEdit={onEdit}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="planner-row-track planner-week-track">
                  {periodDays.map((day) => {
                    const dayItems = laneItems.filter((installation) => installationDateKey(installation.date) === day);
                    return (
                      <div className={day === todayDateKey() ? "planner-day-cell today" : "planner-day-cell"} key={day}>
                        {dayItems.map((installation) => (
                          <PlannerJobCard
                            installation={installation}
                            key={installation.id}
                            selected={selectedInstallationId === installation.id}
                            variant="chip"
                            onEdit={onEdit}
                            onSelect={onSelect}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <PlannerUnplannedPanel
        installations={unplanned}
        selectedInstallationId={selectedInstallationId}
        onEdit={onEdit}
        onSelect={onSelect}
      />
    </div>
  );
}

type PlannerLane = {
  id: string;
  name: string;
  unassigned?: boolean;
};

type PlannerHourRange = {
  start: number;
  end: number;
};

function PlannerJobCard({
  installation,
  selected,
  style,
  variant,
  onEdit,
  onSelect,
}: {
  installation: Installation;
  selected: boolean;
  style?: CSSProperties;
  variant: "bar" | "chip" | "month";
  onEdit: (installation: Installation) => void;
  onSelect: (installation: Installation) => void;
}) {
  return (
    <button
      className={`planner-job planner-job-${variant} status-${installation.status} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(installation)}
      onDoubleClick={() => onEdit(installation)}
      style={style}
      title={`${formatInstallationTime(installation.timeFrom, installation.timeTo)} · #${installation.dealNumber || installation.dealId} · ${installation.dealTitle || "Монтаж"}`}
      type="button"
    >
      <span>{formatInstallationTime(installation.timeFrom, installation.timeTo)}</span>
      <strong>#{installation.dealNumber || installation.dealId}</strong>
      <em>{installation.dealTitle || "Монтаж"}</em>
      {variant !== "month" ? <small>{installation.address || "Адрес не указан"}</small> : null}
    </button>
  );
}

function PlannerUnplannedPanel({
  installations,
  selectedInstallationId,
  onEdit,
  onSelect,
}: {
  installations: Installation[];
  selectedInstallationId?: string;
  onEdit: (installation: Installation) => void;
  onSelect: (installation: Installation) => void;
}) {
  return (
    <aside className="planner-unplanned-panel">
      <div>
        <strong>Не запланированные</strong>
        <span>{installations.length}</span>
      </div>
      {installations.length ? (
        installations.map((installation) => (
          <PlannerJobCard
            installation={installation}
            key={installation.id}
            selected={selectedInstallationId === installation.id}
            variant="chip"
            onEdit={onEdit}
            onSelect={onSelect}
          />
        ))
      ) : (
        <EmptyState text="Нет незапланированных монтажей" />
      )}
    </aside>
  );
}

function MonthPlanner({
  dateKey,
  installations,
  selectedInstallationId,
  onEdit,
  onSelect,
}: {
  dateKey: string;
  installations: Installation[];
  selectedInstallationId?: string;
  onEdit: (installation: Installation) => void;
  onSelect: (installation: Installation) => void;
}) {
  const calendarDays = monthCalendarDays(dateKey);
  const currentMonth = parseDateKey(dateKey).getMonth();
  return (
    <div className="installation-month-calendar">
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
        <div className="month-weekday" key={label}>{label}</div>
      ))}
      {calendarDays.map((day) => {
        const dayItems = installations.filter((installation) => installationDateKey(installation.date) === day);
        const muted = parseDateKey(day).getMonth() !== currentMonth;
        return (
          <section className={`month-day ${muted ? "muted" : ""} ${day === todayDateKey() ? "today" : ""}`} key={day}>
            <time>{parseDateKey(day).getDate()}</time>
            <div>
              {dayItems.slice(0, 4).map((installation) => (
                <PlannerJobCard
                  installation={installation}
                  key={installation.id}
                  selected={selectedInstallationId === installation.id}
                  variant="month"
                  onEdit={onEdit}
                  onSelect={onSelect}
                />
              ))}
              {dayItems.length > 4 ? <span className="month-more">+{dayItems.length - 4}</span> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function YearPlanner({
  dateKey,
  installations,
  onMonthSelect,
}: {
  dateKey: string;
  installations: Installation[];
  onMonthSelect: (dateKey: string) => void;
}) {
  const year = parseDateKey(dateKey).getFullYear();

  return (
    <div className="installation-year-calendar">
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const monthDateKey = dateKeyFromDate(new Date(year, monthIndex, 1, 12));
        const monthItems = installations.filter((installation) => sameMonthDateKey(installationDateKey(installation.date), monthDateKey));
        const isCurrentMonth = sameMonthDateKey(monthDateKey, todayDateKey());
        return (
          <button
            className={isCurrentMonth ? "year-month-card today" : "year-month-card"}
            key={monthDateKey}
            onClick={() => onMonthSelect(monthDateKey)}
            type="button"
          >
            <strong>{parseDateKey(monthDateKey).toLocaleDateString("ru-RU", { month: "long" })}</strong>
            <span>{monthItems.length ? `${monthItems.length} монтажей` : "Нет монтажей"}</span>
          </button>
        );
      })}
    </div>
  );
}

function InstallationPlannerCard({
  canReview,
  installation,
  selected,
  onAction,
  onDelete,
  onEdit,
  onOpenDeal,
  onPhotoDelete,
  setSelected,
}: {
  canReview: boolean;
  installation: Installation;
  selected: boolean;
  onAction: (installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) => void;
  onDelete: (installation: Installation) => void;
  onEdit: () => void;
  onOpenDeal?: (dealId: string, target: "cost" | "techSpec") => void;
  onPhotoDelete: (installation: Installation, photo: InstallationPhoto) => void;
  setSelected: () => void;
}) {
  return (
    <article className={`installation-card status-${installation.status}`}>
      <InstallationCardHead installation={installation} onClick={setSelected} />
      <div className="installation-card-actions">
        <button className="secondary compact" onClick={onEdit} type="button">Изменить</button>
        {onOpenDeal ? (
          <button className="secondary compact" onClick={() => onOpenDeal(installation.dealId, "techSpec")} type="button">Открыть ТЗ</button>
        ) : null}
        {canReview ? (
          <button className="danger compact" onClick={() => onDelete(installation)} type="button">
            <Trash2 size={14} />
            Удалить
          </button>
        ) : null}
        {canReview && installation.status === "review_pending" ? (
          <>
            <button className="primary compact" onClick={() => onAction(installation, "approve")} type="button">Подтвердить</button>
            <button className="danger compact" onClick={() => onAction(installation, "return", "Нужна доработка")} type="button">Доработка</button>
          </>
        ) : null}
      </div>
      {selected ? (
        <InstallationPhotoGrid canDelete={canReview} installation={installation} onPhotoDelete={onPhotoDelete} />
      ) : null}
    </article>
  );
}

function InstallationWorkerCard({
  canReview,
  currentUser,
  installation,
  selected,
  setSelected,
  onAction,
  onPhotoDelete,
  onPhotoUpload,
  uploadState,
}: {
  canReview: boolean;
  currentUser: ProductionEmployee;
  installation: Installation;
  selected: boolean;
  setSelected: () => void;
  onAction: (installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) => void;
  onPhotoDelete: (installation: Installation, photo: InstallationPhoto) => void;
  onPhotoUpload: (installation: Installation, files: FileList | File[], type?: InstallationPhotoType) => void;
  uploadState?: UploadState;
}) {
  return (
    <article className={`installation-card worker-installation-card status-${installation.status}`}>
      <InstallationCardHead installation={installation} onClick={setSelected} />
      <div className="worker-installation-quick-actions">
        {installation.address ? (
          <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(installation.address)}`} target="_blank" rel="noreferrer">
            <Navigation size={18} />
            Маршрут
          </a>
        ) : null}
        {installation.clientPhone ? (
          <a href={`tel:${installation.clientPhone}`}>
            <Phone size={18} />
            Позвонить
          </a>
        ) : null}
      </div>
      <div className="installation-card-actions">
        {installation.status === "assigned" || installation.status === "needs_revision" ? (
          <button className="primary compact" onClick={() => onAction(installation, "start")} type="button">Начать</button>
        ) : null}
        {installation.status === "in_progress" ? (
          <button className="primary compact" onClick={() => onAction(installation, "arrive")} type="button">На месте</button>
        ) : null}
        {installation.status === "arrived" || installation.status === "in_progress" ? (
          <button className="primary compact" onClick={() => onAction(installation, "complete", "Монтаж завершен")} type="button">Завершить</button>
        ) : null}
        <label className="secondary compact installation-upload-button">
          <Camera size={16} />
          Фото
          <input
            accept="image/*"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) onPhotoUpload(installation, event.currentTarget.files, "after");
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
      </div>
      {uploadState && uploadState.status !== "idle" ? (
        <div className={`installation-upload-state ${uploadState.status}`}>
          {uploadState.status === "success" ? <CheckCircle2 size={18} /> : null}
          <span>{uploadState.message}</span>
        </div>
      ) : null}
      {selected ? (
        <div className="installation-expanded">
          <p>{installation.comment || "Комментарий к монтажу не указан."}</p>
          <InstallationPhotoGrid canDelete={canReview || installation.installerId === currentUser.id} installation={installation} onPhotoDelete={onPhotoDelete} />
        </div>
      ) : null}
    </article>
  );
}

function InstallationCardHead({ installation, onClick }: { installation: Installation; onClick: () => void }) {
  return (
    <button className="installation-card-head" onClick={onClick} type="button">
      <div className="installation-card-icon">
        <Wrench size={22} />
      </div>
      <div className="installation-card-main">
        <span>#{installation.dealNumber || installation.dealId}</span>
        <strong>{installation.dealTitle || "Монтаж"}</strong>
        <small>{installation.address || "Адрес не указан"}</small>
      </div>
      <div className="installation-card-side">
        <time>{formatInstallationDate(installation.date)}</time>
        <span>{formatInstallationTime(installation.timeFrom, installation.timeTo)}</span>
        <em className={`installation-status status-${installation.status}`}>{installationStatusLabels[installation.status]}</em>
      </div>
    </button>
  );
}

function InstallationPhotoGrid({
  canDelete,
  installation,
  onPhotoDelete,
}: {
  canDelete: boolean;
  installation: Installation;
  onPhotoDelete: (installation: Installation, photo: InstallationPhoto) => void;
}) {
  if (!installation.photos.length) return <div className="installation-empty-photos">Фотоотчета пока нет.</div>;
  return (
    <div className="installation-photo-grid">
      {installation.photos.map((photo) => (
        <figure key={photo.id}>
          <a
            aria-label="Открыть фото монтажа"
            className="installation-photo-link"
            href={photo.url || photo.thumbnailUrl}
            rel="noreferrer"
            target="_blank"
          >
            <img
              alt={photo.originalName || "Фото монтажа"}
              decoding="async"
              loading="lazy"
              src={photo.thumbnailUrl || photo.url}
            />
          </a>
          <figcaption>{photo.type === "issue" ? "Проблема" : "Фото"}</figcaption>
          {canDelete ? (
            <button aria-label="Удалить фото" onClick={() => onPhotoDelete(installation, photo)} type="button">
              <Trash2 size={16} />
            </button>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

function InstallationDetails({
  canReview,
  currentUser,
  installation,
  onAction,
  onClose,
  onDelete,
  onEdit,
  onOpenDeal,
  onPhotoDelete,
}: {
  canReview: boolean;
  currentUser: ProductionEmployee;
  installation: Installation;
  onAction: (installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) => void;
  onClose: () => void;
  onDelete: (installation: Installation) => void;
  onEdit: () => void;
  onOpenDeal?: (dealId: string, target: "cost" | "techSpec") => void;
  onPhotoDelete: (installation: Installation, photo: InstallationPhoto) => void;
}) {
  return (
    <aside className="installation-details-panel">
      <button className="icon-button" onClick={onClose} type="button" aria-label="Закрыть">
        <X size={18} />
      </button>
      <span className={`installation-status status-${installation.status}`}>{installationStatusLabels[installation.status]}</span>
      <h2>#{installation.dealNumber || installation.dealId} {installation.dealTitle}</h2>
      <dl>
        <div><dt>Дата</dt><dd>{formatInstallationDate(installation.date)}</dd></div>
        <div><dt>Время</dt><dd>{formatInstallationTime(installation.timeFrom, installation.timeTo)}</dd></div>
        <div><dt>Монтажник</dt><dd>{installation.installerName || "Не назначен"}</dd></div>
        <div><dt>Адрес</dt><dd>{installation.address || "Не указан"}</dd></div>
        <div><dt>Телефон</dt><dd>{installation.clientPhone || "Не указан"}</dd></div>
        <div><dt>Комментарий</dt><dd>{installation.comment || "Нет"}</dd></div>
        {installation.sourceFiles?.length ? (
          <div>
            <dt>Файлы Bitrix</dt>
            <dd>
              {installation.sourceFiles.slice(0, 8).map((file) => (
                <a href={file.downloadUrl || file.url} key={file.id} target="_blank" rel="noreferrer">
                  {file.name}
                </a>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="installation-card-actions">
        <button className="secondary compact" onClick={onEdit} type="button">Изменить</button>
        {installation.address ? (
          <a className="secondary compact" href={`https://yandex.ru/maps/?text=${encodeURIComponent(installation.address)}`} target="_blank" rel="noreferrer">
            Карта
          </a>
        ) : null}
        {onOpenDeal ? (
          <button className="secondary compact" onClick={() => onOpenDeal(installation.dealId, "techSpec")} type="button">Открыть сделку</button>
        ) : null}
        {canReview ? (
          <button className="danger compact" onClick={() => onDelete(installation)} type="button">
            <Trash2 size={14} />
            Удалить
          </button>
        ) : null}
        {canReview && installation.status === "review_pending" ? (
          <>
            <button className="primary compact" onClick={() => onAction(installation, "approve")} type="button">Подтвердить</button>
            <button className="danger compact" onClick={() => onAction(installation, "return", "Нужна доработка")} type="button">Вернуть</button>
          </>
        ) : null}
      </div>
      <InstallationPhotoGrid canDelete={canReview || installation.installerId === currentUser.id} installation={installation} onPhotoDelete={onPhotoDelete} />
    </aside>
  );
}

function InstallationEditor({
  deals,
  installers,
  saving,
  saveApiUrl,
  state,
  onCancel,
  onChange,
  onSave,
}: {
  deals: Deal[];
  installers: ProductionEmployee[];
  saving: boolean;
  saveApiUrl: string;
  state: InstallationFormState;
  onCancel: () => void;
  onChange: (state: InstallationFormState) => void;
  onSave: (state: InstallationFormState) => void;
}) {
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressSuggestOpen, setAddressSuggestOpen] = useState(false);
  const [addressSuggestActiveIndex, setAddressSuggestActiveIndex] = useState(-1);
  const linkedDeal = findDealByNumber(deals, state.dealNumber || state.dealId);

  useEffect(() => {
    const query = state.address.trim();
    if (!saveApiUrl || query.length < 3) {
      setAddressSuggestions([]);
      setAddressSuggestActiveIndex(-1);
      return;
    }

    const cachedSuggestions = getCachedAddressSuggestions(query);
    if (cachedSuggestions) {
      setAddressSuggestions(cachedSuggestions);
      setAddressSuggestActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void loadAddressSuggestions(saveApiUrl, query, controller.signal)
        .then((suggestions) => {
          setAddressSuggestions(suggestions);
          setAddressSuggestActiveIndex(-1);
        })
        .catch(() => {
          setAddressSuggestions([]);
          setAddressSuggestActiveIndex(-1);
        });
    }, ADDRESS_SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [saveApiUrl, state.address]);

  const applyAddressSuggestion = (suggestion?: AddressSuggestion) => {
    if (!suggestion?.value) return;

    onChange({ ...state, address: suggestion.value, addressSource: "manual" });
    setAddressSuggestOpen(false);
    setAddressSuggestActiveIndex(-1);
  };

  const selectActiveAddressSuggestion = () => {
    const suggestion = addressSuggestions[addressSuggestActiveIndex >= 0 ? addressSuggestActiveIndex : 0];
    applyAddressSuggestion(suggestion);
  };

  const addressOptionsId = "installation-address-options";
  const activeAddressOptionId = addressSuggestActiveIndex >= 0 ? `installation-address-option-${addressSuggestActiveIndex}` : undefined;

  return (
    <div className="installation-editor-backdrop" role="presentation" onMouseDown={onCancel}>
      <form className="installation-editor" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        onSave(state);
      }}>
        <header>
          <div>
            <span className="eyebrow">Назначение</span>
            <h2>{state.id ? "Изменить монтаж" : "Назначить монтаж"}</h2>
          </div>
          <button className="icon-button" onClick={onCancel} type="button" aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="installation-editor-grid">
          <label>
            Номер сделки
            <input
              inputMode="numeric"
              value={state.dealNumber || state.dealId}
              onChange={(event) => onChange(updateStateWithDealNumber(state, event.target.value, deals))}
              placeholder="17044"
            />
          </label>
          <label className="installation-editor-deal-title">
            Сделка
            <input
              value={linkedDeal ? `#${linkedDeal.number || linkedDeal.id} ${linkedDeal.title}` : state.dealTitle}
              onChange={(event) => onChange({ ...state, dealTitle: event.target.value })}
              disabled={Boolean(linkedDeal)}
              placeholder="Название сделки"
            />
          </label>
          <label>
            Монтажник
            <select value={state.installerId} onChange={(event) => onChange({ ...state, installerId: event.target.value })}>
              <option value="">Не назначен</option>
              {installers.map((installer) => (
                <option key={installer.id} value={installer.id}>{installer.name}</option>
              ))}
            </select>
          </label>
          <label>
            Дата
            <input type="date" value={state.date} onChange={(event) => onChange({ ...state, date: event.target.value })} />
          </label>
          <label>
            С
            <input type="time" value={state.timeFrom} onChange={(event) => onChange({ ...state, timeFrom: event.target.value })} />
          </label>
          <label>
            До
            <input type="time" value={state.timeTo} onChange={(event) => onChange({ ...state, timeTo: event.target.value })} />
          </label>
          <label>
            Телефон клиента
            <input value={state.clientPhone} onChange={(event) => onChange({ ...state, clientPhone: event.target.value })} />
          </label>
          <label className="full installation-address-field">
            Адрес
            <input
              aria-activedescendant={activeAddressOptionId}
              aria-autocomplete="list"
              aria-controls={addressOptionsId}
              aria-expanded={addressSuggestOpen && addressSuggestions.length > 0}
              autoComplete="off"
              role="combobox"
              value={state.address}
              onBlur={() => window.setTimeout(() => {
                setAddressSuggestOpen(false);
                setAddressSuggestActiveIndex(-1);
              }, 120)}
              onChange={(event) => {
                onChange({ ...state, address: event.target.value, addressSource: "manual" });
                setAddressSuggestOpen(true);
                setAddressSuggestActiveIndex(-1);
              }}
              onKeyDown={(event) => {
                if (!addressSuggestions.length) return;

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setAddressSuggestOpen(true);
                  setAddressSuggestActiveIndex((current) => (current < 0 ? 0 : (current + 1) % addressSuggestions.length));
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setAddressSuggestOpen(true);
                  setAddressSuggestActiveIndex((current) => (current < 0 ? addressSuggestions.length - 1 : (current - 1 + addressSuggestions.length) % addressSuggestions.length));
                  return;
                }

                if (addressSuggestOpen && (event.key === "Enter" || event.key === " " || event.code === "Space")) {
                  event.preventDefault();
                  selectActiveAddressSuggestion();
                  return;
                }

                if (addressSuggestOpen && event.key === "Tab") {
                  selectActiveAddressSuggestion();
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setAddressSuggestOpen(false);
                  setAddressSuggestActiveIndex(-1);
                }
              }}
              onFocus={() => setAddressSuggestOpen(true)}
              placeholder="Адрес монтажа или объект"
            />
            {addressSuggestOpen && addressSuggestions.length ? (
              <div className="installation-address-suggestions" id={addressOptionsId} role="listbox">
                {addressSuggestions.map((suggestion, index) => (
                  <button
                    aria-selected={addressSuggestActiveIndex === index}
                    className={addressSuggestActiveIndex === index ? "is-active" : undefined}
                    id={`installation-address-option-${index}`}
                    key={`${suggestion.kladrId || suggestion.value}_${suggestion.value}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setAddressSuggestActiveIndex(index)}
                    onClick={() => applyAddressSuggestion(suggestion)}
                    role="option"
                    type="button"
                  >
                    {suggestion.value}
                  </button>
                ))}
              </div>
            ) : null}
          </label>
          {state.sourceFiles?.length ? (
            <div className="installation-editor-files">
              <span>Файлы из Bitrix</span>
              {state.sourceFiles.slice(0, 6).map((file) => (
                <a href={file.downloadUrl || file.url} key={file.id} target="_blank" rel="noreferrer">
                  {file.name}
                </a>
              ))}
            </div>
          ) : null}
          <label className="full">
            Комментарий
            <textarea value={state.comment} onChange={(event) => onChange({ ...state, comment: event.target.value })} rows={3} />
          </label>
        </div>
        <footer>
          <button className="secondary" onClick={onCancel} type="button">Отмена</button>
          <button className="primary" disabled={saving} type="submit">{saving ? "Сохраняем..." : "Сохранить"}</button>
        </footer>
      </form>
    </div>
  );
}

function NotificationList({
  currentUser,
  notifications,
  saveApiUrl,
  storedInstallations,
  onChange,
  onOpen,
}: {
  currentUser: ProductionEmployee;
  notifications: InstallationNotification[];
  saveApiUrl: string;
  storedInstallations: StoredInstallations;
  onChange: (data: StoredInstallations, options?: InstallationCommitOptions) => void;
  onOpen: (installationId: string) => void;
}) {
  async function markRead(notification: InstallationNotification) {
    onOpen(notification.installationId);
    if (notification.readBy?.includes(currentUser.id)) return;
    if (saveApiUrl) {
      await markInstallationNotificationRead({ apiUrl: saveApiUrl }, notification.id, currentUser.id).catch(() => undefined);
    }
    onChange({
      ...storedInstallations,
      notifications: (storedInstallations.notifications || []).map((item) =>
        item.id === notification.id
          ? { ...item, readBy: [...(item.readBy || []), currentUser.id], readAt: new Date().toISOString() }
          : item,
      ),
    });
  }

  return (
    <section className="installation-notification-list">
      <div className="installations-section-head">
        <h2>Уведомления</h2>
        <span>{notifications.filter((item) => !item.readBy?.includes(currentUser.id)).length}</span>
      </div>
      {notifications.length ? (
        notifications.slice(0, 30).map((notification) => (
          <button
            className={notification.readBy?.includes(currentUser.id) ? "" : "unread"}
            key={notification.id}
            onClick={() => void markRead(notification)}
            type="button"
          >
            <Bell size={16} />
            <span>{notification.message}</span>
            <time>{formatRelativeTime(notification.createdAt)}</time>
          </button>
        ))
      ) : (
        <EmptyState text="Уведомлений пока нет." />
      )}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="installation-empty-state">{text}</div>;
}

function buildInstallationMapPoints(installations: Installation[], readyDeals: Deal[]): InstallationMapPoint[] {
  const installationPoints = installations
    .filter((installation) => Boolean(installation.address?.trim()))
    .map((installation) => ({
      address: installation.address.trim(),
      date: installation.date,
      dealId: installation.dealId,
      id: installation.id,
      kind: "installation" as const,
      status: installation.status,
      statusLabel: installationStatusLabels[installation.status],
      subtitle: installation.installerName || "Монтажник не назначен",
      time: formatInstallationTime(installation.timeFrom, installation.timeTo),
      title: `#${installation.dealNumber || installation.dealId} ${installation.dealTitle || "Монтаж"}`,
    }));

  const installerPoints = installations
    .filter(
      (installation) =>
        Boolean(installation.installerLocation) &&
        (installation.status === "in_progress" || installation.status === "arrived"),
    )
    .map((installation) => {
      const location = installation.installerLocation!;
      return {
        address: installation.address?.trim() || installation.installerName || "Монтажник",
        coordinates: [location.lat, location.lon] as [number, number],
        date: installation.date,
        dealId: installation.dealId,
        id: `installer_${installation.id}`,
        kind: "installer" as const,
        status: installation.status,
        statusLabel: installation.status === "arrived" ? "Монтажник на месте" : "Монтажник выехал",
        subtitle: installation.installerName || "Монтажник",
        time: location.capturedAt
          ? new Date(location.capturedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
          : "",
        title: `${installation.installerName || "Монтажник"}: #${installation.dealNumber || installation.dealId}`,
      };
    });

  const plannedDealIds = new Set(installationPoints.map((point) => point.dealId));
  const readyPoints = readyDeals
    .filter((deal) => !plannedDealIds.has(deal.id))
    .filter((deal) => Boolean(deal.installationAddress?.trim()))
    .map((deal) => ({
      address: deal.installationAddress!.trim(),
      date: deal.expectedFinishDate,
      dealId: deal.id,
      id: `ready_${deal.id}`,
      kind: "readyDeal" as const,
      status: "ready" as const,
      statusLabel: "Готова к назначению",
      subtitle: deal.installationClientName || deal.responsible || "Клиент не указан",
      time: "",
      title: `#${deal.number || deal.id} ${deal.title || "Без названия"}`,
    }));

  return [...installationPoints, ...readyPoints, ...installerPoints];
}

function isRouteableMapPoint(point: InstallationMapPoint) {
  return point.kind === "installation" || point.kind === "readyDeal";
}

function buildYandexRouteLink(points: InstallationMapPoint[]) {
  if (!points.length) return "";
  if (points.length === 1) return `https://yandex.ru/maps/?text=${encodeURIComponent(points[0].address)}`;
  return `https://yandex.ru/maps/?rtext=${points.map((point) => encodeURIComponent(point.address)).join("~")}&rtt=auto`;
}

function isInstallationVisibleInPlanner(installation: Installation, viewMode: InstallationViewMode, dateKey: string) {
  if (viewMode === "list") return true;
  if (isUnplannedInstallation(installation)) return true;
  const current = installationDateKey(installation.date);
  if (!current) return true;
  const range = plannerRange(viewMode, dateKey);
  return current >= range.start && current <= range.end;
}

function plannerTitle(viewMode: InstallationViewMode, dateKey: string) {
  if (viewMode === "day") return `План на ${formatInstallationDate(dateKey)}`;
  if (viewMode === "week") {
    const range = plannerRange("week", dateKey);
    return `Период ${formatInstallationDate(range.start)} - ${formatInstallationDate(range.end)}`;
  }
  if (viewMode === "month") {
    return parseDateKey(dateKey).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }
  if (viewMode === "year") {
    return `${parseDateKey(dateKey).getFullYear()} год`;
  }
  return "Все монтажи";
}

function plannerRange(viewMode: Exclude<InstallationViewMode, "list">, dateKey: string) {
  if (viewMode === "day") return { start: dateKey, end: dateKey };
  if (viewMode === "week") {
    return { start: addDaysToDateKey(dateKey, -7), end: addDaysToDateKey(dateKey, 7) };
  }
  const date = parseDateKey(dateKey);
  if (viewMode === "year") {
    const start = dateKeyFromDate(new Date(date.getFullYear(), 0, 1, 12));
    const end = dateKeyFromDate(new Date(date.getFullYear(), 11, 31, 12));
    return { start, end };
  }
  const start = dateKeyFromDate(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const end = dateKeyFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
  return { start, end };
}

function isUnplannedInstallation(installation: Installation) {
  return installation.status === "not_scheduled" || !installation.date || (!installation.timeFrom && !installation.timeTo);
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12);
}

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, offset: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + offset);
  return dateKeyFromDate(date);
}

function addMonthsToDateKey(dateKey: string, offset: number) {
  const date = parseDateKey(dateKey);
  date.setMonth(date.getMonth() + offset);
  return dateKeyFromDate(date);
}

function addYearsToDateKey(dateKey: string, offset: number) {
  const date = parseDateKey(dateKey);
  date.setFullYear(date.getFullYear() + offset);
  return dateKeyFromDate(date);
}

function monthInputValue(dateKey: string) {
  return dateKey.slice(0, 7);
}

function dateKeyFromMonthInput(monthValue: string, currentDateKey: string) {
  const [year, month] = monthValue.split("-").map(Number);
  if (!year || !month) return currentDateKey;
  const currentDay = parseDateKey(currentDateKey).getDate();
  const maxDay = new Date(year, month, 0).getDate();
  return dateKeyFromDate(new Date(year, month - 1, Math.min(currentDay, maxDay), 12));
}

function startOfWeekDateKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return dateKeyFromDate(date);
}

function dateKeysBetween(start: string, end: string) {
  const days: string[] = [];
  let current = start;
  while (current <= end) {
    days.push(current);
    current = addDaysToDateKey(current, 1);
  }
  return days;
}

function monthCalendarDays(dateKey: string) {
  const date = parseDateKey(dateKey);
  const monthStart = dateKeyFromDate(new Date(date.getFullYear(), date.getMonth(), 1, 12));
  const monthEnd = dateKeyFromDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12));
  const gridStart = startOfWeekDateKey(monthStart);
  const lastDate = parseDateKey(monthEnd);
  const lastDay = lastDate.getDay() || 7;
  const gridEnd = addDaysToDateKey(monthEnd, 7 - lastDay);
  return dateKeysBetween(gridStart, gridEnd);
}

function plannerDayLabel(dateKey: string) {
  const date = parseDateKey(dateKey);
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", weekday: "short" });
}

function buildPlannerHourSlots(range: PlannerHourRange) {
  return Array.from({ length: range.end - range.start }, (_, index) => range.start + index);
}

function adjustPlannerZoom(current: number, deltaY: number) {
  const factor = deltaY > 0 ? 0.84 : 1.2;
  return clampNumber(Number((current * factor).toFixed(3)), minPlannerZoom, maxPlannerZoom);
}

function plannerPointerRatio(element: HTMLElement, clientX: number) {
  const rect = element.getBoundingClientRect();
  const x = clientX - rect.left + element.scrollLeft;
  return clampNumber(x / Math.max(1, element.scrollWidth), 0, 1);
}

function keepPlannerPointerPosition(element: HTMLElement, ratio: number, clientX: number) {
  const rect = element.getBoundingClientRect();
  const pointerOffset = clientX - rect.left;
  element.scrollLeft = Math.max(0, ratio * element.scrollWidth - pointerOffset);
}

function sameMonthDateKey(first: string, second: string) {
  if (!first || !second) return false;
  return first.slice(0, 7) === second.slice(0, 7);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function plannerTimeStyle(installation: Installation, hourRange: PlannerHourRange): CSSProperties {
  const dayStart = hourRange.start * 60;
  const dayEnd = hourRange.end * 60;
  const rawStart = minutesFromTime(installation.timeFrom) ?? 10 * 60;
  const rawEnd = Math.max(rawStart + 30, minutesFromTime(installation.timeTo) ?? rawStart + 90);
  if (rawEnd <= dayStart || rawStart >= dayEnd) return { display: "none" };
  const start = Math.max(dayStart, Math.min(dayEnd, rawStart));
  const end = Math.min(dayEnd, Math.max(start + 1, rawEnd));
  const span = dayEnd - dayStart;
  return {
    "--job-left": `${((start - dayStart) / span) * 100}%`,
    "--job-width": `${Math.max(4, ((end - start) / span) * 100)}%`,
  } as CSSProperties;
}

function minutesFromTime(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  return hours * 60 + minutes;
}

function loadYandexMaps(apiKey: string) {
  if (window.ymaps) return Promise.resolve(window.ymaps);
  if (yandexMapsPromise) return yandexMapsPromise;

  yandexMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.id = "verkup-yandex-maps-api";
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.onload = () => resolve(window.ymaps);
    script.onerror = () => reject(new Error("Не удалось загрузить API Яндекс.Карт"));
    document.head.appendChild(script);
  });

  return yandexMapsPromise;
}

async function geocodeInstallationAddress(ymaps: any, address: string) {
  const normalizedAddress = String(address || "").trim();
  if (!normalizedAddress) return undefined;
  const spacedAddress = normalizedAddress.replace(/([^\W\d_])(\d)/gu, "$1 $2");
  const hasRegionHint = /[,]|москва|область|край|республика|санкт|г\./i.test(normalizedAddress);
  const candidates = Array.from(
    new Set(
      hasRegionHint
        ? [normalizedAddress, spacedAddress]
        : [`Москва, ${spacedAddress}`, `Московская область, ${spacedAddress}`, normalizedAddress, spacedAddress],
    ),
  );

  for (const candidate of candidates) {
    try {
      const result = await ymaps.geocode(candidate, { results: 1 });
      const first = result.geoObjects.get(0);
      const coordinates = first?.geometry?.getCoordinates?.();
      if (Array.isArray(coordinates) && coordinates.length >= 2) return coordinates;
    } catch {
      // A server-side geocoder proxy can be connected as a fallback below.
    }
  }

  const proxyUrl =
    YANDEX_GEOCODER_PROXY_URL ||
    new URL("api/geocode", new URL(import.meta.env.BASE_URL || "/", window.location.origin)).toString();

  for (const candidate of candidates) {
    try {
      const url = new URL(proxyUrl, window.location.origin);
      url.searchParams.set("geocode", candidate);
      const response = await fetch(url.toString());
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.coordinates) && data.coordinates.length >= 2) {
        const [lat, lon] = data.coordinates.map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
      }
      const pos = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
      if (typeof pos !== "string") continue;
      const [lon, lat] = pos.split(/\s+/).map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      return [lat, lon];
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function getInstallerLocationSnapshot(): Promise<InstallationLocation | undefined> {
  if (!("geolocation" in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: InstallationLocation | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(undefined), 6500);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        finish({
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          source: "browser",
        }),
      () => finish(undefined),
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 5500 },
    );
  });
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formStateFromDeal(deal: Deal, date: string): InstallationFormState {
  return {
    address: deal.installationAddress || "",
    addressSource: deal.installationAddress ? "bitrix" : undefined,
    clientName: deal.installationClientName || "",
    clientPhone: deal.installationClientPhone || deal.responsiblePhone || "",
    comment: deal.installationComment || "",
    date,
    dealId: deal.id,
    dealNumber: deal.number,
    dealTitle: deal.title,
    installerId: "",
    sourceFiles: deal.installationFiles || [],
    timeFrom: "10:00",
    timeTo: "12:00",
  };
}

function emptyForm(date: string): InstallationFormState {
  return {
    address: "",
    clientName: "",
    clientPhone: "",
    comment: "",
    date,
    dealId: "",
    dealNumber: "",
    dealTitle: "",
    installerId: "",
    sourceFiles: [],
    timeFrom: "10:00",
    timeTo: "12:00",
  };
}

function formStateFromInstallation(installation: Installation): InstallationFormState {
  return {
    address: installation.address || "",
    addressSource: installation.addressSource,
    clientName: installation.clientName || "",
    clientPhone: installation.clientPhone || "",
    comment: installation.comment || "",
    date: installation.date || todayDateKey(),
    dealId: installation.dealId,
    dealNumber: installation.dealNumber || "",
    dealTitle: installation.dealTitle || "",
    id: installation.id,
    installerId: installation.installerId || "",
    sourceFiles: installation.sourceFiles || [],
    timeFrom: installation.timeFrom || "",
    timeTo: installation.timeTo || "",
  };
}

function normalizeDealNumberInput(value: string) {
  const trimmed = value.trim().replace(/^#/, "");
  const numeric = trimmed.match(/\d+/)?.[0];
  return numeric || trimmed;
}

function findDealByNumber(deals: Deal[], value: string) {
  const normalized = normalizeDealNumberInput(value);
  if (!normalized) return undefined;
  return deals.find((deal) => deal.number === normalized || deal.id === normalized);
}

function updateStateWithDealNumber(state: InstallationFormState, value: string, deals: Deal[]): InstallationFormState {
  const next: InstallationFormState = { ...state, dealNumber: value };
  const deal = findDealByNumber(deals, value);
  if (deal) return mergeInstallationStateWithDeal(next, deal);
  return {
    ...next,
    dealId: "",
    dealTitle: state.dealId && normalizeDealNumberInput(value) !== normalizeDealNumberInput(state.dealNumber || state.dealId) ? "" : state.dealTitle,
    sourceFiles: [],
  };
}

function resolveInstallationFormState(state: InstallationFormState, deals: Deal[]): InstallationFormState {
  const deal = findDealByNumber(deals, state.dealNumber || state.dealId);
  if (deal) return mergeInstallationStateWithDeal(state, deal);
  const manualNumber = normalizeDealNumberInput(state.dealNumber || state.dealId);
  return {
    ...state,
    dealId: state.dealId || manualNumber,
    dealNumber: state.dealNumber || manualNumber,
  };
}

function mergeInstallationStateWithDeal(state: InstallationFormState, deal: Deal): InstallationFormState {
  const keepManualAddress = state.addressSource === "manual" && state.address.trim() !== "";
  return {
    ...state,
    address: keepManualAddress ? state.address : deal.installationAddress || state.address,
    addressSource: keepManualAddress ? "manual" : deal.installationAddress ? "bitrix" : state.addressSource,
    clientName: state.clientName || deal.installationClientName || "",
    clientPhone: state.clientPhone || deal.installationClientPhone || deal.responsiblePhone || "",
    comment: state.comment || deal.installationComment || "",
    dealId: deal.id,
    dealNumber: deal.number,
    dealTitle: deal.title,
    sourceFiles: deal.installationFiles || state.sourceFiles || [],
  };
}

async function loadAddressSuggestions(apiUrl: string, query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const normalizedApiUrl = apiUrl.trim().replace(/\/+$/, "");
  const normalizedQuery = query.trim();
  if (!normalizedApiUrl || normalizedQuery.length < 3) return [];

  const cachedSuggestions = getCachedAddressSuggestions(normalizedQuery);
  if (cachedSuggestions) return cachedSuggestions;

  const response = await fetch(`${normalizedApiUrl}/address-suggest?query=${encodeURIComponent(normalizedQuery)}`, {
    signal,
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions.filter((item: AddressSuggestion) => item?.value) : [];
  setCachedAddressSuggestions(normalizedQuery, suggestions);
  return suggestions;
}

function normalizeAddressSuggestCacheKey(query: string) {
  return query.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function getCachedAddressSuggestions(query: string): AddressSuggestion[] | null {
  const key = normalizeAddressSuggestCacheKey(query);
  if (!key || key.length < 3) return null;

  const memoryEntry = addressSuggestionMemoryCache.get(key);
  if (isFreshAddressSuggestionEntry(memoryEntry)) return memoryEntry.suggestions;

  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ADDRESS_SUGGEST_STORAGE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, AddressSuggestionCacheEntry>;
    const entry = cache[key];
    if (!isFreshAddressSuggestionEntry(entry)) return null;
    addressSuggestionMemoryCache.set(key, entry);
    return entry.suggestions;
  } catch {
    return null;
  }
}

function setCachedAddressSuggestions(query: string, suggestions: AddressSuggestion[]) {
  const key = normalizeAddressSuggestCacheKey(query);
  if (!key || key.length < 3 || !suggestions.length) return;

  const entry: AddressSuggestionCacheEntry = {
    savedAt: Date.now(),
    suggestions: suggestions.slice(0, 8),
  };
  addressSuggestionMemoryCache.set(key, entry);

  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(ADDRESS_SUGGEST_STORAGE_KEY);
    const cache = raw ? (JSON.parse(raw) as Record<string, AddressSuggestionCacheEntry>) : {};
    cache[key] = entry;

    const keys = Object.keys(cache).sort((a, b) => (cache[b]?.savedAt || 0) - (cache[a]?.savedAt || 0));
    for (const staleKey of keys.slice(ADDRESS_SUGGEST_CACHE_LIMIT)) {
      delete cache[staleKey];
    }
    window.localStorage.setItem(ADDRESS_SUGGEST_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Address cache is a speed optimization only.
  }
}

function isFreshAddressSuggestionEntry(entry?: AddressSuggestionCacheEntry): entry is AddressSuggestionCacheEntry {
  return Boolean(
    entry &&
      Array.isArray(entry.suggestions) &&
      Date.now() - entry.savedAt < ADDRESS_SUGGEST_CACHE_TTL_MS,
  );
}

function upsertLocalInstallation(
  store: StoredInstallations,
  id: string | undefined,
  payload: Omit<InstallationFormState, "id"> & {
    actor: string;
    actorId: string;
    addressEdited?: boolean;
    installerName: string;
    status: InstallationStatus;
  },
): StoredInstallations {
  const now = new Date().toISOString();
  const installation: Installation = {
    id: id || `local_${Date.now()}`,
    dealId: payload.dealId,
    dealNumber: payload.dealNumber,
    dealTitle: payload.dealTitle,
    date: payload.date,
    timeFrom: payload.timeFrom,
    timeTo: payload.timeTo,
    address: payload.address,
    installerId: payload.installerId,
    installerName: payload.installerName,
    status: payload.status,
    addressEdited: payload.addressEdited,
    addressSource: payload.addressSource,
    clientName: payload.clientName,
    clientPhone: payload.clientPhone,
    comment: payload.comment,
    sourceFiles: payload.sourceFiles || [],
    photos: [],
    history: [{ id: `event_${Date.now()}`, type: id ? "updated" : "created", at: now, actor: payload.actor, actorId: payload.actorId }],
    createdAt: now,
    createdBy: payload.actor,
    updatedAt: now,
  };
  const previous = id ? store.installations.find((item) => item.id === id) : undefined;
  const next = previous ? { ...previous, ...installation, photos: previous.photos, history: [...previous.history, ...installation.history] } : installation;
  return {
    ...store,
    generatedAt: now,
    installations: [...store.installations.filter((item) => item.id !== next.id), next],
  };
}

function updateLocalInstallationStatus(
  store: StoredInstallations,
  id: string,
  action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation",
  actor: ProductionEmployee,
  note?: string,
  installerLocation?: InstallationLocation,
): StoredInstallations {
  const now = new Date().toISOString();
  const statusByAction: Record<typeof action, InstallationStatus> = {
    arrive: "arrived",
    approve: "completed",
    cancel: "canceled",
    complete: "review_pending",
    "no-installation": "no_installation",
    return: "needs_revision",
    start: "in_progress",
  };
  const eventByAction = {
    arrive: "arrived",
    approve: "approved",
    cancel: "canceled",
    complete: "completed",
    "no-installation": "noInstallation",
    return: "returned",
    start: "started",
  } as const;
  return {
    ...store,
    generatedAt: now,
    installations: store.installations.map((installation) =>
      installation.id === id
        ? {
            ...installation,
            ...(action === "start" ? { startedAt: installation.startedAt || now } : {}),
            ...(action === "arrive" ? { arrivedAt: now } : {}),
            ...(installerLocation ? { installerLocation } : {}),
            status: statusByAction[action],
            updatedAt: now,
            history: [
              ...installation.history,
              { id: `event_${Date.now()}`, type: eventByAction[action], at: now, actor: actor.name, actorId: actor.id, note },
            ],
          }
        : installation,
    ),
  };
}

function removeLocalInstallationPhoto(store: StoredInstallations, installationId: string, photoId: string): StoredInstallations {
  return {
    ...store,
    generatedAt: new Date().toISOString(),
    installations: store.installations.map((installation) =>
      installation.id === installationId
        ? { ...installation, photos: installation.photos.filter((photo) => photo.id !== photoId) }
        : installation,
    ),
  };
}

function removeLocalInstallation(store: StoredInstallations, installationId: string): StoredInstallations {
  return {
    ...store,
    generatedAt: new Date().toISOString(),
    installations: store.installations.filter((installation) => installation.id !== installationId),
    notifications: (store.notifications || []).filter((notification) => notification.installationId !== installationId),
  };
}

function compareInstallations(first: Installation, second: Installation) {
  return `${first.date || ""} ${first.timeFrom || ""}`.localeCompare(`${second.date || ""} ${second.timeFrom || ""}`);
}

function statusActionSuccess(action: string) {
  if (action === "start") return "Монтаж взят в работу";
  if (action === "arrive") return "Отмечено: на месте";
  if (action === "complete") return "Монтаж отправлен на проверку";
  if (action === "approve") return "Монтаж подтвержден";
  if (action === "return") return "Монтаж возвращен на доработку";
  if (action === "no-installation") return "Сделка отмечена без монтажа";
  return "Статус обновлен";
}

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "М";
}

function formatRelativeTime(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.round(hours / 24)} д`;
}
