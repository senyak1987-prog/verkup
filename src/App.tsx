import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Factory, LogOut, UsersRound } from "lucide-react";
import { AccessGate } from "./components/AccessGate";
import { CatalogManager } from "./components/CatalogManager";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { ProductionMobileApp } from "./components/ProductionMobileApp";
import { TechSpecBuilder } from "./components/TechSpecBuilder";
import {
  loadCalculations,
  loadCatalogs,
  loadDeals,
  loadProduction,
  loadTechSpecs,
  readCachedCalculations,
  readCachedCatalogs,
  readCachedDeals,
  readCachedProduction,
  readCachedTechSpecs,
  rememberCatalogFavoriteChanges,
  writeCachedCalculations,
  writeCachedCatalogs,
  writeCachedDeals,
  writeCachedProduction,
  writeCachedTechSpecs,
} from "./lib/data";
import { finalCost, formatMoney } from "./lib/costing";
import {
  accessRoleFor,
  accessRoleLabels,
  canAccessCosting,
  canAccessProduction,
  canManageEmployees,
  matchesEmployeeLogin,
  verifyEmployeePin,
} from "./lib/access";
import {
  defaultSaveApiUrl,
  saveProduction,
  saveTechSpecs,
  uploadTechSpecToBitrix,
} from "./lib/saveApi";
import { isUnresolvedResponsible } from "./lib/responsible";
import { stageCodeForDeal, stageLabels } from "./lib/stages";
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
  StoredCalculations,
  StoredProduction,
  StoredTechSpecs,
  TechSpecDraft,
} from "./types";
import "./styles.css";

const PENDING_STAGE_MOVE_TTL = 5 * 60 * 1000;
const DEAL_REFRESH_INTERVAL_MS = 2000;
const TECH_SPEC_SAVE_DELAY_MS = 900;
const PRODUCTION_SAVE_DELAY_MS = 700;
const DEAL_STAGE_TABS: DealStageCode[] = ["tz", "tzApproval", "launch", "production", "defect"];

type PendingStageMove = {
  stage: DealStageCode;
  expiresAt: number;
};

type AppTab = DealStageCode;

type WorkspaceMode = "costing" | "production" | "employees";

type DealWorkspaceTab = "cost" | "techSpec";

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
  const [selectedDealId, setSelectedDealId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => !hasCachedStartupData());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [pendingCatalogInsert, setPendingCatalogInsert] = useState<PendingCatalogInsert>();
  const [activeStage, setActiveStage] = useState<DealStageCode>("launch");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(() => defaultWorkspaceMode());
  const [currentEmployeeId, setCurrentEmployeeId] = useState(
    () => localStorage.getItem("verkup-current-employee-id") || "",
  );
  const pendingStageMovesRef = useRef(new Map<string, PendingStageMove>());
  const techSpecSaveTimerRef = useRef<number>();
  const productionSaveTimerRef = useRef<number>();

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
  const canUseProduction = canAccessProduction(currentEmployee);
  const canUseEmployees = canManageEmployees(currentEmployee);
  const availableModeCount = [canUseCosting, canUseProduction, canUseEmployees].filter(Boolean).length;

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [dealsData, calculationsData, catalogsData, techSpecsData, productionData] = await Promise.all([
          loadDeals(),
          loadCalculations(),
          loadCatalogs(),
          loadTechSpecs(),
          loadProduction(),
        ]);
        if (canceled) return;

        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        setStoredCalculations(calculationsData);
        setCatalogItems(catalogsData.items);
        setStoredTechSpecs(techSpecsData);
        setStoredProduction(productionData);
        writeCachedDeals({ ...dealsData, items: nextDeals });
        writeCachedCalculations(calculationsData);
        writeCachedCatalogs(catalogsData);
        writeCachedTechSpecs(techSpecsData);
        writeCachedProduction(productionData);
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
      const dealsData = await loadDeals();
      if (!canceled) {
        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        writeCachedDeals({ ...dealsData, items: nextDeals });
      }
    }

    async function refreshAllData() {
      const [dealsData, calculationsData, catalogsData, techSpecsData, productionData] = await Promise.all([
        loadDeals(),
        loadCalculations(),
        loadCatalogs(),
        loadTechSpecs(),
        loadProduction(),
      ]);
      if (canceled) return;

      const nextDeals = applyPendingStageMoves(dealsData.items);
      setDeals(nextDeals);
      setStoredCalculations(calculationsData);
      setCatalogItems(catalogsData.items);
      setStoredTechSpecs(techSpecsData);
      setStoredProduction(productionData);
      writeCachedDeals({ ...dealsData, items: nextDeals });
      writeCachedCalculations(calculationsData);
      writeCachedCatalogs(catalogsData);
      writeCachedTechSpecs(techSpecsData);
      writeCachedProduction(productionData);
    }

    const intervalId = window.setInterval(refreshDeals, DEAL_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshAllData);
    window.addEventListener("online", refreshAllData);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshAllData);
      window.removeEventListener("online", refreshAllData);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("verkup-workspace-mode", workspaceMode);
  }, [workspaceMode]);

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
  }, [canUseCosting, canUseEmployees, canUseProduction, currentEmployee, workspaceMode]);

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
      writeCachedTechSpecs(next);
      scheduleTechSpecSave(next);
      return next;
    });
  }

  function handleProductionChange(data: StoredProduction) {
    setStoredProduction(data);
    writeCachedProduction(data);
    scheduleProductionSave(data);
  }

  async function handleEmployeeLogin(login: string, password: string) {
    const employee = activeEmployees.find((item) => matchesEmployeeLogin(item, login));
    if (!employee) return false;
    const ok = await verifyEmployeePin(employee, password);
    if (ok) setCurrentEmployeeId(employee.id);
    return ok;
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

    handleProductionChange({
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
    });
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
      writeCachedTechSpecs(next);
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
      void saveTechSpecs({ apiUrl }, data).catch(() => {
        // Локальный черновик уже сохранен, повторим синхронизацию при следующем изменении.
      });
    }, TECH_SPEC_SAVE_DELAY_MS);
  }

  function scheduleProductionSave(data: StoredProduction) {
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;

    if (productionSaveTimerRef.current) {
      window.clearTimeout(productionSaveTimerRef.current);
    }

    productionSaveTimerRef.current = window.setTimeout(() => {
      void saveProduction({ apiUrl }, data).catch(() => {
        // Локальный производственный журнал уже сохранен, повторим синхронизацию при следующем изменении.
      });
    }, PRODUCTION_SAVE_DELAY_MS);
  }

  function handleCatalogChange(items: CatalogItem[]) {
    setCatalogItems((current) => {
      rememberCatalogFavoriteChanges(current, items);
      writeCachedCatalogs({
        generatedAt: new Date().toISOString(),
        items,
      });
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
          registrationAllowed={Boolean(activeRegistrationLink)}
          registrationToken={registrationToken}
          onLogin={handleEmployeeLogin}
          onRegister={handleRegistrationRequest}
        />
      </div>
    );
  }

  return (
    <div className="app">
      {loading && <div className="loading">Загружаю данные...</div>}
      {unresolvedResponsibleIds.length > 0 && (
        <div className="data-health-warning" role="status">
          <strong>Ответственные не распознаны</strong>
          <span>
            В локальных данных остались Bitrix ID: {unresolvedResponsibleIds.slice(0, 8).join(", ")}
            {unresolvedResponsibleIds.length > 8 ? " ..." : ""}. Запустите синхронизацию Bitrix и
            проверьте доступ webhook к user.get.
          </span>
        </div>
      )}
      <div className="access-bar">
        <div>
          <strong>{currentEmployee.name}</strong>
          {accessRoleFor(currentEmployee) !== "maker" ? (
            <span>{accessRoleLabels[accessRoleFor(currentEmployee)]}</span>
          ) : null}
        </div>
        <button className="secondary compact" onClick={handleLogout} type="button">
          <LogOut size={16} />
          Выйти
        </button>
      </div>
      {availableModeCount > 1 ? (
      <div className="app-mode-switch" role="tablist" aria-label="Режим приложения">
        {canUseCosting ? (
          <button
            aria-selected={workspaceMode === "costing"}
            className={workspaceMode === "costing" ? "active" : ""}
            onClick={() => setWorkspaceMode("costing")}
            role="tab"
            type="button"
          >
            <Calculator size={17} />
            Себестоимость
          </button>
        ) : null}
        {canUseProduction ? (
          <button
            aria-selected={workspaceMode === "production"}
            className={workspaceMode === "production" ? "active" : ""}
            onClick={() => setWorkspaceMode("production")}
            role="tab"
            type="button"
          >
            <Factory size={17} />
            Производство
          </button>
        ) : null}
        {canUseEmployees ? (
          <button
            aria-selected={workspaceMode === "employees"}
            className={workspaceMode === "employees" ? "active" : ""}
            onClick={() => setWorkspaceMode("employees")}
            role="tab"
            type="button"
          >
            <UsersRound size={17} />
            Сотрудники
          </button>
        ) : null}
      </div>
      ) : null}
      {workspaceMode === "employees" && canUseEmployees ? (
        <ProductionMobileApp
          calculations={calculationsMap}
          currentUser={currentEmployee}
          deals={deals}
          mode="employees"
          saveApiUrl={defaultSaveApiUrl()}
          techSpecs={techSpecsMap}
          storedProduction={storedProduction}
          onChange={handleProductionChange}
        />
      ) : workspaceMode === "production" && canUseProduction ? (
        <ProductionMobileApp
          calculations={calculationsMap}
          currentUser={currentEmployee}
          deals={deals}
          mode="production"
          saveApiUrl={defaultSaveApiUrl()}
          techSpecs={techSpecsMap}
          storedProduction={storedProduction}
          onChange={handleProductionChange}
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
                storedCalculations={storedCalculations}
                storedSpec={selectedTechSpec}
                onCatalogChange={handleCatalogChange}
                onChange={handleCalculationChange}
                onClose={() => setSelectedDealId(undefined)}
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
      {catalogOpen && workspaceMode === "costing" && (
        <CatalogManager
          items={catalogItems}
          initialDraft={pendingCatalogInsert?.item}
          onApplyAndReturn={pendingCatalogInsert ? handleCatalogInsertApplied : undefined}
          onChange={handleCatalogChange}
          onClose={handleCatalogClose}
        />
      )}
    </div>
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
    defaultDealWorkspaceTab(activeStage),
  );

  useEffect(() => {
    setActiveTab(defaultDealWorkspaceTab(activeStage));
  }, [activeStage, deal.id]);

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
        <button
          aria-selected={activeTab === stage}
          className={activeTab === stage ? "active" : ""}
          key={stage}
          onClick={() => onChange(stage)}
          role="tab"
          type="button"
        >
          {stageLabels[stage]}
          <span>{stageCounts[stage]}</span>
        </button>
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
  };
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
      readCachedProduction(),
  );
}

function uniqueSortedValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
}

function defaultWorkspaceMode(): WorkspaceMode {
  if (typeof window === "undefined") return "costing";

  const saved = localStorage.getItem("verkup-workspace-mode");
  if (saved === "costing" || saved === "production" || saved === "employees") return saved;

  const url = new URL(window.location.href);
  const requestedMode = url.searchParams.get("mode") || url.hash.replace(/^#/, "");
  if (requestedMode === "production" || requestedMode === "ceh" || requestedMode === "shop") {
    return "production";
  }
  if (requestedMode === "employees" || requestedMode === "staff" || requestedMode === "sotrudniki") {
    return "employees";
  }

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

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
