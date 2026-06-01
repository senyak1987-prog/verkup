import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { loadCalculations, loadCatalogs, loadDeals } from "./lib/data";
import type { CatalogItem, Deal, DealCalculation, StoredCalculations } from "./types";
import "./styles.css";

const DRAWER_STORAGE_KEY = "verkupDrawerWidth";
const DEFAULT_DRAWER_WIDTH = 520;
const MIN_DRAWER_WIDTH = 420;
const MAX_DRAWER_WIDTH = 860;

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

  useEffect(() => {
    Promise.all([loadDeals(), loadCalculations(), loadCatalogs()])
      .then(([dealsData, calculationsData, catalogsData]) => {
        setDeals(dealsData.items);
        setStoredCalculations(calculationsData);
        setCatalogItems(catalogsData.items);
        setSelectedDealId(dealsData.items[0]?.id);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(DRAWER_STORAGE_KEY, String(drawerWidth));
  }, [drawerWidth]);

  const calculationsMap = useMemo(() => {
    return new Map(storedCalculations.calculations.map((calculation) => [calculation.dealId, calculation]));
  }, [storedCalculations.calculations]);

  const filteredDeals = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return deals;
    return deals.filter((deal) =>
      [deal.number, deal.title, deal.source, deal.type, deal.classification, deal.responsible]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [deals, query]);

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId);
  const selectedCalculation = selectedDealId ? calculationsMap.get(selectedDealId) : undefined;

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
        selectedDealId={selectedDealId}
        onSelect={(deal) => setSelectedDealId(deal.id)}
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
        onCatalogItemsChange={setCatalogItems}
        onChange={handleCalculationChange}
        onClose={() => setSelectedDealId(undefined)}
      />
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
