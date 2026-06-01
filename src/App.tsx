import { useEffect, useMemo, useState } from "react";
import { CostDrawer } from "./components/CostDrawer";
import { DealTable } from "./components/DealTable";
import { loadCalculations, loadCatalogs, loadDeals } from "./lib/data";
import type { CatalogItem, Deal, DealCalculation, StoredCalculations } from "./types";
import "./styles.css";

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

  return (
    <div className="app">
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
      <CostDrawer
        deal={selectedDeal}
        calculation={selectedCalculation}
        catalogItems={catalogItems}
        storedCalculations={storedCalculations}
        onChange={handleCalculationChange}
        onClose={() => setSelectedDealId(undefined)}
      />
    </div>
  );
}
