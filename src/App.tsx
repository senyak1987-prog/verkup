import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CatalogManager } from "./components/CatalogManager";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { loadCalculations, loadCatalogs, loadDeals } from "./lib/data";
import { stageCodeForDeal } from "./lib/stages";
import type { CatalogItem, Deal, DealCalculation, DealStageCode, StoredCalculations } from "./types";
import "./styles.css";

const DRAWER_STORAGE_KEY = "verkupDrawerWidth";
const DEFAULT_DRAWER_WIDTH = 520;
const MIN_DRAWER_WIDTH = 420;
const MAX_DRAWER_WIDTH = 860;
const PENDING_STAGE_MOVE_TTL = 5 * 60 * 1000;

type PendingStageMove = {
  stage: DealStageCode;
  expiresAt: number;
};

export default function App() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [storedCalculations, setStoredCalculations] = useState<StoredCalculations>({
    generatedAt: new Date().toISOString(),
    agentCostRatio: 0.58,
    calculations: [],
  });
  const [selectedDealId, setSelectedDealId] = useState<string>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(() => loadDrawerWidth());
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<DealStageCode>("launch");
  const pendingStageMovesRef = useRef(new Map<string, PendingStageMove>());

  useEffect(() => {
    Promise.all([loadDeals(), loadCalculations(), loadCatalogs()])
      .then(([dealsData, calculationsData, catalogsData]) => {
        setDeals(applyPendingStageMoves(dealsData.items));
        setStoredCalculations(calculationsData);
        setCatalogItems(catalogsData.items);
        setSelectedDealId(dealsData.items[0]?.id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let canceled = false;

    async function refreshDeals() {
      const dealsData = await loadDeals();
      if (!canceled) setDeals(applyPendingStageMoves(dealsData.items));
    }

    const intervalId = window.setInterval(refreshDeals, 5000);
    window.addEventListener("focus", refreshDeals);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshDeals);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAWER_STORAGE_KEY, String(drawerWidth));
  }, [drawerWidth]);

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
    if (!filteredDeals.length) {
      setSelectedDealId(undefined);
      return;
    }

    if (!selectedDealId || !filteredDeals.some((deal) => deal.id === selectedDealId)) {
      setSelectedDealId(filteredDeals[0].id);
    }
  }, [filteredDeals, selectedDealId]);

  function handleCalculationChange(calculation: DealCalculation) {
    setStoredCalculations((current) => ({
      ...current,
      generatedAt: new Date().toISOString(),
      calculations: [
        ...current.calculations.filter((item) => item.dealId !== calculation.dealId),
        calculation,
      ],
    }));
  }

  function handleDealStageChanged(dealId: string, stage: DealStageCode) {
    pendingStageMovesRef.current.set(dealId, {
      stage,
      expiresAt: Date.now() + PENDING_STAGE_MOVE_TTL,
    });

    setDeals((current) =>
      current.map((deal) =>
        deal.id === dealId ? withStage(deal, stage) : deal,
      ),
    );
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

  function startDrawerResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = drawerWidth;
    document.body.classList.add("is-resizing-drawer");

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextWidth = clamp(
        startWidth + startX - pointerEvent.clientX,
        MIN_DRAWER_WIDTH,
        MAX_DRAWER_WIDTH,
      );
      setDrawerWidth(nextWidth);
    }

    function handlePointerUp() {
      document.body.classList.remove("is-resizing-drawer");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className="app" style={{ "--drawer-width": `${drawerWidth}px` } as CSSProperties}>
      {loading && <div className="loading">Загружаю данные...</div>}
      <DealTable
        deals={filteredDeals}
        calculations={calculationsMap}
        agentRatio={storedCalculations.agentCostRatio}
        activeStage={activeStage}
        stageCounts={stageCounts}
        selectedDealId={selectedDealId}
        onSelect={(deal) => setSelectedDealId(deal.id)}
        onStageChange={setActiveStage}
        onOpenCatalog={() => setCatalogOpen(true)}
        catalogCount={catalogItems.length}
        query={query}
        onQueryChange={setQuery}
      />
      <div
        aria-label="Изменить ширину расчета"
        className="drawer-resizer"
        role="separator"
        title="Потяните, чтобы изменить ширину панели расчета. Двойной клик сбрасывает ширину."
        onDoubleClick={() => setDrawerWidth(DEFAULT_DRAWER_WIDTH)}
        onPointerDown={startDrawerResize}
      />
      <CostDrawer
        deal={selectedDeal}
        calculation={selectedCalculation}
        catalogItems={catalogItems}
        storedCalculations={storedCalculations}
        onOpenCatalog={() => setCatalogOpen(true)}
        onChange={handleCalculationChange}
        onClose={() => setSelectedDealId(undefined)}
        onStageMoved={handleDealStageChanged}
      />
      {catalogOpen && (
        <CatalogManager
          items={catalogItems}
          onChange={setCatalogItems}
          onClose={() => setCatalogOpen(false)}
        />
      )}
    </div>
  );
}

function loadDrawerWidth() {
  const saved = Number(localStorage.getItem(DRAWER_STORAGE_KEY));
  return clamp(saved || DEFAULT_DRAWER_WIDTH, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function withStage(deal: Deal, stage: DealStageCode): Deal {
  return {
    ...deal,
    stageCode: stage,
    stageName: stage === "production" ? "В производстве" : "Запустить в производство",
  };
}
