import {
  Bell,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  MapPin,
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
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BitrixDealFile,
  Deal,
  DealTechSpec,
  Installation,
  InstallationNotification,
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
  deleteInstallationPhoto,
  markInstallationNotificationRead,
  updateInstallation,
  uploadInstallationPhoto,
} from "../lib/saveApi";

type InstallationViewMode = "day" | "week" | "month" | "list";
type InstallationMobileTab = "today" | "all" | "notifications";

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
};

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
  date?: string;
  dealId: string;
  id: string;
  kind: "installation" | "readyDeal";
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

const plannerStartHour = 8;
const plannerEndHour = 20;
const plannerHourSlots = Array.from(
  { length: plannerEndHour - plannerStartHour + 1 },
  (_, index) => plannerStartHour + index,
);

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
}: InstallationsAppProps) {
  const [dateKey, setDateKey] = useState(todayDateKey());
  const [viewMode, setViewMode] = useState<InstallationViewMode>("day");
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
  const canReview = ["leader", "technologist", "shopChief"].includes(accessRoleFor(currentUser));
  const unreadNotifications = notifications.filter((notification) => !notification.readBy?.includes(currentUser.id));
  const visibleNotifications = notifications
    .filter((notification) => !notification.targetEmployeeId || notification.targetEmployeeId === currentUser.id || canReview)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

  const filteredInstallations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return installations
      .filter((installation) => {
        if (isMobileInstaller && installation.installerId !== currentUser.id) return false;
        if (installerFilter !== "all" && installation.installerId !== installerFilter) return false;
        if (statusFilter !== "all" && statusFilter !== "queue" && installation.status !== statusFilter) return false;
        if (!isMobileInstaller && !isInstallationVisibleInPlanner(installation, viewMode, dateKey)) return false;
        if (!needle) return true;
        return [
          installation.dealNumber,
          installation.dealTitle,
          installation.address,
          installation.installerName,
          installation.clientName,
          installation.clientPhone,
          installation.comment,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort(compareInstallations);
  }, [currentUser.id, dateKey, installerFilter, installations, isMobileInstaller, query, statusFilter, viewMode]);

  const selectedInstallation = selectedInstallationId
    ? installations.find((installation) => installation.id === selectedInstallationId)
    : undefined;
  const mapPoints = useMemo(
    () => buildInstallationMapPoints(filteredInstallations, readyDeals),
    [filteredInstallations, readyDeals],
  );

  useEffect(() => {
    setRoutePointIds((current) => current.filter((id) => mapPoints.some((point) => point.id === id)));
  }, [mapPoints]);

  if (isMobileInstaller) {
    const todayInstallations = filteredInstallations.filter((installation) => installationDateKey(installation.date) === dateKey);
    const list = mobileTab === "today" ? todayInstallations : filteredInstallations;
    return (
      <main className="installations-app installations-mobile" aria-label="Монтажи">
        <InstallationMobileHeader
          currentUser={currentUser}
          unreadCount={unreadNotifications.length}
          onRefresh={() => void onRefresh?.()}
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
        </nav>

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
          <div className="installation-date-control">
            <button onClick={() => shiftDate(-1)} type="button">←</button>
            <input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
            <button onClick={() => shiftDate(1)} type="button">→</button>
            <button onClick={() => setDateKey(todayDateKey())} type="button">Сегодня</button>
          </div>
          <div className="segmented compact">
            <button className={viewMode === "day" ? "active" : ""} onClick={() => setViewMode("day")} type="button">
              День
            </button>
            <button className={viewMode === "week" ? "active" : ""} onClick={() => setViewMode("week")} type="button">
              Неделя
            </button>
            <button className={viewMode === "month" ? "active" : ""} onClick={() => setViewMode("month")} type="button">
              Месяц
            </button>
            <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} type="button">
              Список
            </button>
          </div>
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
          <div className="installations-section-head">
            <h2>{plannerTitle(viewMode, dateKey)}</h2>
            <button className="primary compact" onClick={() => setEditing(emptyForm(dateKey))} type="button">
              <Plus size={16} />
              Создать монтаж
            </button>
          </div>
          {viewMode !== "list" ? (
            <InstallationPlannerTimeline
              dateKey={dateKey}
              installers={installers}
              installations={filteredInstallations}
              selectedInstallationId={selectedInstallationId}
              viewMode={viewMode}
              onEdit={(installation) => setEditing(formStateFromInstallation(installation))}
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
        onRouteSelectAll={() => setRoutePointIds(mapPoints.map((point) => point.id))}
      />

      {selectedInstallation ? (
        <InstallationDetails
          canReview={canReview}
          currentUser={currentUser}
          installation={selectedInstallation}
          onAction={handleStatusAction}
          onClose={() => setSelectedInstallationId(undefined)}
          onEdit={() => setEditing(formStateFromInstallation(selectedInstallation))}
          onOpenDeal={onOpenDeal}
          onPhotoDelete={handlePhotoDelete}
        />
      ) : null}

      {editing ? (
        <InstallationEditor
          installers={installers}
          saving={saving}
          state={editing}
          onCancel={() => setEditing(undefined)}
          onChange={setEditing}
          onSave={handleSaveInstallation}
        />
      ) : null}
    </main>
  );

  function shiftDate(offset: number) {
    if (viewMode === "month") {
      setDateKey(addMonthsToDateKey(dateKey, offset));
      return;
    }
    setDateKey(addDaysToDateKey(dateKey, viewMode === "week" ? offset * 7 : offset));
  }

  async function handleSaveInstallation(state: InstallationFormState) {
    setSaving(true);
    try {
      const payload = {
        actor: currentUser.name,
        actorId: currentUser.id,
        address: state.address,
        addressEdited: state.addressSource === "manual",
        addressSource: state.addressSource || (state.address ? "manual" : undefined),
        clientName: state.clientName,
        clientPhone: state.clientPhone,
        comment: state.comment,
        date: state.date,
        dealId: state.dealId,
        dealNumber: state.dealNumber,
        dealTitle: state.dealTitle,
        installerId: state.installerId,
        installerName: installers.find((installer) => installer.id === state.installerId)?.name || "",
        status: state.installerId ? "assigned" : "not_scheduled",
        sourceFiles: state.sourceFiles || [],
        timeFrom: state.timeFrom,
        timeTo: state.timeTo,
      } as const;

      if (saveApiUrl) {
        const result = state.id
          ? await updateInstallation({ apiUrl: saveApiUrl }, state.id, payload)
          : await createInstallation({ apiUrl: saveApiUrl }, payload);
        onChange(result.data, { saveNow: true });
      } else {
        onChange(upsertLocalInstallation(storedInstallations, state.id, payload), { saveNow: true });
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
      if (saveApiUrl) {
        const result = await changeInstallationStatus({ apiUrl: saveApiUrl }, installation.id, action, {
          actor: currentUser.name,
          actorId: currentUser.id,
          note,
          resultComment: action === "complete" ? note : undefined,
          returnComment: action === "return" ? note : undefined,
        });
        onChange(result.data, { saveNow: true });
      } else {
        onChange(updateLocalInstallationStatus(storedInstallations, installation.id, action, currentUser, note), { saveNow: true });
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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }
}

function InstallationMobileHeader({
  currentUser,
  unreadCount,
  onRefresh,
}: {
  currentUser: ProductionEmployee;
  unreadCount: number;
  onRefresh: () => void;
}) {
  return (
    <header className="installation-mobile-header">
      <div className="worker-avatar">{initialsFor(currentUser.name)}</div>
      <div>
        <strong>{currentUser.name}</strong>
        <span>Монтажник</span>
      </div>
      <button aria-label="Обновить монтажи" onClick={onRefresh} type="button">
        <RefreshCcw size={20} />
      </button>
      <div className="installation-bell" aria-label="Уведомления">
        <Bell size={20} />
        {unreadCount ? <span>{unreadCount}</span> : null}
      </div>
    </header>
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
  const routePoints = points.filter((point) => routePointIds.includes(point.id));
  const routeLink = buildYandexRouteLink(routePoints.length >= 2 ? routePoints : points.slice(0, 2));

  return (
    <section className="installation-map-panel">
      <div className="installations-section-head">
        <div>
          <h2>Карта монтажей</h2>
          <p>Адреса готовых сделок и назначенных монтажей. Адрес можно поправить в форме назначения.</p>
        </div>
        <span>{points.length}</span>
      </div>
      <div className="installation-map-layout">
        <aside className="installation-map-sidebar" aria-label="Адреса на карте">
          <div className="installation-map-actions">
            <button className="secondary compact" disabled={!points.length} onClick={onRouteSelectAll} type="button">
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
            {points.length ? (
              points.map((point) => (
                <article className={`installation-map-item status-${point.status}`} key={point.id}>
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
        <YandexInstallationsMap points={points} routePoints={routePoints} />
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
  const signature = points.map((point) => `${point.id}:${point.address}:${point.status}`).join("|");
  const routeSignature = routePoints.map((point) => `${point.id}:${point.address}`).join("|");

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
                const coordinates = await geocodeInstallationAddress(ymaps, point.address);
                return coordinates ? { coordinates, point } : undefined;
              } catch {
                return undefined;
              }
            }),
          );

          for (const item of geocoded.filter(Boolean) as Array<{ coordinates: number[]; point: InstallationMapPoint }>) {
            collection.add(
              new ymaps.Placemark(
                item.coordinates,
                {
                  balloonContent: `<strong>${escapeHtml(item.point.title)}</strong><br>${escapeHtml(item.point.address)}<br>${escapeHtml(item.point.statusLabel)}`,
                  hintContent: item.point.title,
                },
                {
                  preset: item.point.kind === "readyDeal" ? "islands#orangeDotIcon" : "islands#blueDotIcon",
                },
              ),
            );
          }

          map.geoObjects.add(collection);
          collectionRef.current = collection;

          if (routePoints.length >= 2) {
            routeRef.current = new ymaps.multiRouter.MultiRoute(
              {
                params: { routingMode: "auto" },
                referencePoints: routePoints.map((point) => point.address),
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
  selectedInstallationId,
  viewMode,
  onEdit,
  onSelect,
}: {
  dateKey: string;
  installers: ProductionEmployee[];
  installations: Installation[];
  selectedInstallationId?: string;
  viewMode: Exclude<InstallationViewMode, "list">;
  onEdit: (installation: Installation) => void;
  onSelect: (installation: Installation) => void;
}) {
  const unplanned = installations.filter(isUnplannedInstallation);
  const planned = installations.filter((installation) => !isUnplannedInstallation(installation));

  if (viewMode === "month") {
    return (
      <div className="installation-planner-shell">
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

  const lanes: PlannerLane[] = [
    { id: "unassigned", name: "Неназначенные", unassigned: true },
    ...installers.map((installer) => ({ id: installer.id, name: installer.name })),
  ];
  const periodDays = viewMode === "week" ? dateKeysBetween(plannerRange("week", dateKey).start, plannerRange("week", dateKey).end) : [dateKey];

  return (
    <div className="installation-planner-shell">
      <div className={`installation-scheduler installation-scheduler-${viewMode}`}>
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
                      style={plannerTimeStyle(installation)}
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

function InstallationPlannerCard({
  canReview,
  installation,
  selected,
  onAction,
  onEdit,
  onOpenDeal,
  onPhotoDelete,
  setSelected,
}: {
  canReview: boolean;
  installation: Installation;
  selected: boolean;
  onAction: (installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) => void;
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
            title="Открыть фото"
          >
            <img alt={photo.originalName || "Фото монтажа"} src={photo.thumbnailUrl || photo.url} />
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
  onEdit,
  onOpenDeal,
  onPhotoDelete,
}: {
  canReview: boolean;
  currentUser: ProductionEmployee;
  installation: Installation;
  onAction: (installation: Installation, action: "start" | "arrive" | "complete" | "approve" | "return" | "cancel" | "no-installation", note?: string) => void;
  onClose: () => void;
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
  installers,
  saving,
  state,
  onCancel,
  onChange,
  onSave,
}: {
  installers: ProductionEmployee[];
  saving: boolean;
  state: InstallationFormState;
  onCancel: () => void;
  onChange: (state: InstallationFormState) => void;
  onSave: (state: InstallationFormState) => void;
}) {
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
          {state.dealId ? (
            <label>
              Сделка
              <input value={`#${state.dealNumber || state.dealId} ${state.dealTitle}`} disabled />
            </label>
          ) : (
            <>
              <label>
                ID сделки
                <input value={state.dealId} onChange={(event) => onChange({ ...state, dealId: event.target.value })} placeholder="17044" />
              </label>
              <label>
                Номер
                <input value={state.dealNumber} onChange={(event) => onChange({ ...state, dealNumber: event.target.value })} placeholder="17044" />
              </label>
              <label>
                Название
                <input value={state.dealTitle} onChange={(event) => onChange({ ...state, dealTitle: event.target.value })} placeholder="Название сделки" />
              </label>
            </>
          )}
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
          <label className="full">
            Адрес
            <input
              value={state.address}
              onChange={(event) => onChange({ ...state, address: event.target.value, addressSource: "manual" })}
              placeholder="Адрес монтажа"
            />
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

  return [...installationPoints, ...readyPoints];
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
    return `Неделя ${formatInstallationDate(range.start)} - ${formatInstallationDate(range.end)}`;
  }
  if (viewMode === "month") {
    return parseDateKey(dateKey).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }
  return "Все монтажи";
}

function plannerRange(viewMode: Exclude<InstallationViewMode, "list">, dateKey: string) {
  if (viewMode === "day") return { start: dateKey, end: dateKey };
  if (viewMode === "week") {
    const start = startOfWeekDateKey(dateKey);
    return { start, end: addDaysToDateKey(start, 6) };
  }
  const date = parseDateKey(dateKey);
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

function plannerTimeStyle(installation: Installation): CSSProperties {
  const dayStart = plannerStartHour * 60;
  const dayEnd = plannerEndHour * 60;
  const start = Math.max(dayStart, Math.min(dayEnd, minutesFromTime(installation.timeFrom) ?? 10 * 60));
  const fallbackEnd = start + 90;
  const end = Math.max(start + 30, Math.min(dayEnd, minutesFromTime(installation.timeTo) ?? fallbackEnd));
  const span = dayEnd - dayStart;
  return {
    "--job-left": `${((start - dayStart) / span) * 100}%`,
    "--job-width": `${Math.max(8, ((end - start) / span) * 100)}%`,
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

  try {
    const result = await ymaps.geocode(normalizedAddress, { results: 1 });
    const first = result.geoObjects.get(0);
    const coordinates = first?.geometry?.getCoordinates?.();
    if (Array.isArray(coordinates) && coordinates.length >= 2) return coordinates;
  } catch {
    // A server-side geocoder proxy can be connected as a fallback below.
  }

  if (!YANDEX_GEOCODER_PROXY_URL) return undefined;

  try {
    const url = new URL(YANDEX_GEOCODER_PROXY_URL, window.location.origin);
    url.searchParams.set("geocode", normalizedAddress);
    const response = await fetch(url.toString());
    if (!response.ok) return undefined;
    const data = await response.json();
    const pos = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
    if (typeof pos !== "string") return undefined;
    const [lon, lat] = pos.split(/\s+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    return [lat, lon];
  } catch {
    return undefined;
  }
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
