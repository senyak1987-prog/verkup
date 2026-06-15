import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogManager } from "./components/CatalogManager";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { SignConfigurator } from "./components/PdfCalculator";
import { TechSpecBuilder } from "./components/TechSpecBuilder";
import {
  loadCalculations,
  loadCatalogs,
  loadDeals,
  loadTechSpecs,
  readCachedCalculations,
  readCachedCatalogs,
  readCachedDeals,
  readCachedTechSpecs,
  rememberCatalogFavoriteChanges,
  writeCachedCalculations,
  writeCachedCatalogs,
  writeCachedDeals,
  writeCachedTechSpecs,
} from "./lib/data";
import { defaultSaveApiUrl, saveTechSpecs, uploadTechSpecToBitrix } from "./lib/saveApi";
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
  StoredCalculations,
  StoredTechSpecs,
  TechSpecDraft,
} from "./types";
import "./styles.css";

const PENDING_STAGE_MOVE_TTL = 5 * 60 * 1000;
const DEAL_REFRESH_INTERVAL_MS = 2000;
const TECH_SPEC_SAVE_DELAY_MS = 900;
const DEAL_STAGE_TABS: DealStageCode[] = ["tz", "tzApproval", "launch", "production", "defect"];

type PendingStageMove = {
  stage: DealStageCode;
  expiresAt: number;
};

type AppTab = DealStageCode | "signConfigurator" | "techSpec";

type DealWorkspaceTab = "cost" | "techSpec" | "workCost";

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
  const [selectedDealId, setSelectedDealId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => !hasCachedStartupData());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [pendingCatalogInsert, setPendingCatalogInsert] = useState<PendingCatalogInsert>();
  const [activeStage, setActiveStage] = useState<DealStageCode>("launch");
  const [activeScreen, setActiveScreen] = useState<"deals" | "signConfigurator" | "techSpec">("deals");
  const pendingStageMovesRef = useRef(new Map<string, PendingStageMove>());
  const techSpecSaveTimerRef = useRef<number>();

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [dealsData, calculationsData, catalogsData, techSpecsData] = await Promise.all([
          loadDeals(),
          loadCalculations(),
          loadCatalogs(),
          loadTechSpecs(),
        ]);
        if (canceled) return;

        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        setStoredCalculations(calculationsData);
        setCatalogItems(catalogsData.items);
        setStoredTechSpecs(techSpecsData);
        writeCachedDeals({ ...dealsData, items: nextDeals });
        writeCachedCalculations(calculationsData);
        writeCachedCatalogs(catalogsData);
        writeCachedTechSpecs(techSpecsData);
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
      const [dealsData, calculationsData, catalogsData, techSpecsData] = await Promise.all([
        loadDeals(),
        loadCalculations(),
        loadCatalogs(),
        loadTechSpecs(),
      ]);
      if (canceled) return;

      const nextDeals = applyPendingStageMoves(dealsData.items);
      setDeals(nextDeals);
      setStoredCalculations(calculationsData);
      setCatalogItems(catalogsData.items);
      setStoredTechSpecs(techSpecsData);
      writeCachedDeals({ ...dealsData, items: nextDeals });
      writeCachedCalculations(calculationsData);
      writeCachedCatalogs(catalogsData);
      writeCachedTechSpecs(techSpecsData);
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

  const calculationsMap = useMemo(() => {
    return new Map(storedCalculations.calculations.map((calculation) => [calculation.dealId, calculation]));
  }, [storedCalculations.calculations]);

  const techSpecsMap = useMemo(() => {
    return new Map(storedTechSpecs.specs.map((spec) => [spec.dealId, spec]));
  }, [storedTechSpecs.specs]);

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
    setActiveScreen("deals");
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
    if (tab === "signConfigurator") {
      setSelectedDealId(undefined);
      setActiveScreen("signConfigurator");
      return;
    }

    if (tab === "techSpec") {
      setSelectedDealId(undefined);
      setActiveScreen("techSpec");
      return;
    }

    setActiveStage(tab);
    setActiveScreen("deals");
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

  return (
    <div className="app">
      {loading && <div className="loading">Загружаю данные...</div>}
      {activeScreen === "signConfigurator" ? (
        <SignConfigurator
          topTabs={
            <AppTopTabs
              activeTab="signConfigurator"
              stageCounts={stageCounts}
              onChange={handleTabChange}
            />
          }
        />
      ) : activeScreen === "techSpec" ? (
        <TechSpecBuilder
          topTabs={
            <AppTopTabs
              activeTab="techSpec"
              stageCounts={stageCounts}
              onChange={handleTabChange}
            />
          }
        />
      ) : (
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
      )}
      {catalogOpen && (
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

function DealWorkspace({
  activeStage,
  catalogItems,
  calculation,
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
          Себес
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
        <button
          aria-selected={activeTab === "workCost"}
          className={activeTab === "workCost" ? "active" : ""}
          onClick={() => setActiveTab("workCost")}
          role="tab"
          type="button"
        >
          Стоимость работы
        </button>
      </div>

      <div className="deal-workspace-body">
        {activeTab === "techSpec" ? (
          <TechSpecBuilder
            deal={deal}
            embedded
            storedSpec={storedSpec}
            onDraftChange={onTechSpecChange}
            onUploadToBitrix={(draft, fileName, fileBase64) =>
              onTechSpecUpload(deal.id, draft, fileName, fileBase64)
            }
          />
        ) : (
          <CostDrawer
            key={activeTab}
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
            initialExpandedBlockId={activeTab === "workCost" ? "assembly" : undefined}
          />
        )}
      </div>
    </section>
  );
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
      <button
        aria-selected={activeTab === "signConfigurator"}
        className={activeTab === "signConfigurator" ? "active app-tab-offset" : "app-tab-offset"}
        onClick={() => onChange("signConfigurator")}
        role="tab"
        type="button"
      >
        Конфигуратор вывесок
      </button>
      <button
        aria-selected={activeTab === "techSpec"}
        className={activeTab === "techSpec" ? "active" : ""}
        onClick={() => onChange("techSpec")}
        role="tab"
        type="button"
      >
        Тех ТЗ
      </button>
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
  return Boolean(readCachedDeals() || readCachedCalculations() || readCachedCatalogs() || readCachedTechSpecs());
}
