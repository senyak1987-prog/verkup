import {
  AlertTriangle,
  ArrowRight,
  Check,
  CirclePlus,
  Database,
  Github,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CatalogItem, CostPosition, Deal, DealCalculation, StoredCalculations } from "../types";
import {
  cleanCost,
  defectsCost,
  finalCost,
  formatMoney,
  formatPercent,
  isAgentDeal,
  margin,
  manufacturingCost,
  mountingCost,
  profit,
  saleBreakdownForDeal,
} from "../lib/costing";
import { filterCatalogItems, sectionLabels } from "../lib/catalog";
import { moveDealToProductionInGitHubActions, saveCalculationsToGitHub } from "../lib/githubStorage";
import { stageCodeForDeal } from "../lib/stages";

type CostDrawerProps = {
  deal?: Deal;
  calculation?: DealCalculation;
  catalogItems: CatalogItem[];
  storedCalculations: StoredCalculations;
  onClose: () => void;
  onOpenCatalog: () => void;
  onChange: (calculation: DealCalculation) => void;
  onMovedToProduction: (dealId: string) => void;
};

export function CostDrawer({
  deal,
  calculation,
  catalogItems,
  storedCalculations,
  onClose,
  onOpenCatalog,
  onChange,
  onMovedToProduction,
}: CostDrawerProps) {
  const [catalogQuery, setCatalogQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [moveState, setMoveState] = useState<"idle" | "moving" | "moved" | "error">("idle");
  const [moveError, setMoveError] = useState("");
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem("verkupGithubToken") || "");

  const activeCalculation = useMemo<DealCalculation>(() => {
    return (
      calculation || {
        dealId: deal?.id || "",
        updatedAt: new Date().toISOString(),
        positions: [],
      }
    );
  }, [calculation, deal?.id]);

  const filteredCatalog = filterCatalogItems(catalogItems, catalogQuery, 16);

  if (!deal) {
    return (
      <aside className="drawer placeholder">
        <Database size={28} />
        <h2>Выберите сделку</h2>
        <p>Расчет откроется здесь.</p>
      </aside>
    );
  }

  const sales = saleBreakdownForDeal(deal, activeCalculation, storedCalculations.agentCostRatio);
  const isAgent = isAgentDeal(deal);
  const dealCost = finalCost(activeCalculation);
  const isLaunchDeal = stageCodeForDeal(deal) === "launch";
  const hasGithubToken = githubToken.trim().length > 0;
  const hasCalculatedCost = dealCost > 0;
  const canMoveToProduction = isLaunchDeal && hasGithubToken && hasCalculatedCost;
  const moveHints = [
    !hasCalculatedCost ? "Добавьте хотя бы одну позицию себестоимости с суммой больше 0 ₽." : "",
    !hasGithubToken ? "Вставьте GitHub token с правами Contents и Actions: Read and write." : "",
  ].filter(Boolean);

  function updatePositions(positions: CostPosition[]) {
    onChange({
      dealId: deal!.id,
      updatedAt: new Date().toISOString(),
      positions,
    });
  }

  function addCatalogItem(item: CatalogItem) {
    updatePositions([
      ...activeCalculation.positions,
      {
        id: crypto.randomUUID(),
        section: item.section,
        title: item.title,
        qty: 1,
        unit: item.unit,
        unitCost: item.unitCost,
        note: item.source,
      },
    ]);
  }

  function addEmptyPosition(section: CostPosition["section"]) {
    updatePositions([
      ...activeCalculation.positions,
      {
        id: crypto.randomUUID(),
        section,
        title: "",
        qty: 1,
        unit: "шт",
        unitCost: 0,
      },
    ]);
  }

  function patchPosition(id: string, patch: Partial<CostPosition>) {
    updatePositions(
      activeCalculation.positions.map((position) =>
        position.id === id ? { ...position, ...patch } : position,
      ),
    );
  }

  function deletePosition(id: string) {
    updatePositions(activeCalculation.positions.filter((position) => position.id !== id));
  }

  function calculationPayload() {
    return {
      ...storedCalculations,
      generatedAt: new Date().toISOString(),
      calculations: upsertCalculation(storedCalculations, activeCalculation),
    };
  }

  async function saveToGitHub() {
    const token = githubToken.trim();
    setSaveState("saving");
    setSaveError("");
    localStorage.setItem("verkupGithubToken", token);
    try {
      await saveCalculationsToGitHub(
        {
          owner: "senyak1987-prog",
          repo: "verkup",
          branch: "main",
          token,
        },
        calculationPayload(),
      );
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить расчет");
    }
  }

  async function moveToProduction() {
    const activeDeal = deal;
    if (!activeDeal || !canMoveToProduction) return;

    const token = githubToken.trim();
    setMoveState("moving");
    setMoveError("");
    setSaveError("");
    localStorage.setItem("verkupGithubToken", token);

    try {
      await saveCalculationsToGitHub(
        {
          owner: "senyak1987-prog",
          repo: "verkup",
          branch: "main",
          token,
        },
        calculationPayload(),
      );
      await moveDealToProductionInGitHubActions(
        {
          owner: "senyak1987-prog",
          repo: "verkup",
          branch: "main",
          token,
        },
        activeDeal.id,
      );
      setSaveState("saved");
      setMoveState("moved");
      onMovedToProduction(activeDeal.id);
    } catch (error) {
      setMoveState("error");
      setMoveError(error instanceof Error ? error.message : "Не удалось перевести сделку");
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <span className="eyebrow">#{deal.number}</span>
          <h2>{deal.title}</h2>
          <p>{deal.responsible || "Ответственный не указан"}</p>
        </div>
        <button title="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <section className="summary-grid">
        <Summary label="Продажа всего" value={formatMoney(sales.totalSale)} />
        <Summary label="Изготовление" value={formatMoney(sales.productionSale)} />
        <Summary label="Монтаж" value={formatMoney(sales.installSale)} />
        <Summary label="Чистый себес" value={formatMoney(cleanCost(activeCalculation))} />
        <Summary label="Себес изделия" value={formatMoney(manufacturingCost(activeCalculation))} />
        <Summary label="Себес монтажа" value={formatMoney(mountingCost(activeCalculation))} />
        <Summary label="Косяки" value={formatMoney(defectsCost(activeCalculation))} />
        <Summary label="Итоговый себес" value={formatMoney(finalCost(activeCalculation))} />
        <Summary label="Прибыль" value={formatMoney(profit(deal, activeCalculation, storedCalculations.agentCostRatio))} />
        <Summary label="Маржа" value={formatPercent(margin(deal, activeCalculation, storedCalculations.agentCostRatio))} />
      </section>

      {isAgent && (
        <div className="notice">
          <AlertTriangle size={18} />
          <span>
            Для агента изготовление и монтаж считаются от соответствующей себестоимости по
            коэффициенту 0,58.
          </span>
        </div>
      )}

      <section className="catalog-panel">
        <div className="section-title">
          <h3>Добавить из справочника</h3>
          <span>{catalogItems.length} позиций</span>
        </div>
        <input
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          placeholder="Материал, сборка, фрезеровка..."
        />
        <div className="catalog-list">
          {filteredCatalog.map((item) => (
            <button key={item.id} onClick={() => addCatalogItem(item)}>
              <span>{item.title}</span>
              <small>
                {sectionLabels[item.section]} · {formatMoney(item.unitCost)} / {item.unit}
              </small>
            </button>
          ))}
        </div>
        <button className="secondary full" onClick={onOpenCatalog}>
          <Database size={16} />
          Открыть справочник
        </button>
      </section>

      <section className="positions">
        <div className="section-title">
          <h3>Позиции расчета</h3>
          <div className="quick-add">
            <button onClick={() => addEmptyPosition("materials")}>
              <CirclePlus size={16} /> Материал
            </button>
            <button onClick={() => addEmptyPosition("assembly")}>
              <CirclePlus size={16} /> Сборка
            </button>
            <button onClick={() => addEmptyPosition("print")}>
              <CirclePlus size={16} /> Печать
            </button>
            <button onClick={() => addEmptyPosition("mounting")}>
              <CirclePlus size={16} /> Монтаж
            </button>
            <button onClick={() => addEmptyPosition("subcontract")}>
              <CirclePlus size={16} /> Подряд
            </button>
            <button onClick={() => addEmptyPosition("defects")}>
              <CirclePlus size={16} /> Косяк
            </button>
          </div>
        </div>

        {activeCalculation.positions.map((position) => (
          <div className="position-row" key={position.id}>
            <select
              value={position.section}
              onChange={(event) =>
                patchPosition(position.id, { section: event.target.value as CostPosition["section"] })
              }
            >
              {Object.entries(sectionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="position-title"
              value={position.title}
              onChange={(event) => patchPosition(position.id, { title: event.target.value })}
              placeholder="Позиция"
            />
            <input
              type="number"
              value={position.qty}
              onChange={(event) => patchPosition(position.id, { qty: Number(event.target.value) })}
            />
            <input
              value={position.unit}
              onChange={(event) => patchPosition(position.id, { unit: event.target.value })}
            />
            <input
              type="number"
              value={position.unitCost}
              onChange={(event) => patchPosition(position.id, { unitCost: Number(event.target.value) })}
            />
            <strong>{formatMoney(position.qty * position.unitCost)}</strong>
            <button title="Удалить" onClick={() => deletePosition(position.id)}>
              <Trash2 size={16} />
            </button>
            <input
              className="position-note"
              value={position.note || ""}
              onChange={(event) => patchPosition(position.id, { note: event.target.value })}
              placeholder="Комментарий / источник"
            />
          </div>
        ))}

        {!activeCalculation.positions.length && (
          <p className="empty-state">Добавьте первую позицию из справочника или вручную.</p>
        )}
      </section>

      <section className="github-save">
        <div className="section-title">
          <h3>Сохранение</h3>
          <Github size={18} />
        </div>
        <input
          type="password"
          value={githubToken}
          onChange={(event) => setGithubToken(event.target.value)}
          placeholder="GitHub token с правами Contents и Actions: Read and write"
        />
        <button className="primary" disabled={!hasGithubToken || saveState === "saving"} onClick={saveToGitHub}>
          {saveState === "saved" ? <Check size={18} /> : <Save size={18} />}
          {saveState === "saving" ? "Сохраняю..." : "Сохранить расчет в GitHub"}
        </button>
        {isLaunchDeal && (
          <button
            className="production-button"
            disabled={!canMoveToProduction || moveState === "moving"}
            onClick={moveToProduction}
            title={
              !moveHints.length
                ? "Сохранить расчет и перевести сделку в стадию В производстве"
                : moveHints.join(" ")
            }
          >
            {moveState === "moved" ? <Check size={18} /> : <ArrowRight size={18} />}
            {moveState === "moving" ? "Перевожу..." : "Перевести в производство"}
          </button>
        )}
        {isLaunchDeal && moveState !== "moved" && !!moveHints.length && (
          <p className="hint">{moveHints.join(" ")}</p>
        )}
        {saveState === "error" && <p className="error">{saveError}</p>}
        {saveState === "saved" && <p className="ok">Расчет записан в репозиторий.</p>}
        {moveState === "error" && <p className="error">{moveError}</p>}
        {moveState === "moved" && (
          <p className="ok">Запущен перевод сделки в Bitrix24. Обновление подтянется после Actions.</p>
        )}
      </section>
    </aside>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function upsertCalculation(stored: StoredCalculations, calculation: DealCalculation) {
  const rest = stored.calculations.filter((item) => item.dealId !== calculation.dealId);
  return [...rest, calculation];
}
