import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Calculator, CalendarDays, Factory, LogOut, PackageSearch, UsersRound } from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { CatalogManager } from "./components/CatalogManager";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { InstallationsApp } from "./components/InstallationsApp";
import { ProductionMobileApp } from "./components/ProductionMobileApp";
import { TechSpecBuilder } from "./components/TechSpecBuilder";
import { WarehouseApp } from "./components/WarehouseApp";
import {
  loadCalculations,
  loadCatalogs,
  loadDeals,
  loadFreshCalculations,
  loadFreshCatalogs,
  loadFreshDeals,
  loadFreshInstallations,
  loadFreshProduction,
  loadFreshTechSpecs,
  loadFreshWarehouse,
  loadInstallations,
  loadProduction,
  loadTechSpecs,
  loadWarehouse,
  mergeServerStoredInstallations,
  mergeServerStoredProduction,
  embeddedProductionFromTechSpecs,
  readCachedCalculations,
  readCachedCatalogs,
  readCachedDeals,
  readCachedInstallations,
  readCachedProduction,
  readCachedTechSpecs,
  readCachedWarehouse,
  rememberCatalogFavoriteChanges,
  withEmbeddedProduction,
  writeCachedCalculations,
  writeCachedCatalogs,
  writeCachedDeals,
  writeCachedInstallations,
  writeCachedProduction,
  writeCachedTechSpecs,
  writeCachedWarehouse,
} from "./lib/data";
import { finalCost, formatMoney } from "./lib/costing";
import {
  accessRoleFor,
  accessRoleLabels,
  canAccessCosting,
  canAccessProduction,
  canManageEmployees,
  hasPermission,
  matchesEmployeeLogin,
  verifyEmployeePin,
} from "./lib/access";
import {
  defaultSaveApiUrl,
  saveCatalogs,
  saveCalculations,
  saveInstallations,
  saveProduction,
  saveTechSpecs,
  saveWarehouse,
  uploadTechSpecToBitrix,
} from "./lib/saveApi";
import { subscribeToRealtime } from "./lib/realtime";
import { isUnresolvedResponsible } from "./lib/responsible";
import { stageCodeForDeal, stageLabels } from "./lib/stages";
import { createEmptyStoredWarehouse } from "./lib/warehouse";
import type {
  CatalogItem,
  CostCalcMode,
  CostPosition,
  CostSection,
  Deal,
  DealCalculation,
  DealStageCode,
  DealTechSpec,
  ProductionEmployee,
  ProductionRegistrationRequest,
  RealtimeEvent,
  StoredCalculations,
  StoredInstallations,
  StoredProduction,
  StoredTechSpecs,
  StoredWarehouse,
  TechSpecDraft,
} from "./types";
import "./styles.css";

const PENDING_STAGE_MOVE_TTL = 5 * 60 * 1000;
const DEAL_REFRESH_INTERVAL_MS = 60_000;
const LIVE_DATA_REFRESH_INTERVAL_MS = 60_000;
const TECH_SPEC_SAVE_DELAY_MS = 180;
const PRODUCTION_SAVE_DELAY_MS = 180;
const INSTALLATIONS_SAVE_DELAY_MS = 180;
const WAREHOUSE_SAVE_DELAY_MS = 180;
const DEAL_STAGE_TABS: DealStageCode[] = ["tz", "tzApproval", "launch", "production", "defect"];

type PendingStageMove = {
  stage: DealStageCode;
  expiresAt: number;
};

type AppTab = DealStageCode;

type WorkspaceMode = "costing" | "production" | "installations" | "warehouse" | "employees";

const WORKSPACE_MODE_ROUTES: Record<WorkspaceMode, string> = {
  costing: "/cost",
  production: "/production",
  installations: "/installations",
  warehouse: "/warehouse",
  employees: "/employees",
};

const RAW_APP_BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
const APP_BASE_PATH = RAW_APP_BASE_PATH === "/" ? "" : RAW_APP_BASE_PATH;

const WORKSPACE_ROUTE_ALIASES: Record<string, WorkspaceMode> = {
  cost: "costing",
  costing: "costing",
  sebestoimost: "costing",
  себестоимость: "costing",
  production: "production",
  ceh: "production",
  shop: "production",
  proizvodstvo: "production",
  производство: "production",
  installations: "installations",
  installation: "installations",
  montazhi: "installations",
  montage: "installations",
  warehouse: "warehouse",
  sklad: "warehouse",
  склад: "warehouse",
  монтажи: "installations",
  employees: "employees",
  staff: "employees",
  sotrudniki: "employees",
  сотрудники: "employees",
};

function workspaceModeFromRouteValue(value?: string | null): WorkspaceMode | undefined {
  const normalized = (value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/^\?/, "")
    .replace(/^route=/, "")
    .replace(/^mode=/, "")
    .replace(/^\//, "")
    .split(/[/?#&]/)[0]
    .toLowerCase();

  return normalized ? WORKSPACE_ROUTE_ALIASES[normalized] : undefined;
}

function workspaceModeFromPathname(pathname: string): WorkspaceMode | undefined {
  let routePath = pathname;
  if (APP_BASE_PATH && routePath.toLowerCase().startsWith(APP_BASE_PATH.toLowerCase())) {
    routePath = routePath.slice(APP_BASE_PATH.length);
  }

  return workspaceModeFromRouteValue(routePath);
}

function workspaceModeFromUrl(): WorkspaceMode | undefined {
  if (typeof window === "undefined") return undefined;

  const url = new URL(window.location.href);
  return (
    workspaceModeFromPathname(url.pathname) ||
    workspaceModeFromRouteValue(url.searchParams.get("route")) ||
    workspaceModeFromRouteValue(url.hash) ||
    workspaceModeFromRouteValue(url.searchParams.get("mode"))
  );
}

function workspacePathForMode(mode: WorkspaceMode) {
  return `${APP_BASE_PATH}${WORKSPACE_MODE_ROUTES[mode]}`;
}

function updateWorkspaceUrl(mode: WorkspaceMode, replace = false) {
  if (typeof window === "undefined") return;

  const nextUrl = workspacePathForMode(mode);
  const hasLegacyRoute = Boolean(
    workspaceModeFromRouteValue(window.location.hash) || new URLSearchParams(window.location.search).get("route"),
  );
  if (window.location.pathname === nextUrl && !window.location.search && !hasLegacyRoute) return;

  if (replace) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }

  window.history.pushState(null, "", nextUrl);
}

type DealWorkspaceTab = "cost" | "techSpec";

type ProductionSaveOptions = {
  onSaveError?: () => void;
  onSaved?: () => void;
  saveNow?: boolean;
};

type QueuedProductionSave = {
  data: StoredProduction;
  options?: ProductionSaveOptions;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PendingCatalogInsert = {
  dealId: string;
  item: CatalogItem;
  targetSection?: CostSection;
};

type DealWorkspaceProps = {
  activeStage: DealStageCode;
  catalogItems: CatalogItem[];
  calculation?: DealCalculation;
  deal: Deal;
  costNote: string;
  initialTab?: DealWorkspaceTab;
  storedCalculations: StoredCalculations;
  storedSpec?: DealTechSpec;
  onCatalogChange: (items: CatalogItem[]) => void;
  onChange: (calculation: DealCalculation) => void;
  onClose: () => void;
  onCreateCatalogItem: (item: CatalogItem, targetSection?: CostSection) => void;
  onOpenCatalog: () => void;
  onStageMoved: (dealId: string, stage: DealStageCode) => void;
  onTechSpecChange: (spec: DealTechSpec) => void;
  onTechSpecUpload: (
    dealId: string,
    draft: TechSpecDraft,
    fileName: string,
    fileBase64: string,
  ) => Promise<void>;
};

type ManagerDealPortalProps = {
  deal?: Deal;
  loading: boolean;
  storedSpec?: DealTechSpec;
  onTechSpecChange: (spec: DealTechSpec) => void;
  onTechSpecUpload: (
    dealId: string,
    draft: TechSpecDraft,
    fileName: string,
    fileBase64: string,
  ) => Promise<void>;
};

export default function App() {
  const prefersReducedMotion = useReducedMotion();
  const [deals, setDeals] = useState<Deal[]>(() => readCachedDeals()?.items || []);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(
    () => readCachedCatalogs()?.items || [],
  );
  const [storedCalculations, setStoredCalculations] = useState<StoredCalculations>(
    () => readCachedCalculations() || createEmptyStoredCalculations(),
  );
  const [storedTechSpecs, setStoredTechSpecs] = useState<StoredTechSpecs>(
    () => readCachedTechSpecs() || createEmptyStoredTechSpecs(),
  );
  const [storedProduction, setStoredProduction] = useState<StoredProduction>(
    () => readCachedProduction() || createEmptyStoredProduction(),
  );
  const [storedInstallations, setStoredInstallations] = useState<StoredInstallations>(
    () => readCachedInstallations() || createEmptyStoredInstallations(),
  );
  const [storedWarehouse, setStoredWarehouse] = useState<StoredWarehouse>(
    () => readCachedWarehouse() || createEmptyStoredWarehouse(),
  );
  const [selectedDealId, setSelectedDealId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => !hasCachedStartupData());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [pendingCatalogInsert, setPendingCatalogInsert] = useState<PendingCatalogInsert>();
  const [activeStage, setActiveStage] = useState<DealStageCode>("launch");
  const [dealWorkspaceTab, setDealWorkspaceTab] = useState<DealWorkspaceTab>();
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => defaultWorkspaceMode());
  const [currentEmployeeId, setCurrentEmployeeId] = useState(
    () => localStorage.getItem("verkup-current-employee-id") || "",
  );
  const pendingStageMovesRef = useRef(new Map<string, PendingStageMove>());
  const techSpecSaveTimerRef = useRef<number>();
  const productionSaveTimerRef = useRef<number>();
  const installationsSaveTimerRef = useRef<number>();
  const warehouseSaveTimerRef = useRef<number>();
  const realtimeRefreshTimerRef = useRef<number>();
  const realtimeRefreshInFlightRef = useRef(false);
  const productionSaveInFlightRef = useRef(false);
  const queuedProductionSaveRef = useRef<QueuedProductionSave>();
  const storedTechSpecsRef = useRef(storedTechSpecs);
  const storedProductionRef = useRef(storedProduction);
  const storedInstallationsRef = useRef(storedInstallations);
  const storedWarehouseRef = useRef(storedWarehouse);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>();

  const activeEmployees = useMemo(
    () => storedProduction.employees.filter((employee) => employee.active !== false),
    [storedProduction.employees],
  );

  const currentEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === currentEmployeeId),
    [activeEmployees, currentEmployeeId],
  );

  const loginEmployees = useMemo(
    () =>
      activeEmployees.filter(
        (employee) => accessRoleFor(employee) !== "none" && Boolean(employee.pinHash),
      ),
    [activeEmployees],
  );

  const registrationToken = registrationTokenFromUrl();
  const activeRegistrationLink = useMemo(
    () =>
      registrationToken
        ? (storedProduction.registrationLinks || []).find(
            (link) => link.active && link.token === registrationToken,
          )
        : undefined,
    [registrationToken, storedProduction.registrationLinks],
  );
  const managerDealId = useMemo(() => managerDealIdFromUrl(), []);

  const canUseCosting = canAccessCosting(currentEmployee);
  const canUseProduction =
    canAccessProduction(currentEmployee) &&
    !(accessRoleFor(currentEmployee) === "maker" && currentEmployee?.role === "assembler");
  const canUseEmployees = canManageEmployees(currentEmployee);
  const canUseInstallations = canAccessInstallations(currentEmployee);
  const canUseWarehouse = canAccessWarehouse(currentEmployee);
  const availableModeCount = [canUseCosting, canUseProduction, canUseInstallations, canUseWarehouse, canUseEmployees].filter(Boolean).length;

  useEffect(() => {
    storedTechSpecsRef.current = storedTechSpecs;
  }, [storedTechSpecs]);

  useEffect(() => {
    storedProductionRef.current = storedProduction;
  }, [storedProduction]);

  useEffect(() => {
    storedInstallationsRef.current = storedInstallations;
  }, [storedInstallations]);

  useEffect(() => {
    storedWarehouseRef.current = storedWarehouse;
  }, [storedWarehouse]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => setInstallPrompt(undefined);

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  function applyLoadedProductionData(
    techSpecsData: StoredTechSpecs,
    productionData: StoredProduction,
    options: { syncBack?: boolean } = {},
  ) {
    const loadedProduction = productionWithEmbeddedFallback(productionData, techSpecsData);
    const nextProduction = mergeServerStoredProduction(loadedProduction, storedProductionRef.current);

    setStoredTechSpecs(techSpecsData);
    setStoredProduction(nextProduction);
    storedTechSpecsRef.current = techSpecsData;
    storedProductionRef.current = nextProduction;
    writeCachedTechSpecs(withEmbeddedProduction(techSpecsData, nextProduction));
    writeCachedProduction(nextProduction);

    if (options.syncBack && shouldSyncProductionToServer(loadedProduction, nextProduction)) {
      saveProductionNow(nextProduction);
    }

    return nextProduction;
  }

  function applyLoadedInstallationsData(installationsData: StoredInstallations) {
    const nextInstallations = mergeServerStoredInstallations(
      installationsData,
      storedInstallationsRef.current,
    );

    setStoredInstallations(nextInstallations);
    storedInstallationsRef.current = nextInstallations;
    writeCachedInstallations(nextInstallations);

    return nextInstallations;
  }

  useEffect(() => {
    if (!currentEmployeeId || !defaultSaveApiUrl()) return;

    let canceled = false;
    let inFlight = false;

    async function refreshProductionDataFromServer() {
      if (inFlight) return;
      inFlight = true;

      try {
        const [freshProduction, freshInstallations, freshWarehouse] = await Promise.all([
          loadFreshProduction(),
          loadFreshInstallations(),
          loadFreshWarehouse(),
        ]);
        if (canceled) return;

        const currentProduction = storedProductionRef.current;
        const nextProduction = mergeServerStoredProduction(freshProduction, currentProduction);
        applyLoadedInstallationsData(freshInstallations);
        setStoredWarehouse(freshWarehouse);
        storedWarehouseRef.current = freshWarehouse;
        writeCachedWarehouse(freshWarehouse);
        if (JSON.stringify(nextProduction) === JSON.stringify(currentProduction)) return;

        storedProductionRef.current = nextProduction;
        setStoredProduction(nextProduction);
        writeCachedProduction(nextProduction);
        writeCachedTechSpecs(withEmbeddedProduction(storedTechSpecsRef.current, nextProduction));
      } catch {
        // Тихо пропускаем сетевой сбой: пользователь все еще может обновить данные вручную.
      } finally {
        inFlight = false;
      }
    }

    const handleFocus = () => {
      void refreshProductionDataFromServer();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshProductionDataFromServer();
    };

    const intervalId = window.setInterval(
      () => void refreshProductionDataFromServer(),
      LIVE_DATA_REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [currentEmployeeId]);

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [dealsData, calculationsData, techSpecsData, productionData, installationsData, warehouseData] = await Promise.all([
          loadDeals(),
          loadCalculations(),
          loadTechSpecs(),
          loadProduction(),
          loadInstallations(),
          loadWarehouse(),
        ]);
        if (canceled) return;

        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        setStoredCalculations(calculationsData);
        applyLoadedProductionData(techSpecsData, productionData, { syncBack: true });
        applyLoadedInstallationsData(installationsData);
        setStoredWarehouse(warehouseData);
        storedWarehouseRef.current = warehouseData;
        writeCachedDeals({ ...dealsData, items: nextDeals });
        writeCachedCalculations(calculationsData);
        writeCachedWarehouse(warehouseData);
        void loadCatalogs().then((catalogsData) => {
          if (canceled) return;
          setCatalogItems(catalogsData.items);
          writeCachedCatalogs(catalogsData);
        });
      } finally {
        if (!canceled) setLoading(false);
      }
    }

    loadInitialData();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function refreshDeals() {
      const dealsData = await loadFreshDeals();
      if (!canceled) {
        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        writeCachedDeals({ ...dealsData, items: nextDeals });
      }
    }

    async function refreshProductionData() {
      const [calculationsData, techSpecsData, productionData, installationsData, warehouseData] = await Promise.all([
        loadFreshCalculations(),
        loadFreshTechSpecs(),
        loadFreshProduction(),
        loadFreshInstallations(),
        loadFreshWarehouse(),
      ]);
      if (canceled) return;

      setStoredCalculations(calculationsData);
      applyLoadedProductionData(techSpecsData, productionData);
      applyLoadedInstallationsData(installationsData);
      setStoredWarehouse(warehouseData);
      storedWarehouseRef.current = warehouseData;
      writeCachedCalculations(calculationsData);
      writeCachedWarehouse(warehouseData);
    }

    async function refreshAllData() {
      const [dealsData, calculationsData, catalogsData, techSpecsData, productionData, installationsData, warehouseData] = await Promise.all([
        loadFreshDeals(),
        loadFreshCalculations(),
        loadFreshCatalogs(),
        loadFreshTechSpecs(),
        loadFreshProduction(),
        loadFreshInstallations(),
        loadFreshWarehouse(),
      ]);
      if (canceled) return;

      const nextDeals = applyPendingStageMoves(dealsData.items);
      setDeals(nextDeals);
      setStoredCalculations(calculationsData);
      setCatalogItems(catalogsData.items);
      applyLoadedProductionData(techSpecsData, productionData);
      applyLoadedInstallationsData(installationsData);
      setStoredWarehouse(warehouseData);
      storedWarehouseRef.current = warehouseData;
      writeCachedDeals({ ...dealsData, items: nextDeals });
      writeCachedCalculations(calculationsData);
      writeCachedCatalogs(catalogsData);
      writeCachedWarehouse(warehouseData);
    }

    const intervalId = window.setInterval(refreshDeals, DEAL_REFRESH_INTERVAL_MS);
    const productionIntervalId = window.setInterval(refreshProductionData, LIVE_DATA_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshAllData);
    window.addEventListener("online", refreshAllData);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.clearInterval(productionIntervalId);
      window.removeEventListener("focus", refreshAllData);
      window.removeEventListener("online", refreshAllData);
    };
  }, []);

  useEffect(() => {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;

    const stopRealtime = subscribeToRealtime({
      apiUrl,
      onEvent: scheduleRealtimeRefresh,
      role: accessRoleFor(currentEmployee),
      userId: currentEmployeeId,
    });

    return () => {
      stopRealtime();
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
    };
  }, [currentEmployeeId, currentEmployee?.accessRole]);

  useEffect(() => {
    localStorage.setItem("verkup-workspace-mode", workspaceMode);
    updateWorkspaceUrl(workspaceMode, true);
  }, [workspaceMode]);

  useEffect(() => {
    const handleRouteChange = () => {
      const nextMode = workspaceModeFromUrl();
      if (nextMode) {
        setWorkspaceMode(nextMode);
      }
    };

    handleRouteChange();
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);

    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, []);

  useEffect(() => {
    if (!currentEmployeeId) return;
    if (currentEmployee) {
      localStorage.setItem("verkup-current-employee-id", currentEmployee.id);
      return;
    }
    localStorage.removeItem("verkup-current-employee-id");
    setCurrentEmployeeId("");
  }, [currentEmployee, currentEmployeeId]);

  useEffect(() => {
    if (!currentEmployee) return;
    if (accessRoleFor(currentEmployee) === "none" || !currentEmployee.pinHash) {
      localStorage.removeItem("verkup-current-employee-id");
      setCurrentEmployeeId("");
      return;
    }
    const availableModes: WorkspaceMode[] = [
      ...(canUseCosting ? (["costing"] as const) : []),
      ...(canUseProduction ? (["production"] as const) : []),
      ...(canUseInstallations ? (["installations"] as const) : []),
      ...(canUseWarehouse ? (["warehouse"] as const) : []),
      ...(canUseEmployees ? (["employees"] as const) : []),
    ];
    if (!availableModes.includes(workspaceMode) && availableModes[0]) {
      setWorkspaceMode(availableModes[0]);
      return;
    }
    if (workspaceMode === "costing" && !canUseCosting && canUseProduction) {
      setWorkspaceMode("production");
    }
    if (workspaceMode === "production" && !canUseProduction && canUseCosting) {
      setWorkspaceMode("costing");
    }
  }, [canUseCosting, canUseEmployees, canUseInstallations, canUseProduction, canUseWarehouse, currentEmployee, workspaceMode]);

  const calculationsMap = useMemo(() => {
    return new Map(storedCalculations.calculations.map((calculation) => [calculation.dealId, calculation]));
  }, [storedCalculations.calculations]);

  const techSpecsMap = useMemo(() => {
    return new Map(storedTechSpecs.specs.map((spec) => [spec.dealId, spec]));
  }, [storedTechSpecs.specs]);

  const managerDeal = useMemo(
    () => (managerDealId ? findDealForManagerLink(deals, managerDealId) : undefined),
    [deals, managerDealId],
  );
  const managerDealSpec = managerDeal ? techSpecsMap.get(managerDeal.id) : undefined;

  const stageCounts = useMemo(() => {
    return deals.reduce(
      (counts, deal) => {
        counts[stageCodeForDeal(deal)] += 1;
        return counts;
      },
      createEmptyStageCounts(),
    );
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const stageDeals = deals.filter((deal) => stageCodeForDeal(deal) === activeStage);
    if (!needle) return stageDeals;
    return stageDeals.filter((deal) =>
      [deal.number, deal.title, deal.source, deal.type, deal.classification, deal.responsible, deal.stageName]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [activeStage, deals, query]);

  const unresolvedResponsibleIds = useMemo(
    () =>
      uniqueSortedValues(
        deals
          .filter((deal) => isUnresolvedResponsible(deal.responsible))
          .map((deal) => deal.responsible),
      ),
    [deals],
  );

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId);
  const selectedCalculation = selectedDealId ? calculationsMap.get(selectedDealId) : undefined;
  const selectedTechSpec = selectedDealId ? techSpecsMap.get(selectedDealId) : undefined;

  useEffect(() => {
    if (selectedDealId && !filteredDeals.some((deal) => deal.id === selectedDealId)) {
      setSelectedDealId(undefined);
    }
  }, [filteredDeals, selectedDealId]);

  function handleDealToggle(deal: Deal) {
    setDealWorkspaceTab(undefined);
    setSelectedDealId((current) => (current === deal.id ? undefined : deal.id));
  }

  function handleCalculationChange(calculation: DealCalculation) {
    setStoredCalculations((current) => {
      const next = {
        ...current,
        generatedAt: new Date().toISOString(),
        calculations: [
          ...current.calculations.filter((item) => item.dealId !== calculation.dealId),
          calculation,
        ],
      };
      writeCachedCalculations(next);
      const apiUrl = defaultSaveApiUrl();
      if (apiUrl) {
        void saveCalculations({ apiUrl }, next).catch(() => {
          // Local cache already has this calculation; the next edit or refresh will retry sync.
        });
      }
      return next;
    });
  }

  function handleProductionCalculationChange(calculation: DealCalculation) {
    setStoredCalculations((current) => {
      const next = {
        ...current,
        generatedAt: new Date().toISOString(),
        calculations: [
          ...current.calculations.filter((item) => item.dealId !== calculation.dealId),
          calculation,
        ],
      };
      writeCachedCalculations(next);
      const apiUrl = defaultSaveApiUrl();
      if (apiUrl) {
        void saveCalculations({ apiUrl }, next).catch(() => {
          // The local calculation is already cached; the next save will retry sync.
        });
      }
      return next;
    });
  }

  function handleTechSpecChange(spec: DealTechSpec) {
    setStoredTechSpecs((current) => {
      const next = {
        ...current,
        generatedAt: new Date().toISOString(),
        specs: [
          ...current.specs.filter((item) => item.dealId !== spec.dealId),
          spec,
        ],
      };
      writeCachedTechSpecs(withEmbeddedProduction(next, storedProductionRef.current));
      scheduleTechSpecSave(next);
      return next;
    });
  }

  function handleProductionChange(data: StoredProduction, options: ProductionSaveOptions = {}) {
    setStoredProduction(data);
    storedProductionRef.current = data;
    writeCachedProduction(data);
    writeCachedTechSpecs(withEmbeddedProduction(storedTechSpecsRef.current, data));
    if (options.saveNow) saveProductionNow(data, options);
    else scheduleProductionSave(data, options);
  }

  function handleInstallationsChange(data: StoredInstallations, options: { saveNow?: boolean } = {}) {
    setStoredInstallations(data);
    storedInstallationsRef.current = data;
    writeCachedInstallations(data);
    if (options.saveNow) saveInstallationsNow(data);
    else scheduleInstallationsSave(data);
  }

  function handleWarehouseChange(data: StoredWarehouse, options: { saveNow?: boolean } = {}) {
    setStoredWarehouse(data);
    storedWarehouseRef.current = data;
    writeCachedWarehouse(data);
    if (options.saveNow) saveWarehouseNow(data);
    else scheduleWarehouseSave(data);
  }

  async function syncProductionCacheWithServer(localProduction: StoredProduction) {
    const serverProduction = await loadFreshProduction();
    if (!shouldSyncProductionToServer(serverProduction, localProduction)) return;

    const mergedProduction = mergeServerStoredProduction(serverProduction, localProduction);
    setStoredProduction(mergedProduction);
    storedProductionRef.current = mergedProduction;
    writeCachedProduction(mergedProduction);
    writeCachedTechSpecs(withEmbeddedProduction(storedTechSpecsRef.current, mergedProduction));
    saveProductionNow(mergedProduction);
  }

  function scheduleRealtimeRefresh(_event?: RealtimeEvent) {
    if (realtimeRefreshTimerRef.current) {
      window.clearTimeout(realtimeRefreshTimerRef.current);
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      void refreshAllDataNow();
    }, 140);
  }

  async function refreshAllDataNow() {
    if (realtimeRefreshInFlightRef.current) return;
    realtimeRefreshInFlightRef.current = true;

    try {
      const [
        dealsData,
        calculationsData,
        catalogsData,
        techSpecsData,
        productionData,
        installationsData,
        warehouseData,
      ] = await Promise.all([
        loadFreshDeals(),
        loadFreshCalculations(),
        loadFreshCatalogs(),
        loadFreshTechSpecs(),
        loadFreshProduction(),
        loadFreshInstallations(),
        loadFreshWarehouse(),
      ]);

      const nextDeals = applyPendingStageMoves(dealsData.items);
      setDeals(nextDeals);
      setStoredCalculations(calculationsData);
      setCatalogItems(catalogsData.items);
      applyLoadedProductionData(techSpecsData, productionData);
      applyLoadedInstallationsData(installationsData);
      setStoredWarehouse(warehouseData);
      storedWarehouseRef.current = warehouseData;
      writeCachedDeals({ ...dealsData, items: nextDeals });
      writeCachedCalculations(calculationsData);
      writeCachedCatalogs(catalogsData);
      writeCachedWarehouse(warehouseData);
    } finally {
      realtimeRefreshInFlightRef.current = false;
    }
  }

  async function handleEmployeeLogin(login: string, password: string) {
    const employee = await findVerifiedLoginEmployee(activeEmployees, login, password);
    if (employee) {
      setCurrentEmployeeId(employee.id);
      return true;
    }

    const [freshProduction, freshInstallations, freshWarehouse] = await Promise.all([
      loadFreshProduction(),
      loadFreshInstallations(),
      loadFreshWarehouse(),
    ]);
    setStoredProduction(freshProduction);
    applyLoadedInstallationsData(freshInstallations);
    setStoredWarehouse(freshWarehouse);
    storedWarehouseRef.current = freshWarehouse;
    storedProductionRef.current = freshProduction;
    writeCachedProduction(freshProduction);
    writeCachedWarehouse(freshWarehouse);
    writeCachedTechSpecs(withEmbeddedProduction(storedTechSpecsRef.current, freshProduction));

    const freshEmployee = await findVerifiedLoginEmployee(
      freshProduction.employees.filter((item) => item.active !== false),
      login,
      password,
    );
    if (freshEmployee) {
      setCurrentEmployeeId(freshEmployee.id);
      return true;
    }

    return false;
  }

  function handleLogout() {
    localStorage.removeItem("verkup-current-employee-id");
    setCurrentEmployeeId("");
  }

  function handleRegistrationRequest({
    name,
    phone,
    note,
  }: {
    name: string;
    phone: string;
    note: string;
  }) {
    if (!activeRegistrationLink) return;

    const employeeId = createId();
    const employee: ProductionEmployee = {
      id: employeeId,
      name,
      phone,
      role: "maker",
      accessRole: "none",
      active: true,
      createdAt: new Date().toISOString(),
    };
    const request: ProductionRegistrationRequest = {
      id: createId(),
      name,
      phone,
      note,
      status: "pending",
      requestedAt: new Date().toISOString(),
      employeeId,
    };

    handleProductionChange(
      {
        ...storedProduction,
        generatedAt: new Date().toISOString(),
        employees: [...storedProduction.employees, employee],
        registrations: [...(storedProduction.registrations || []), request],
        registrationLinks: (storedProduction.registrationLinks || []).map((link) =>
          link.id === activeRegistrationLink.id
            ? {
                ...link,
                active: false,
                usedAt: new Date().toISOString(),
                usedByRegistrationId: request.id,
              }
            : link,
        ),
      },
      { saveNow: true },
    );
  }

  async function handleTechSpecUpload(
    dealId: string,
    draft: TechSpecDraft,
    fileName: string,
    fileBase64: string,
  ) {
    const result = await uploadTechSpecToBitrix(
      { apiUrl: defaultSaveApiUrl() },
      {
        dealId,
        draft,
        fileName,
        fileBase64,
        mimeType: "image/jpeg",
      },
    );
    const nextSpec: DealTechSpec = {
      dealId,
      draft,
      updatedAt: new Date().toISOString(),
      bitrixFile: {
        field: result.field,
        name: fileName,
        uploadedAt: new Date().toISOString(),
      },
    };

    setStoredTechSpecs((current) => {
      const next = {
        ...current,
        generatedAt: new Date().toISOString(),
        specs: [
          ...current.specs.filter((item) => item.dealId !== dealId),
          nextSpec,
        ],
      };
      writeCachedTechSpecs(withEmbeddedProduction(next, storedProductionRef.current));
      scheduleTechSpecSave(next);
      return next;
    });
  }

  function scheduleTechSpecSave(data: StoredTechSpecs) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;

    if (techSpecSaveTimerRef.current) {
      window.clearTimeout(techSpecSaveTimerRef.current);
    }

    techSpecSaveTimerRef.current = window.setTimeout(() => {
      void saveTechSpecs({ apiUrl }, withEmbeddedProduction(data, storedProductionRef.current)).catch(() => {
        // Локальный черновик уже сохранен, повторим синхронизацию при следующем изменении.
      });
    }, TECH_SPEC_SAVE_DELAY_MS);
  }

  function saveProductionNow(data: StoredProduction, options: ProductionSaveOptions = {}) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) {
      options.onSaveError?.();
      return;
    }

    if (productionSaveTimerRef.current) {
      window.clearTimeout(productionSaveTimerRef.current);
      productionSaveTimerRef.current = undefined;
    }

    requestProductionSave(data, options);
  }

  function requestProductionSave(data: StoredProduction, options: ProductionSaveOptions = {}) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) {
      options.onSaveError?.();
      return;
    }

    if (productionSaveInFlightRef.current) {
      queuedProductionSaveRef.current = { data, options };
      return;
    }

    productionSaveInFlightRef.current = true;
    void saveProduction({ apiUrl }, data)
      .then(() => {
        options.onSaved?.();
      })
      .catch(async () => {
        const fallbackSaved = await saveProductionFallbackToTechSpecs(data);
        if (fallbackSaved) {
          options.onSaved?.();
          return;
        }

        options.onSaveError?.();
        if (!queuedProductionSaveRef.current) scheduleProductionSave(data, options);
      })
      .finally(() => {
        productionSaveInFlightRef.current = false;
        const queuedProductionSave = queuedProductionSaveRef.current;
        queuedProductionSaveRef.current = undefined;
        if (queuedProductionSave) requestProductionSave(queuedProductionSave.data, queuedProductionSave.options);
      });
  }

  async function saveProductionFallbackToTechSpecs(data: StoredProduction) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return false;

    try {
      await saveTechSpecs(
        { apiUrl },
        withEmbeddedProduction(storedTechSpecsRef.current, data),
      );
      return true;
    } catch {
      return false;
    }
  }

  function scheduleProductionSave(data: StoredProduction, options: ProductionSaveOptions = {}) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) {
      options.onSaveError?.();
      return;
    }

    if (productionSaveTimerRef.current) {
      window.clearTimeout(productionSaveTimerRef.current);
    }

    productionSaveTimerRef.current = window.setTimeout(() => {
      requestProductionSave(data, options);
    }, PRODUCTION_SAVE_DELAY_MS);
  }

  function saveInstallationsNow(data: StoredInstallations) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;
    if (installationsSaveTimerRef.current) {
      window.clearTimeout(installationsSaveTimerRef.current);
      installationsSaveTimerRef.current = undefined;
    }
    void saveInstallations({ apiUrl }, data).catch(() => {
      scheduleInstallationsSave(data);
    });
  }

  function scheduleInstallationsSave(data: StoredInstallations) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;
    if (installationsSaveTimerRef.current) {
      window.clearTimeout(installationsSaveTimerRef.current);
    }
    installationsSaveTimerRef.current = window.setTimeout(() => {
      void saveInstallations({ apiUrl }, data).catch(() => {
        // Локальный кэш уже обновлен, следующая правка повторит синхронизацию.
      });
    }, INSTALLATIONS_SAVE_DELAY_MS);
  }

  function saveWarehouseNow(data: StoredWarehouse) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;
    if (warehouseSaveTimerRef.current) {
      window.clearTimeout(warehouseSaveTimerRef.current);
      warehouseSaveTimerRef.current = undefined;
    }
    void saveWarehouse({ apiUrl }, data).catch(() => {
      scheduleWarehouseSave(data);
    });
  }

  function scheduleWarehouseSave(data: StoredWarehouse) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;
    if (warehouseSaveTimerRef.current) {
      window.clearTimeout(warehouseSaveTimerRef.current);
    }
    warehouseSaveTimerRef.current = window.setTimeout(() => {
      void saveWarehouse({ apiUrl }, data).catch(() => {
        // Local cache already has the latest warehouse state; the next edit will retry saving.
      });
    }, WAREHOUSE_SAVE_DELAY_MS);
  }

  function handleCatalogChange(items: CatalogItem[]) {
    setCatalogItems((current) => {
      rememberCatalogFavoriteChanges(current, items);
      const next = {
        generatedAt: new Date().toISOString(),
        items,
      };
      writeCachedCatalogs(next);
      const apiUrl = defaultSaveApiUrl();
      if (apiUrl) {
        void saveCatalogs({ apiUrl }, next).catch(() => {
          // Catalog changes remain cached locally and will be visible until the next successful sync.
        });
      }
      return items;
    });
  }

  function handleDealStageChanged(dealId: string, stage: DealStageCode) {
    pendingStageMovesRef.current.set(dealId, {
      stage,
      expiresAt: Date.now() + PENDING_STAGE_MOVE_TTL,
    });

    setDeals((current) => {
      const next = current.map((deal) =>
        deal.id === dealId ? withStage(deal, stage) : deal,
      );
      writeCachedDeals({
        generatedAt: new Date().toISOString(),
        items: next,
      });
      return next;
    });
    setActiveStage(stage);
  }

  function openCatalog() {
    setPendingCatalogInsert(undefined);
    setCatalogOpen(true);
  }

  function handleCreateCatalogItemFromCalculation(item: CatalogItem, targetSection?: CostSection) {
    if (!selectedDealId) return;

    setPendingCatalogInsert({
      dealId: selectedDealId,
      item,
      targetSection,
    });
    setCatalogOpen(true);
  }

  function handleCatalogInsertApplied(item: CatalogItem) {
    const request = pendingCatalogInsert;
    if (!request) return;

    const position = costPositionFromCatalogItem(item, request.targetSection);

    setStoredCalculations((current) => {
      const existing = current.calculations.find((calculation) => calculation.dealId === request.dealId) || {
        dealId: request.dealId,
        positions: [],
        updatedAt: new Date().toISOString(),
      };
      const nextCalculation = {
        ...existing,
        updatedAt: new Date().toISOString(),
        positions: [position, ...existing.positions],
      };
      const next = {
        ...current,
        generatedAt: new Date().toISOString(),
        calculations: [
          ...current.calculations.filter((calculation) => calculation.dealId !== request.dealId),
          nextCalculation,
        ],
      };
      writeCachedCalculations(next);
      return next;
    });

    setCatalogOpen(false);
    setPendingCatalogInsert(undefined);
  }

  function handleCatalogClose() {
    setCatalogOpen(false);
    setPendingCatalogInsert(undefined);
  }

  function handleTabChange(tab: AppTab) {
    setActiveStage(tab);
  }

  function handleWorkspaceModeChange(mode: WorkspaceMode) {
    setWorkspaceMode(mode);
    updateWorkspaceUrl(mode);
  }

  function handleWorkspaceLogoClick() {
    if (canUseCosting) {
      handleWorkspaceModeChange("costing");
    } else if (canUseProduction) {
      handleWorkspaceModeChange("production");
    } else if (canUseInstallations) {
      handleWorkspaceModeChange("installations");
    } else if (canUseWarehouse) {
      handleWorkspaceModeChange("warehouse");
    } else if (canUseEmployees) {
      handleWorkspaceModeChange("employees");
    }

    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }

  function scrollDealIntoView(dealId: string) {
    const safeDealId = dealId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const selectors = [
      `[data-deal-panel-id="${safeDealId}"]`,
      `[data-deal-id="${safeDealId}"]`,
      `[data-production-deal-id="${safeDealId}"]`,
    ];

    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const element = selectors
          .map((selector) => document.querySelector<HTMLElement>(selector))
          .find(Boolean);
        element?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      });
    }, 180);
  }

  async function handleInstallApp() {
    if (!installPrompt) return;
    const prompt = installPrompt;
    setInstallPrompt(undefined);
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
  }

  function handleProductionDealOpen(dealId: string, target: DealWorkspaceTab) {
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return;

    setActiveStage(stageCodeForDeal(deal));
    setSelectedDealId(deal.id);
    setDealWorkspaceTab(target === "techSpec" || !canUseCosting ? "techSpec" : "cost");
    setQuery("");
    if (canUseCosting) {
      handleWorkspaceModeChange("costing");
    } else if (canUseProduction) {
      handleWorkspaceModeChange("production");
    }
    scrollDealIntoView(deal.id);
  }

  function renderWorkspaceModeButtons() {
    return (
      <>
        {canUseCosting ? (
          <button
            aria-selected={workspaceMode === "costing"}
            className={workspaceMode === "costing" ? "active" : ""}
            onClick={(event) => { handleWorkspaceModeChange("costing"); event.currentTarget.blur(); }}
            role="tab"
            type="button"
          >
            <Calculator size={18} />
            <span>Себестоимость</span>
          </button>
        ) : null}
        {canUseProduction ? (
          <button
            aria-selected={workspaceMode === "production"}
            className={workspaceMode === "production" ? "active" : ""}
            onClick={(event) => { handleWorkspaceModeChange("production"); event.currentTarget.blur(); }}
            role="tab"
            type="button"
          >
            <Factory size={18} />
            <span>Производство</span>
          </button>
        ) : null}
        {canUseInstallations ? (
          <button
            aria-selected={workspaceMode === "installations"}
            className={workspaceMode === "installations" ? "active" : ""}
            onClick={(event) => { handleWorkspaceModeChange("installations"); event.currentTarget.blur(); }}
            role="tab"
            type="button"
          >
            <CalendarDays size={18} />
            <span>Монтажи</span>
          </button>
        ) : null}
        {canUseWarehouse ? (
          <button
            aria-selected={workspaceMode === "warehouse"}
            className={workspaceMode === "warehouse" ? "active" : ""}
            onClick={(event) => { handleWorkspaceModeChange("warehouse"); event.currentTarget.blur(); }}
            role="tab"
            type="button"
          >
            <PackageSearch size={18} />
            <span>Склад</span>
          </button>
        ) : null}
        {canUseEmployees ? (
          <button
            aria-selected={workspaceMode === "employees"}
            className={workspaceMode === "employees" ? "active" : ""}
            onClick={(event) => { handleWorkspaceModeChange("employees"); event.currentTarget.blur(); }}
            role="tab"
            type="button"
          >
            <UsersRound size={18} />
            <span>Сотрудники</span>
          </button>
        ) : null}
      </>
    );
  }

  const workspaceTitle =
    workspaceMode === "costing"
      ? "Себестоимость"
      : workspaceMode === "production"
        ? "Производство"
        : workspaceMode === "installations"
          ? "Монтажи"
          : workspaceMode === "warehouse"
            ? "Склад"
            : "Сотрудники";

  function applyPendingStageMoves(items: Deal[]) {
    const now = Date.now();

    return items.map((deal) => {
      const pending = pendingStageMovesRef.current.get(deal.id);
      if (!pending) return deal;

      if (pending.expiresAt <= now) {
        pendingStageMovesRef.current.delete(deal.id);
        return deal;
      }

      if (stageCodeForDeal(deal) === pending.stage) {
        pendingStageMovesRef.current.delete(deal.id);
        return deal;
      }

      return withStage(deal, pending.stage);
    });
  }

  if (loading && !activeEmployees.length) {
    return (
      <div className="app">
        <div className="loading">Загружаю данные...</div>
      </div>
    );
  }

  if (managerDealId) {
    return (
      <div className="app">
        <ManagerDealPortal
          deal={managerDeal}
          loading={loading}
          storedSpec={managerDealSpec}
          onTechSpecChange={handleTechSpecChange}
          onTechSpecUpload={handleTechSpecUpload}
        />
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <div className="app">
        <AccessGate
          employees={loginEmployees}
          installAvailable={Boolean(installPrompt)}
          registrationAllowed={Boolean(activeRegistrationLink)}
          registrationToken={registrationToken}
          onInstallApp={() => void handleInstallApp()}
          onLogin={handleEmployeeLogin}
          onRegister={handleRegistrationRequest}
        />
      </div>
    );
  }

  return (
    <motion.div
      className={`app workspace-app workspace-${workspaceMode}`}
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {loading && <div className="loading">Загружаю данные...</div>}
      {workspaceMode === "costing" && canUseCosting && unresolvedResponsibleIds.length > 0 && (
        <div className="data-health-warning" role="status">
          <strong>Ответственные не распознаны</strong>
          <span>
            В локальных данных остались Bitrix ID: {unresolvedResponsibleIds.slice(0, 8).join(", ")}
            {unresolvedResponsibleIds.length > 8 ? " ..." : ""}. Запустите синхронизацию Bitrix и
            проверьте доступ webhook к user.get.
          </span>
        </div>
      )}
      {accessRoleFor(currentEmployee) !== "maker" ? (
        <div className="access-bar">
          <div>
            <strong>{currentEmployee.name}</strong>
            <span>{accessRoleLabels[accessRoleFor(currentEmployee)]}</span>
          </div>
          <button className="secondary compact" onClick={handleLogout} type="button">
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      ) : null}
      {availableModeCount > 1 ? (
        <motion.aside
          className="app-mode-sidebar"
          aria-label="Навигация Verkup"
          initial={prefersReducedMotion ? false : { opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <button
            aria-label="Открыть главный экран Verkup"
            className="workspace-brand workspace-brand-button"
            onClick={handleWorkspaceLogoClick}
            type="button"
          >
            <img
              alt=""
              aria-hidden="true"
              className="workspace-brand-mark"
              src={`${import.meta.env.BASE_URL}verkup-logo-mark-fixed.svg`}
            />
            <img
              alt=""
              aria-hidden="true"
              className="workspace-brand-logo"
              src={`${import.meta.env.BASE_URL}verkup-logo-vector.svg`}
            />
            <span>Рабочее пространство</span>
          </button>
          <div className="app-mode-switch" role="tablist" aria-label="Режим приложения">
            {renderWorkspaceModeButtons()}
          </div>
          {accessRoleFor(currentEmployee) !== "maker" ? (
            <div className="workspace-user-card">
              <span>{accessRoleLabels[accessRoleFor(currentEmployee)]}</span>
              <strong>{currentEmployee.name}</strong>
              <button className="secondary compact" onClick={handleLogout} type="button">
                <LogOut size={16} />
                Выйти
              </button>
            </div>
          ) : null}
        </motion.aside>
      ) : null}
      <div className="workspace-shell">
        <motion.section
          key={workspaceMode}
          className="workspace-content"
          aria-label={workspaceTitle}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {availableModeCount > 1 ? (
            <header className="workspace-mobile-title">
              <span>Verkup</span>
              <strong>{workspaceTitle}</strong>
            </header>
          ) : null}
      {workspaceMode === "employees" && canUseEmployees ? (
        <ProductionMobileApp
          calculations={calculationsMap}
          catalogItems={catalogItems}
          currentUser={currentEmployee}
          deals={deals}
          mode="employees"
          saveApiUrl={defaultSaveApiUrl()}
          techSpecs={techSpecsMap}
          storedProduction={storedProduction}
          installAvailable={Boolean(installPrompt)}
          onCalculationChange={handleProductionCalculationChange}
          onChange={handleProductionChange}
          onDealStageChange={handleDealStageChanged}
          onInstallApp={() => void handleInstallApp()}
          onLogout={handleLogout}
          onOpenDeal={handleProductionDealOpen}
          onRefresh={refreshAllDataNow}
        />
      ) : workspaceMode === "production" && canUseProduction ? (
        <ProductionMobileApp
          calculations={calculationsMap}
          catalogItems={catalogItems}
          currentUser={currentEmployee}
          deals={deals}
          mode="production"
          saveApiUrl={defaultSaveApiUrl()}
          techSpecs={techSpecsMap}
          storedProduction={storedProduction}
          installAvailable={Boolean(installPrompt)}
          onCalculationChange={handleProductionCalculationChange}
          onChange={handleProductionChange}
          onDealStageChange={handleDealStageChanged}
          onInstallApp={() => void handleInstallApp()}
          onLogout={handleLogout}
          onOpenDeal={handleProductionDealOpen}
          onRefresh={refreshAllDataNow}
        />
      ) : workspaceMode === "installations" && canUseInstallations ? (
        <InstallationsApp
          currentUser={currentEmployee}
          deals={deals}
          saveApiUrl={defaultSaveApiUrl()}
          storedInstallations={storedInstallations}
          storedProduction={storedProduction}
          techSpecs={techSpecsMap}
          onChange={handleInstallationsChange}
          onLogout={handleLogout}
          onOpenDeal={handleProductionDealOpen}
          onRefresh={refreshAllDataNow}
        />
      ) : workspaceMode === "warehouse" && canUseWarehouse ? (
        <WarehouseApp
          catalogItems={catalogItems}
          currentUser={currentEmployee}
          deals={deals}
          saveApiUrl={defaultSaveApiUrl()}
          storedWarehouse={storedWarehouse}
          onCatalogChange={handleCatalogChange}
          onChange={handleWarehouseChange}
        />
      ) : canUseCosting ? (
        <DealTable
          deals={filteredDeals}
          calculations={calculationsMap}
          agentRatio={storedCalculations.agentCostRatio}
          selectedDealId={selectedDealId}
          topTabs={
            <AppTopTabs
              activeTab={activeStage}
              stageCounts={stageCounts}
              onChange={handleTabChange}
            />
          }
          onSelect={handleDealToggle}
          onOpenCatalog={openCatalog}
          catalogCount={catalogItems.length}
          query={query}
          onQueryChange={setQuery}
          expandedRow={
            selectedDeal ? (
              <DealWorkspace
                activeStage={activeStage}
                catalogItems={catalogItems}
                calculation={selectedCalculation}
                costNote={costNoteForCalculation(selectedCalculation)}
                deal={selectedDeal}
                initialTab={dealWorkspaceTab}
                storedCalculations={storedCalculations}
                storedSpec={selectedTechSpec}
                onCatalogChange={handleCatalogChange}
                onChange={handleCalculationChange}
                onClose={() => {
                  setSelectedDealId(undefined);
                  setDealWorkspaceTab(undefined);
                }}
                onCreateCatalogItem={handleCreateCatalogItemFromCalculation}
                onOpenCatalog={openCatalog}
                onStageMoved={handleDealStageChanged}
                onTechSpecChange={handleTechSpecChange}
                onTechSpecUpload={handleTechSpecUpload}
              />
            ) : undefined
          }
        />
      ) : (
        <main className="access-denied">
          {accessRoleFor(currentEmployee) === "manager"
            ? "Для менеджера откройте конкретную сделку из Bitrix. В этом режиме видна только она и ее ТЗ."
            : "Для этой роли нет доступных разделов."}
        </main>
      )}
        </motion.section>
        {availableModeCount > 1 ? (
          <nav className="workspace-bottom-nav app-mode-switch" role="tablist" aria-label="Режим приложения">
            {renderWorkspaceModeButtons()}
          </nav>
        ) : null}
      </div>
      <AnimatePresence>
        {catalogOpen && workspaceMode === "costing" && (
          <motion.div
            className="motion-modal-host"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <CatalogManager
              items={catalogItems}
              initialDraft={pendingCatalogInsert?.item}
              onApplyAndReturn={pendingCatalogInsert ? handleCatalogInsertApplied : undefined}
              onChange={handleCatalogChange}
              onClose={handleCatalogClose}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function defaultDealWorkspaceTab(stage: DealStageCode): DealWorkspaceTab {
  return stage === "tz" || stage === "tzApproval" ? "techSpec" : "cost";
}

function ManagerDealPortal({
  deal,
  loading,
  storedSpec,
  onTechSpecChange,
  onTechSpecUpload,
}: ManagerDealPortalProps) {
  if (loading && !deal) {
    return (
      <main className="manager-deal-portal">
        <div className="loading">Загружаю сделку...</div>
      </main>
    );
  }

  if (!deal) {
    return (
      <main className="manager-deal-portal">
        <section className="manager-deal-empty">
          <strong>Сделка не найдена</strong>
          <span>Проверьте ID в ссылке из Bitrix или обновите синхронизацию сделок.</span>
        </section>
      </main>
    );
  }

  return (
    <main className="manager-deal-portal">
      <header className="manager-deal-head">
        <div>
          <span className="eyebrow">ТЗ для менеджера</span>
          <h1>Сделка #{deal.number}</h1>
          <p>{deal.title || deal.classification || "Подготовка технического задания"}</p>
        </div>
        <a href={deal.bitrixUrl} rel="noreferrer" target="_blank">
          Открыть в Bitrix
        </a>
      </header>
      <TechSpecBuilder
        deal={deal}
        embedded
        storedSpec={storedSpec}
        onDraftChange={onTechSpecChange}
        onUploadToBitrix={(draft, fileName, fileBase64) =>
          onTechSpecUpload(deal.id, draft, fileName, fileBase64)
        }
      />
    </main>
  );
}

function DealWorkspace({
  activeStage,
  catalogItems,
  calculation,
  costNote,
  deal,
  initialTab,
  storedCalculations,
  storedSpec,
  onCatalogChange,
  onChange,
  onClose,
  onCreateCatalogItem,
  onOpenCatalog,
  onStageMoved,
  onTechSpecChange,
  onTechSpecUpload,
}: DealWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<DealWorkspaceTab>(() =>
    initialTab || defaultDealWorkspaceTab(activeStage),
  );

  useEffect(() => {
    setActiveTab(initialTab || defaultDealWorkspaceTab(activeStage));
  }, [activeStage, deal.id, initialTab]);

  return (
    <section className="deal-workspace" aria-label="Работа со сделкой">
      <div className="deal-workspace-tabs" role="tablist" aria-label="Действия по сделке">
        <button
          aria-selected={activeTab === "cost"}
          className={activeTab === "cost" ? "active" : ""}
          onClick={() => setActiveTab("cost")}
          role="tab"
          type="button"
        >
          Себестоимость производства
        </button>
        <button
          aria-selected={activeTab === "techSpec"}
          className={activeTab === "techSpec" ? "active" : ""}
          onClick={() => setActiveTab("techSpec")}
          role="tab"
          type="button"
        >
          Подготовить ТЗ
        </button>
      </div>

      <div className="deal-workspace-body">
        {activeTab === "techSpec" ? (
          <TechSpecBuilder
            deal={deal}
            embedded
            costNote={costNote}
            costPositions={calculation?.positions ?? []}
            storedSpec={storedSpec}
            onDraftChange={onTechSpecChange}
            onUploadToBitrix={(draft, fileName, fileBase64) =>
              onTechSpecUpload(deal.id, draft, fileName, fileBase64)
            }
          />
        ) : (
          <CostDrawer
            deal={deal}
            calculation={calculation}
            catalogItems={catalogItems}
            storedCalculations={storedCalculations}
            onOpenCatalog={onOpenCatalog}
            onCreateCatalogItem={onCreateCatalogItem}
            onChange={onChange}
            onCatalogChange={onCatalogChange}
            onClose={onClose}
            onStageMoved={onStageMoved}
          />
        )}
      </div>
    </section>
  );
}

function costNoteForCalculation(calculation?: DealCalculation) {
  if (!calculation?.positions.length) return "";
  return `Итоговая себестоимость производства по расчету: ${formatMoney(finalCost(calculation))}`;
}

function costPositionFromCatalogItem(item: CatalogItem, targetSection?: CostSection): CostPosition {
  const section = targetSection || item.section;
  const calcMode = modeForCatalogItem(item);

  return {
    id: crypto.randomUUID(),
    catalogId: item.id,
    section,
    title: section === "defects" ? `Брак: ${item.title}` : item.title,
    calcMode,
    qty: defaultQuantityForMode(calcMode),
    unit: item.unit,
    unitCost: item.unitCost,
    note: item.source,
  };
}

function modeForCatalogItem(item: CatalogItem): CostCalcMode {
  const title = item.title.toLowerCase();
  if (item.section === "assembly" && title.includes("букв")) return "letterAssembly";
  return modeForUnit(item.unit);
}

function modeForUnit(unit?: string): CostCalcMode {
  const normalized = (unit || "").toLowerCase();
  if (normalized.includes("м2") || normalized.includes("м²") || normalized.includes("кв")) return "area";
  if (normalized.includes("п/м") || normalized.includes("п.м") || normalized.includes("пог")) return "linear";
  if (normalized.includes("ч")) return "hourly";
  return "pieces";
}

function defaultQuantityForMode(mode: CostCalcMode) {
  return mode === "area" ? 0 : 1;
}

function AppTopTabs({
  activeTab,
  stageCounts,
  onChange,
}: {
  activeTab: AppTab;
  stageCounts: Record<DealStageCode, number>;
  onChange: (tab: AppTab) => void;
}) {
  return (
    <div className="stage-tabs" role="tablist" aria-label="Разделы">
      {DEAL_STAGE_TABS.map((stage) => (
        <motion.button
          aria-selected={activeTab === stage}
          className={activeTab === stage ? "active" : ""}
          key={stage}
          onClick={() => onChange(stage)}
          role="tab"
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          {stageLabels[stage]}
          <span>{stageCounts[stage]}</span>
        </motion.button>
      ))}
    </div>
  );
}

function withStage(deal: Deal, stage: DealStageCode): Deal {
  const stageNames: Record<DealStageCode, string> = {
    tz: "Подготовка ТЗ",
    tzApproval: "Согласование ТЗ",
    launch: "Запустить в производство",
    production: "В производстве",
    defect: "КОСЯК в заказе",
  };

  return {
    ...deal,
    stageCode: stage,
    stageName: stageNames[stage],
  };
}

function createEmptyStoredCalculations(): StoredCalculations {
  return {
    generatedAt: new Date().toISOString(),
    agentCostRatio: 0.58,
    calculations: [],
  };
}

function createEmptyStoredTechSpecs(): StoredTechSpecs {
  return {
    generatedAt: new Date().toISOString(),
    specs: [],
  };
}

function createEmptyStoredProduction(): StoredProduction {
  return {
    generatedAt: new Date().toISOString(),
    employees: [],
    registrations: [],
    registrationLinks: [],
    assignments: [],
    payouts: [],
    notifications: [],
  };
}

function createEmptyStoredInstallations(): StoredInstallations {
  return {
    generatedAt: new Date().toISOString(),
    installations: [],
    notifications: [],
  };
}

function productionWithEmbeddedFallback(
  production: StoredProduction,
  techSpecs: StoredTechSpecs,
) {
  const embeddedProduction = embeddedProductionFromTechSpecs(techSpecs);
  return embeddedProduction ? mergeServerStoredProduction(production, embeddedProduction) : production;
}

function createEmptyStageCounts(): Record<DealStageCode, number> {
  return {
    tz: 0,
    tzApproval: 0,
    launch: 0,
    production: 0,
    defect: 0,
  };
}

function hasCachedStartupData() {
  return Boolean(
    readCachedDeals() ||
      readCachedCalculations() ||
      readCachedCatalogs() ||
      readCachedTechSpecs() ||
      readCachedProduction() ||
      readCachedInstallations() ||
      readCachedWarehouse(),
  );
}

function uniqueSortedValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function canAccessInstallations(employee?: ProductionEmployee) {
  return hasPermission(employee, "installations.view");
}

function canAccessWarehouse(employee?: ProductionEmployee) {
  return hasPermission(employee, "warehouse.view");
}

function defaultWorkspaceMode(): WorkspaceMode {
  if (typeof window === "undefined") return "costing";

  const requestedMode = workspaceModeFromUrl();
  if (requestedMode) return requestedMode;

  const saved = localStorage.getItem("verkup-workspace-mode");
  if (
    saved === "costing" ||
    saved === "production" ||
    saved === "installations" ||
    saved === "warehouse" ||
    saved === "employees"
  ) return saved;

  return window.matchMedia("(max-width: 760px)").matches ? "production" : "costing";
}

function registrationTokenFromUrl() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("invite") ||
    url.searchParams.get("registration") ||
    url.searchParams.get("reg") ||
    ""
  ).trim();
}

function managerDealIdFromUrl() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const mode = (url.searchParams.get("mode") || "").trim().toLowerCase();
  const dealId =
    url.searchParams.get("dealId") ||
    url.searchParams.get("deal_id") ||
    url.searchParams.get("DEAL_ID") ||
    url.searchParams.get("bitrixDealId") ||
    url.searchParams.get("managerDeal") ||
    "";

  return mode === "manager" || dealId ? dealId.trim() : "";
}

function findDealForManagerLink(deals: Deal[], requestedDealId: string) {
  const requested = normalizeDealLookupId(requestedDealId);
  if (!requested) return undefined;

  return deals.find((deal) =>
    [deal.id, deal.number].some((value) => normalizeDealLookupId(value) === requested),
  );
}

function normalizeDealLookupId(value?: string) {
  return (value || "")
    .trim()
    .replace(/^deal_/i, "")
    .replace(/^D_/i, "")
    .toLowerCase();
}

async function findVerifiedLoginEmployee(
  employees: ProductionEmployee[],
  login: string,
  password: string,
) {
  const employee = employees.find((item) => matchesEmployeeLogin(item, login));
  if (!employee) return undefined;
  return (await verifyEmployeePin(employee, password)) ? employee : undefined;
}

function shouldSyncProductionToServer(
  serverProduction: StoredProduction,
  localProduction: StoredProduction,
) {
  const preferLocalRecords = isDateNewer(localProduction.generatedAt, serverProduction.generatedAt);

  return (
    hasMissingOrNewerRecords(serverProduction.employees || [], localProduction.employees || [], preferLocalRecords) ||
    hasMissingOrNewerRecords(
      serverProduction.registrations || [],
      localProduction.registrations || [],
      preferLocalRecords,
    ) ||
    hasMissingOrNewerRecords(
      serverProduction.registrationLinks || [],
      localProduction.registrationLinks || [],
      preferLocalRecords,
    ) ||
    hasMissingOrNewerRecords(
      serverProduction.assignments || [],
      localProduction.assignments || [],
      preferLocalRecords,
    ) ||
    hasMissingOrNewerRecords(serverProduction.payouts || [], localProduction.payouts || [], preferLocalRecords) ||
    hasMissingOrNewerRecords(
      serverProduction.notifications || [],
      localProduction.notifications || [],
      preferLocalRecords,
    )
  );
}

function hasMissingOrNewerRecords<T extends { id: string }>(
  serverRecords: T[],
  localRecords: T[],
  preferLocalRecords: boolean,
) {
  const serverById = new Map(serverRecords.map((record) => [record.id, record]));
  return localRecords.some((record) => {
    const serverRecord = serverById.get(record.id);
    return !serverRecord || (preferLocalRecords && JSON.stringify(serverRecord) !== JSON.stringify(record));
  });
}

function isDateNewer(candidate?: string, baseline?: string) {
  const candidateMs = Date.parse(candidate || "");
  const baselineMs = Date.parse(baseline || "");
  return Number.isFinite(candidateMs) && Number.isFinite(baselineMs) && candidateMs > baselineMs;
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
