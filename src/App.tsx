import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogManager } from "./components/CatalogManager";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import {
  loadCalculations,
  loadCatalogs,
  loadDeals,
  readCachedCalculations,
  readCachedCatalogs,
  readCachedDeals,
  writeCachedCalculations,
  writeCachedCatalogs,
  writeCachedDeals,
} from "./lib/data";
import { stageCodeForDeal } from "./lib/stages";
import type { CatalogItem, Deal, DealCalculation, DealStageCode, StoredCalculations } from "./types";
import "./styles.css";

const PENDING_STAGE_MOVE_TTL = 5 * 60 * 1000;

type PendingStageMove = {
  stage: DealStageCode;
  expiresAt: number;
};

export default function App() {
  const [deals, setDeals] = useState<Deal[]>(() => readCachedDeals()?.items || []);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(
    () => readCachedCatalogs()?.items || [],
  );
  const [storedCalculations, setStoredCalculations] = useState<StoredCalculations>(
    () => readCachedCalculations() || createEmptyStoredCalculations(),
  );
  const [selectedDealId, setSelectedDealId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(() => !hasCachedStartupData());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<DealStageCode>("launch");
  const pendingStageMovesRef = useRef(new Map<string, PendingStageMove>());

  useEffect(() => {
    let canceled = false;

    async function loadInitialData() {
      try {
        const [dealsData, calculationsData, catalogsData] = await Promise.all([
          loadDeals(),
          loadCalculations(),
          loadCatalogs(),
        ]);
        if (canceled) return;

        const nextDeals = applyPendingStageMoves(dealsData.items);
        setDeals(nextDeals);
        setStoredCalculations(calculationsData);
        setCatalogItems(catalogsData.items);
        writeCachedDeals({ ...dealsData, items: nextDeals });
        writeCachedCalculations(calculationsData);
        writeCachedCatalogs(catalogsData);
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
      const [dealsData, calculationsData, catalogsData] = await Promise.all([
        loadDeals(),
        loadCalculations(),
        loadCatalogs(),
      ]);
      if (canceled) return;

      const nextDeals = applyPendingStageMoves(dealsData.items);
      setDeals(nextDeals);
      setStoredCalculations(calculationsData);
      setCatalogItems(catalogsData.items);
      writeCachedDeals({ ...dealsData, items: nextDeals });
      writeCachedCalculations(calculationsData);
      writeCachedCatalogs(catalogsData);
    }

    const intervalId = window.setInterval(refreshDeals, 5000);
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

  const stageCounts = useMemo(() => {
    return deals.reduce(
      (counts, deal) => {
        counts[stageCodeForDeal(deal)] += 1;
        return counts;
      },
      { launch: 0, production: 0 } as Record<DealStageCode, number>,
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

  function handleCatalogChange(items: CatalogItem[]) {
    setCatalogItems(items);
    writeCachedCatalogs({
      generatedAt: new Date().toISOString(),
      items,
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
      <DealTable
        deals={filteredDeals}
        calculations={calculationsMap}
        agentRatio={storedCalculations.agentCostRatio}
        activeStage={activeStage}
        stageCounts={stageCounts}
        selectedDealId={selectedDealId}
        onSelect={handleDealToggle}
        onStageChange={setActiveStage}
        onOpenCatalog={() => setCatalogOpen(true)}
        catalogCount={catalogItems.length}
        query={query}
        onQueryChange={setQuery}
        expandedRow={
          selectedDeal ? (
            <CostDrawer
              deal={selectedDeal}
              calculation={selectedCalculation}
              catalogItems={catalogItems}
              storedCalculations={storedCalculations}
              onOpenCatalog={() => setCatalogOpen(true)}
              onChange={handleCalculationChange}
              onCatalogChange={handleCatalogChange}
              onClose={() => setSelectedDealId(undefined)}
              onStageMoved={handleDealStageChanged}
            />
          ) : undefined
        }
      />
      {catalogOpen && (
        <CatalogManager
          items={catalogItems}
          onChange={handleCatalogChange}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  );
}

function withStage(deal: Deal, stage: DealStageCode): Deal {
  return {
    ...deal,
    stageCode: stage,
    stageName: stage === "production" ? "В производстве" : "Запустить в производство",
  };
}

function createEmptyStoredCalculations(): StoredCalculations {
  return {
    generatedAt: new Date().toISOString(),
    agentCostRatio: 0.58,
    calculations: [],
  };
}

function hasCachedStartupData() {
  return Boolean(readCachedDeals() || readCachedCalculations() || readCachedCatalogs());
}
