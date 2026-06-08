import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Database,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CatalogItem,
  CostCalcMode,
  CostPosition,
  CostSection,
  Deal,
  DealCalculation,
  StoredCalculations,
} from "../types";
import {
  autoConsumablesCost,
  baseCleanCost,
  cleanCost,
  defectsCost,
  finalCost,
  formatMoney,
  formatPercent,
  isAgentDeal,
  manufacturingCost,
  margin,
  mountingCost,
  positionQuantity,
  positionTotal,
  profit,
  saleBreakdownForDeal,
} from "../lib/costing";
import {
  materialGroupLabel,
  sectionLabels,
  smartCatalogSearch,
  toggleCatalogFavorite,
} from "../lib/catalog";
import {
  defaultSaveApiUrl,
  isSaveApiUrlConfigured,
  moveDealToStage,
  persistSaveApiSettings,
  saveCatalogs,
  saveCalculations,
} from "../lib/saveApi";
import { stageCodeForDeal } from "../lib/stages";

type CostDrawerProps = {
  deal?: Deal;
  calculation?: DealCalculation;
  catalogItems: CatalogItem[];
  storedCalculations: StoredCalculations;
  onClose: () => void;
  onOpenCatalog: () => void;
  onCreateCatalogItem: (item: CatalogItem, targetSection?: CostSection) => void;
  onChange: (calculation: DealCalculation) => void;
  onCatalogChange: (items: CatalogItem[]) => void;
  onStageMoved: (dealId: string, stage: "launch" | "production") => void;
};

type BlockAction = {
  label: string;
  template: PositionTemplate;
};

type CostBlock = {
  id: string;
  title: string;
  hint: string;
  sections: CostSection[];
  actions: BlockAction[];
  isOther?: boolean;
  catalogSections?: CostSection[];
  catalogMaterialGroups?: string[];
  catalogTargetSection?: CostSection;
};

type PositionTemplate = Omit<Partial<CostPosition>, "id"> & {
  section: CostSection;
  title: string;
  calcMode: CostCalcMode;
};

const assemblyAddons = [
  { id: "glue", label: "Склейка", unitCost: 250 },
  { id: "face-film", label: "Накатка лица", unitCost: 50 },
  { id: "side-film", label: "Накатка борта", unitCost: 50 },
  { id: "leds", label: "Установка диодов", unitCost: 50 },
  { id: "frame-install", label: "Установка на раму", unitCost: 100 },
  { id: "backlight", label: "Контражур", unitCost: 50 },
  { id: "light-sides", label: "Световые борта", unitCost: 350 },
  { id: "acp-panel", label: "Сборка АКП панели", unitCost: 500 },
  { id: "acp-film", label: "Накатка пленки на АКП", unitCost: 250 },
  { id: "subframe", label: "Подрамник / усиление", unitCost: 350 },
] as const;

const materialFrameGroups = [
  "Листовые материалы",
  "Профили",
  "Металл",
  "Моб.стенды, стойки, штендеры",
];

const lightingMaterialGroups = [
  "Светодиоды и аксессуары",
];

const printMaterialGroups = [
  "Пленки",
  "Баннер, холст и ткани",
  "Бумага",
];

const costBlocks: CostBlock[] = [
  {
    id: "materials",
    title: "1. Материалы / рама",
    hint: "Листы считаются по м2, рама по погонным метрам.",
    sections: ["materials"],
    catalogMaterialGroups: materialFrameGroups,
    actions: [
      {
        label: "Материал м2",
        template: {
          section: "materials",
          title: "Материал",
          calcMode: "area",
          unit: "м2",
          unitCost: 0,
        },
      },
      {
        label: "Рама п/м",
        template: {
          section: "materials",
          title: "Рама",
          calcMode: "linear",
          unit: "п/м",
          unitCost: 0,
        },
      },
    ],
  },
  {
    id: "lighting",
    title: "2. Светотехника",
    hint: "Блоки, диоды и комплектующие по факту изготовления.",
    sections: ["lighting", "consumables"],
    catalogSections: ["lighting", "consumables", "materials"],
    catalogMaterialGroups: lightingMaterialGroups,
    catalogTargetSection: "lighting",
    actions: [
      {
        label: "Блок питания",
        template: {
          section: "lighting",
          title: "Блок питания",
          calcMode: "pieces",
          unit: "шт",
          unitCost: 0,
        },
      },
      {
        label: "Диоды",
        template: {
          section: "lighting",
          title: "Диоды",
          calcMode: "pieces",
          unit: "шт",
          unitCost: 0,
        },
      },
    ],
  },
  {
    id: "milling",
    title: "3. Фрезеровка",
    hint: "Материал, толщина и стоимость за погонный метр.",
    sections: ["milling"],
    actions: [
      {
        label: "Фрезеровка п/м",
        template: {
          section: "milling",
          title: "Фрезеровка",
          calcMode: "linear",
          unit: "п/м",
          unitCost: 0,
        },
      },
    ],
  },
  {
    id: "print",
    title: "4. Пленки / баннеры / печать / плоттер",
    hint: "Все позиции считаются по квадратным метрам.",
    sections: ["print", "plotter"],
    catalogSections: ["print", "plotter", "materials"],
    catalogMaterialGroups: printMaterialGroups,
    catalogTargetSection: "print",
    actions: [
      {
        label: "Печать м2",
        template: {
          section: "print",
          title: "Печать",
          calcMode: "area",
          unit: "м2",
          unitCost: 0,
        },
      },
      {
        label: "Пленка м2",
        template: {
          section: "print",
          title: "Пленка",
          calcMode: "area",
          unit: "м2",
          unitCost: 0,
        },
      },
      {
        label: "Плоттер м2",
        template: {
          section: "plotter",
          title: "Плоттерная резка",
          calcMode: "area",
          unit: "м2",
          unitCost: 0,
        },
      },
    ],
  },
  {
    id: "assembly",
    title: "5. Сборка / работа",
    hint: "Объемные буквы с наборами операций, АКП, монтаж и работа по часам.",
    sections: ["assembly", "mounting", "subcontract"],
    catalogSections: ["assembly"],
    catalogTargetSection: "assembly",
    actions: [
      {
        label: "Объемные буквы",
        template: {
          section: "assembly",
          title: "Объемные буквы",
          calcMode: "letterAssembly",
          unit: "шт",
          unitCost: 0,
          addons: [],
        },
      },
      {
        label: "Сборка АКП",
        template: {
          section: "assembly",
          title: "Сборка АКП панели",
          calcMode: "letterAssembly",
          unit: "шт",
          unitCost: 0,
          addons: ["acp-panel"],
        },
      },
      {
        label: "Работа/час",
        template: {
          section: "assembly",
          title: "Работа",
          calcMode: "hourly",
          unit: "ч",
          unitCost: 0,
        },
      },
      {
        label: "Монтаж",
        template: {
          section: "mounting",
          title: "Монтаж",
          calcMode: "pieces",
          unit: "усл",
          unitCost: 0,
        },
      },
      {
        label: "Подряд",
        template: {
          section: "subcontract",
          title: "Подряд",
          calcMode: "pieces",
          unit: "усл",
          unitCost: 0,
        },
      },
    ],
  },
  {
    id: "other",
    title: "6. Прочие",
    hint: "Ручной ввод: название, единица, количество и цена. Заполненные позиции сохраняются в справочнике.",
    sections: ["other"],
    isOther: true,
    actions: [
      {
        label: "Прочая позиция",
        template: {
          section: "other",
          title: "",
          calcMode: "pieces",
          unit: "шт",
          unitCost: 0,
          note: "Прочие",
        },
      },
    ],
  },
];

const defectActions: BlockAction[] = [
  {
    label: "Материал",
    template: {
      section: "defects",
      title: "Брак: материал",
      calcMode: "area",
      unit: "м2",
      unitCost: 0,
    },
  },
  {
    label: "Свет",
    template: {
      section: "defects",
      title: "Брак: светотехника",
      calcMode: "pieces",
      unit: "шт",
      unitCost: 0,
    },
  },
  {
    label: "Фрезеровка",
    template: {
      section: "defects",
      title: "Брак: фрезеровка",
      calcMode: "linear",
      unit: "п/м",
      unitCost: 0,
    },
  },
  {
    label: "Печать",
    template: {
      section: "defects",
      title: "Брак: печать",
      calcMode: "area",
      unit: "м2",
      unitCost: 0,
    },
  },
  {
    label: "Работа/час",
    template: {
      section: "defects",
      title: "Брак: работа",
      calcMode: "hourly",
      unit: "ч",
      unitCost: 0,
    },
  },
];

const defectBlock: CostBlock = {
  id: "defects",
  title: "8. Косяки / брак",
  hint: "Учет исправлений отдельно от чистого себеса.",
  sections: ["defects"],
  catalogSections: ["materials", "lighting", "milling", "print", "plotter", "assembly", "mounting", "subcontract"],
  catalogTargetSection: "defects",
  actions: defectActions,
};

const blockAddLabels: Record<string, string> = {
  materials: "материал",
  lighting: "светотехнику",
  milling: "фрезеровку",
  print: "печать / пленку",
  assembly: "работу",
  other: "прочее",
  defects: "косяк",
};

const manualItemTitles: Record<string, string> = {
  materials: "Новый материал",
  lighting: "Новая позиция светотехники",
  milling: "Новая фрезеровка",
  print: "Новая печать / пленка",
  assembly: "Новая работа",
  other: "Новое прочее",
  defects: "Новый косяк",
};

export function CostDrawer({
  deal,
  calculation,
  catalogItems,
  storedCalculations,
  onClose,
  onOpenCatalog,
  onCreateCatalogItem,
  onChange,
  onCatalogChange,
  onStageMoved,
}: CostDrawerProps) {
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [lastAddedPositionId, setLastAddedPositionId] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [moveState, setMoveState] = useState<"idle" | "moving" | "moved" | "error">("idle");
  const [moveError, setMoveError] = useState("");
  const [saveApiUrl, setSaveApiUrl] = useState(() => defaultSaveApiUrl());

  const activeCalculation = useMemo<DealCalculation>(() => {
    return (
      calculation || {
        dealId: deal?.id || "",
        updatedAt: new Date().toISOString(),
        positions: [],
      }
    );
  }, [calculation, deal?.id]);
  const hasSaveApiUrl = saveApiUrl.trim().length > 0;
  const autoSaveSignature = useMemo(
    () => JSON.stringify({
      catalogItems,
      dealId: activeCalculation.dealId,
      positions: activeCalculation.positions,
    }),
    [activeCalculation.dealId, activeCalculation.positions, catalogItems],
  );
  const autoSaveBaselineRef = useRef({ dealId: "", signature: "" });

  useEffect(() => {
    if (!deal?.id) return;
    autoSaveBaselineRef.current = {
      dealId: deal.id,
      signature: autoSaveSignature,
    };
    setSaveState("idle");
    setSaveError("");
  }, [deal?.id]);

  useEffect(() => {
    if (!deal?.id || !hasSaveApiUrl) return;

    const baseline = autoSaveBaselineRef.current;
    if (baseline.dealId !== deal.id || baseline.signature === autoSaveSignature) return;

    const timeoutId = window.setTimeout(async () => {
      const saved = await saveCalculation();
      if (saved) {
        autoSaveBaselineRef.current = {
          dealId: deal.id,
          signature: autoSaveSignature,
        };
      }
    }, 850);

    return () => window.clearTimeout(timeoutId);
  }, [autoSaveSignature, deal?.id, hasSaveApiUrl, saveApiUrl]);

  if (!deal) {
    return null;
  }

  const sales = saleBreakdownForDeal(deal, activeCalculation, storedCalculations.agentCostRatio);
  const isAgent = isAgentDeal(deal);
  const currentStage = stageCodeForDeal(deal);
  const isLaunchDeal = currentStage === "launch";
  const isProductionDeal = currentStage === "production";
  const canMoveStage = hasSaveApiUrl;
  const moveHints = [!hasSaveApiUrl ? "Укажите адрес API сохранения." : ""].filter(Boolean);

  function updatePositions(positions: CostPosition[]) {
    onChange({
      dealId: deal!.id,
      updatedAt: new Date().toISOString(),
      positions,
    });
    setSaveState("idle");
    setMoveState("idle");
  }

  function addPosition(template: PositionTemplate) {
    const id = crypto.randomUUID();
    const calcMode = template.calcMode || modeForUnit(template.unit);
    const position = normalizePosition({
      id,
      catalogId: template.section === "other" ? `other-manual-${id}` : template.catalogId,
      qty: defaultQuantityForMode(calcMode),
      unit: "шт",
      unitCost: 0,
      ...template,
    });

    setLastAddedPositionId(id);
    updatePositions([position, ...activeCalculation.positions]);
  }

  function addCatalogItem(item: CatalogItem, targetSection?: CostSection) {
    const section = targetSection || item.section;
    const calcMode = modeForCatalogItem(item);
    const isAssemblySet = item.section === "assembly" && Boolean(item.assemblyGroup);
    addPosition({
      section,
      title: section === "defects" ? `Брак: ${item.title}` : item.title,
      calcMode,
      qty: defaultQuantityForMode(calcMode),
      unit: item.unit,
      unitCost: item.unitCost,
      minCost: item.assemblyMinCost,
      note: item.source,
      catalogId: item.id,
      addons: isAssemblySet ? [] : undefined,
      baseMinCost: isAssemblySet ? item.assemblyMinCost : undefined,
      baseUnitCost: isAssemblySet ? item.unitCost : undefined,
    });
  }

  function addManualCatalogItem(block: CostBlock) {
    const manualCatalogItem = createManualCatalogItem(block);
    onCreateCatalogItem(manualCatalogItem, block.catalogTargetSection);
  }

  function toggleFavorite(item: CatalogItem) {
    onCatalogChange(toggleCatalogFavorite(catalogItems, item.id));
    setSaveState("idle");
  }

  function patchPosition(id: string, patch: Partial<CostPosition>) {
    let patchedPosition: CostPosition | undefined;
    const nextPositions = activeCalculation.positions.map((position) => {
      if (position.id !== id) return position;
      patchedPosition = normalizePosition({ ...position, ...patch });
      return patchedPosition;
    });

    updatePositions(nextPositions);

    if (patchedPosition?.section === "other") {
      onCatalogChange(catalogWithOtherPositions(catalogItems, nextPositions));
    } else if (patchedPosition?.catalogId) {
      const linkedCatalogItem = catalogItems.find((item) => item.id === patchedPosition?.catalogId);
      if (linkedCatalogItem && isManualBlockCatalogItem(linkedCatalogItem)) {
        onCatalogChange(syncManualCatalogPosition(catalogItems, linkedCatalogItem, patchedPosition));
      }
    }
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

  async function saveCalculation() {
    const settings = {
      apiUrl: saveApiUrl,
    };
    setSaveState("saving");
    setSaveError("");
    persistSaveApiSettings(settings);
    try {
      const nextCatalogItems = catalogWithOtherPositions(catalogItems, activeCalculation.positions);
      onCatalogChange(nextCatalogItems);
      await saveCalculations(settings, calculationPayload());
      await saveCatalogs(settings, {
        generatedAt: new Date().toISOString(),
        items: nextCatalogItems,
      });
      setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить расчет");
      return false;
    }
  }

  async function moveToStage(targetStage: "launch" | "production") {
    const activeDeal = deal;
    if (!activeDeal || currentStage === targetStage || !canMoveStage) return;

    const settings = {
      apiUrl: saveApiUrl,
    };
    setMoveState("moving");
    setMoveError("");
    setSaveError("");
    persistSaveApiSettings(settings);

    try {
      const nextCatalogItems = catalogWithOtherPositions(catalogItems, activeCalculation.positions);
      onCatalogChange(nextCatalogItems);
      await saveCalculations(settings, calculationPayload());
      await saveCatalogs(settings, {
        generatedAt: new Date().toISOString(),
        items: nextCatalogItems,
      });
      await moveDealToStage(settings, activeDeal.id, targetStage);
      setSaveState("saved");
      setMoveState("moved");
      onStageMoved(activeDeal.id, targetStage);
    } catch (error) {
      setMoveState("error");
      setMoveError(error instanceof Error ? error.message : "Не удалось перевести сделку");
    }
  }

  return (
    <section className="cost-popover">
      <div className="drawer-head">
        <div>
          <span className="eyebrow">#{deal.number}</span>
          <h2>{deal.title}</h2>
          <p>{deal.responsible || "Ответственный не указан"}</p>
        </div>
        <div className="drawer-actions">
          <button className="secondary compact" onClick={onOpenCatalog}>
            <Database size={16} />
            Справочник
          </button>
          <button title="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>

      <section className="summary-grid">
        <Summary label="Продажа всего" value={formatMoney(sales.totalSale)} />
        <Summary label="Изготовление" value={formatMoney(sales.productionSale)} />
        <Summary label="Монтаж" value={formatMoney(sales.installSale)} />
        <Summary label="База без расходников" value={formatMoney(baseCleanCost(activeCalculation))} />
        <Summary label="Расходники 7%" value={formatMoney(autoConsumablesCost(activeCalculation))} />
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

      <div className="cost-popover-grid">
        <section className="cost-builder">
          {costBlocks.map((block) => (
            <CostBlockView
              block={block}
              catalogItems={catalogItems}
              isOpen={expandedBlockId === block.id}
              key={block.id}
              newPositionId={lastAddedPositionId}
              positions={activeCalculation.positions.filter((position) =>
                block.sections.includes(position.section),
              )}
              onAddCatalog={addCatalogItem}
              onAddManualCatalogItem={addManualCatalogItem}
              onToggle={() => setExpandedBlockId((current) => current === block.id ? null : block.id)}
              onToggleFavorite={toggleFavorite}
              onPatch={patchPosition}
              onDelete={deletePosition}
            />
          ))}

          <section className="calc-block auto-consumables">
            <div className="calc-block-head">
              <div>
                <h3>7. Расходники</h3>
                <p>Автоматически 7% от чистой базы без брака.</p>
              </div>
              <strong>{formatMoney(autoConsumablesCost(activeCalculation))}</strong>
            </div>
            <div className="auto-consumables-row">
              <span>База: {formatMoney(baseCleanCost(activeCalculation))}</span>
              <span>Коэффициент: 7%</span>
              <span>Сумма: {formatMoney(autoConsumablesCost(activeCalculation))}</span>
            </div>
          </section>

          <CostBlockView
            block={defectBlock}
            catalogItems={catalogItems}
            isOpen={expandedBlockId === defectBlock.id}
            newPositionId={lastAddedPositionId}
            positions={activeCalculation.positions.filter((position) => position.section === "defects")}
            onAddCatalog={addCatalogItem}
            onAddManualCatalogItem={addManualCatalogItem}
            onDelete={deletePosition}
            onPatch={patchPosition}
            onToggle={() => setExpandedBlockId((current) => current === defectBlock.id ? null : defectBlock.id)}
            onToggleFavorite={toggleFavorite}
          />

          <section className="drawer-bottom-actions">
            <div className="autosave-status">
              {saveState === "saved" ? <Check size={16} /> : <Save size={16} />}
              <span>
                {!hasSaveApiUrl
                  ? "Автосохранение не настроено"
                  : saveState === "saving"
                    ? "Автосохраняю..."
                    : saveState === "saved"
                      ? "Изменения сохранены"
                      : "Автосохранение включено"}
              </span>
            </div>
            {!isSaveApiUrlConfigured() && (
              <input
                className="autosave-input"
                value={saveApiUrl}
                onChange={(event) => setSaveApiUrl(event.target.value)}
                placeholder="Адрес API сохранения, например https://verkup-save-api...workers.dev"
              />
            )}
            <div className="stage-action-row">
              {isLaunchDeal && (
                <button
                  className="production-button"
                  disabled={!canMoveStage || moveState === "moving"}
                  onClick={() => moveToStage("production")}
                  title={!moveHints.length ? "Перевести сделку в стадию В производстве" : moveHints.join(" ")}
                >
                  {moveState === "moved" ? <Check size={18} /> : <ArrowRight size={18} />}
                  {moveState === "moving" ? "Перевожу..." : "Перевести в производство"}
                </button>
              )}
              {isProductionDeal && (
                <button
                  className="production-button rollback"
                  disabled={!canMoveStage || moveState === "moving"}
                  onClick={() => moveToStage("launch")}
                  title={!moveHints.length ? "Вернуть сделку в стадию Запустить в производство" : moveHints.join(" ")}
                >
                  {moveState === "moved" ? <Check size={18} /> : <ArrowLeft size={18} />}
                  {moveState === "moving" ? "Откатываю..." : "Откатить в запуск"}
                </button>
              )}
            </div>
            {(isLaunchDeal || isProductionDeal) && moveState !== "moved" && !!moveHints.length && (
              <p className="hint">{moveHints.join(" ")}</p>
            )}
            {saveState === "error" && <p className="error">{saveError}</p>}
            {moveState === "error" && <p className="error">{moveError}</p>}
            {moveState === "moved" && (
              <p className="ok">Запущено изменение стадии в Bitrix24. Обновление подтянется после Actions.</p>
            )}
          </section>
        </section>
      </div>
    </section>
  );
}

function CostBlockView({
  block,
  catalogItems,
  isOpen,
  newPositionId,
  positions,
  onAddCatalog,
  onAddManualCatalogItem,
  onToggle,
  onToggleFavorite,
  onPatch,
  onDelete,
}: {
  block: CostBlock;
  catalogItems: CatalogItem[];
  isOpen: boolean;
  newPositionId: string;
  positions: CostPosition[];
  onAddCatalog: (item: CatalogItem, targetSection?: CostSection) => void;
  onAddManualCatalogItem: (block: CostBlock) => void;
  onToggle: () => void;
  onToggleFavorite: (item: CatalogItem) => void;
  onPatch: (id: string, patch: Partial<CostPosition>) => void;
  onDelete: (id: string) => void;
}) {
  const total = positions.reduce((sum, position) => sum + positionTotal(position), 0);
  const [shouldRenderBody, setShouldRenderBody] = useState(isOpen);
  const isBodyClosing = !isOpen && shouldRenderBody;

  useEffect(() => {
    if (isOpen) {
      setShouldRenderBody(true);
      return;
    }

    if (!shouldRenderBody) return;

    const timeoutId = window.setTimeout(() => {
      setShouldRenderBody(false);
    }, 190);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, shouldRenderBody]);

  return (
    <section className={`calc-block ${isOpen || shouldRenderBody ? "open" : "collapsed"}`}>
      <button className="calc-block-row" onClick={onToggle}>
        <div>
          <h3>{block.title}</h3>
          <p>{block.hint}</p>
        </div>
        <span className="calc-block-row-meta">
          <small>{positions.length} поз.</small>
          <strong>{formatMoney(total)}</strong>
          {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </span>
      </button>
      {shouldRenderBody && (
        <div className={`calc-block-body-shell ${isBodyClosing ? "closing" : "opening"}`}>
          <div className="calc-block-body">
            <BlockCatalogPicker
              block={block}
              catalogItems={catalogItems}
              onAdd={(item) => onAddCatalog(item, block.catalogTargetSection)}
              onToggleFavorite={onToggleFavorite}
            />
            <div className="calc-block-workspace">
              <div className="calc-lines-column">
                <PositionList
                  catalogItems={catalogItems}
                  emptyText="Пока нет позиций в этом блоке."
                  newPositionId={newPositionId}
                  positions={positions}
                  onDelete={onDelete}
                  onPatch={onPatch}
                  onToggleFavorite={onToggleFavorite}
                />
                <div className="calc-block-actions">
                  <button onClick={() => onAddManualCatalogItem(block)}>
                    <CirclePlus size={16} />
                    {manualCatalogButtonLabel(block)}
                  </button>
                </div>
              </div>
              <BlockFavorites
                block={block}
                catalogItems={catalogItems}
                positions={positions}
                onAdd={(item) => onAddCatalog(item, block.catalogTargetSection)}
                onToggleFavorite={onToggleFavorite}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function BlockCatalogPicker({
  block,
  catalogItems,
  onAdd,
  onToggleFavorite,
}: {
  block: CostBlock;
  catalogItems: CatalogItem[];
  onAdd: (item: CatalogItem) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}) {
  const catalogSections = block.catalogSections || block.sections;
  const [query, setQuery] = useState("");
  const sectionItems = useMemo(
    () => filterBlockCatalogItems(catalogItems, catalogSections, block.catalogMaterialGroups),
    [block.catalogMaterialGroups, catalogItems, catalogSections],
  );
  const addLabel = blockAddLabels[block.id] || "позицию";
  const quickSearchItems = useMemo(() => smartCatalogSearch(sectionItems, query).slice(0, 8), [query, sectionItems]);
  const hasQuickSearch = query.trim().length > 0;

  function addSelectedCatalogItem(item: CatalogItem) {
    setQuery("");
    onAdd(item);
  }

  return (
    <div className="block-catalog">
      <div className="block-add-card">
        <div className="block-add-tab">
          <CirclePlus size={16} />
          <span>Добавить {addLabel}</span>
        </div>
        <div className="catalog-cascade">
          <label className="catalog-field catalog-search-field">
            <span>Быстрый поиск</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Название, толщина, источник..."
            />
          </label>
          {hasQuickSearch && (
            <div className="catalog-search-results">
              {quickSearchItems.map((item) => (
                <div className="catalog-search-result" key={item.id}>
                  <button
                    className={item.favorite ? "favorite-toggle active" : "favorite-toggle"}
                    onClick={() => onToggleFavorite(item)}
                    title={item.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                  >
                    <Star size={15} />
                  </button>
                  <button
                    className="catalog-add-toggle"
                    onClick={() => addSelectedCatalogItem(item)}
                    title="Добавить"
                  >
                    <CirclePlus size={16} />
                  </button>
                  <button
                    className={item.imageUrl ? "catalog-search-result-main with-thumb" : "catalog-search-result-main"}
                    onClick={() => addSelectedCatalogItem(item)}
                  >
                    {item.imageUrl && <img className="catalog-thumb" src={item.imageUrl} alt="" loading="lazy" />}
                    <div className="catalog-item-text">
                      <span>{item.title}</span>
                      <small>
                        {sectionLabels[item.section]} · {formatMoney(item.unitCost)} / {item.unit}
                        {materialGroupLabel(item) ? ` · ${materialGroupLabel(item)}` : ""}
                      </small>
                    </div>
                  </button>
                </div>
              ))}
              {!quickSearchItems.length && (
                <p className="catalog-search-empty">Ничего не найдено. Попробуйте меньше слов или часть названия.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockFavorites({
  block,
  catalogItems,
  positions,
  onAdd,
  onToggleFavorite,
}: {
  block: CostBlock;
  catalogItems: CatalogItem[];
  positions: CostPosition[];
  onAdd: (item: CatalogItem) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}) {
  const catalogSections = block.catalogSections || block.sections;
  const sectionItems = useMemo(
    () => filterBlockCatalogItems(catalogItems, catalogSections, block.catalogMaterialGroups),
    [block.catalogMaterialGroups, catalogItems, catalogSections],
  );
  const catalogItemsById = useMemo(
    () => new Map(catalogItems.map((item) => [item.id, item])),
    [catalogItems],
  );
  const sectionItemIds = useMemo(
    () => new Set(sectionItems.map((item) => item.id)),
    [sectionItems],
  );
  const positionFavoriteItems = positions
    .map((position) => (position.catalogId ? catalogItemsById.get(position.catalogId) : undefined))
    .filter((item): item is CatalogItem => Boolean(item?.favorite && sectionItemIds.has(item.id)));
  const favoriteItems = uniqueCatalogItems([
    ...sectionItems.filter((item) => item.favorite),
    ...positionFavoriteItems,
  ]).slice(0, 24);
  const [hoveredItem, setHoveredItem] = useState<{
    item: CatalogItem;
    left: number;
    top: number;
  } | null>(null);

  function showFavoriteInfo(item: CatalogItem, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const gap = 10;
    const margin = 12;
    const width = Math.min(320, window.innerWidth - margin * 2);
    const height = Math.min(320, window.innerHeight - margin * 2);
    const canOpenLeft = rect.left >= width + gap + margin;
    const left = canOpenLeft
      ? rect.left - width - gap
      : Math.min(window.innerWidth - width - margin, rect.right + gap);
    const centeredTop = rect.top + rect.height / 2 - height / 2;

    setHoveredItem({
      item,
      left: Math.max(margin, left),
      top: Math.max(margin, Math.min(centeredTop, window.innerHeight - height - margin)),
    });
  }

  return (
    <aside className="block-favorites">
      <div className="section-title compact">
        <h3>Избранное</h3>
        <span>{favoriteItems.length}</span>
      </div>
      <div className="block-favorite-list">
        {favoriteItems.map((item) => (
          <div
            className="block-favorite-item"
            key={item.id}
            onClick={() => onAdd(item)}
            onFocus={(event) => showFavoriteInfo(item, event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onAdd(item);
              }
            }}
            onMouseEnter={(event) => showFavoriteInfo(item, event.currentTarget)}
            onMouseLeave={() => setHoveredItem(null)}
            onBlur={() => setHoveredItem(null)}
            role="button"
            tabIndex={0}
          >
            <div className="block-favorite-main">
              <div className="favorite-thumb">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" loading="lazy" />
                ) : (
                  <Database size={16} />
                )}
              </div>
              <div className="catalog-item-text">
                <span>{item.title}</span>
                <small>{formatMoney(item.unitCost)} / {item.unit}</small>
              </div>
            </div>
            <button
              className="favorite-toggle active"
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(item);
              }}
              title="Убрать из избранного"
              type="button"
            >
              <Star size={15} />
            </button>
          </div>
        ))}
        {!favoriteItems.length && (
          <p className="empty-state compact">Отметьте позицию звездой, и она будет здесь во всех сделках.</p>
        )}
      </div>
      {hoveredItem &&
        createPortal(
          <FavoriteInfoPopover
            item={hoveredItem.item}
            style={{
              left: hoveredItem.left,
              top: hoveredItem.top,
            }}
          />,
          document.body,
        )}
    </aside>
  );
}

function FavoriteInfoPopover({
  item,
  style,
}: {
  item: CatalogItem;
  style: { left: number; top: number };
}) {
  const details = favoriteInfoRows(item);

  return (
    <div className="favorite-info-popover" style={style}>
      <div className="favorite-info-head">
        <div className="favorite-info-thumb">
          {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <Database size={22} />}
        </div>
        <div>
          <strong>{item.title}</strong>
          <span>
            {sectionLabels[item.section]} · {formatMoney(item.unitCost)} / {item.unit}
          </span>
        </div>
      </div>
      <dl>
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function favoriteInfoRows(item: CatalogItem) {
  const rows: Array<[string, string]> = [];
  const group = materialGroupLabel(item);

  if (group) rows.push(["Группа", group]);
  if (item.assemblyOperation) rows.push(["Операция", item.assemblyOperation]);
  if (item.assemblyMinCost) rows.push(["Минимум", formatMoney(item.assemblyMinCost)]);
  if (item.productCode) rows.push(["Код", item.productCode]);
  if (item.source) rows.push(["Источник", item.source]);
  if (item.productUrl) rows.push(["Ссылка", item.productUrl]);

  return rows;
}

function PositionList({
  catalogItems,
  emptyText,
  newPositionId,
  positions,
  onPatch,
  onDelete,
  onToggleFavorite,
}: {
  catalogItems: CatalogItem[];
  emptyText: string;
  newPositionId: string;
  positions: CostPosition[];
  onPatch: (id: string, patch: Partial<CostPosition>) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (item: CatalogItem) => void;
}) {
  if (!positions.length) {
    return <p className="calc-block-empty">{emptyText}</p>;
  }

  return (
    <div className="calc-lines">
      {positions.map((position) => (
        <div
          className={position.id === newPositionId ? "calc-line-item newest" : "calc-line-item"}
          key={position.id}
        >
          <PositionEditor
            catalogItem={catalogItems.find((item) => item.id === position.catalogId)}
            catalogItems={catalogItems}
            position={position}
            onDelete={() => onDelete(position.id)}
            onPatch={(patch) => onPatch(position.id, patch)}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      ))}
    </div>
  );
}

function PositionEditor({
  catalogItem,
  catalogItems,
  position,
  onPatch,
  onDelete,
  onToggleFavorite,
}: {
  catalogItem?: CatalogItem;
  catalogItems: CatalogItem[];
  position: CostPosition;
  onPatch: (patch: Partial<CostPosition>) => void;
  onDelete: () => void;
  onToggleFavorite: (item: CatalogItem) => void;
}) {
  const quantity = positionQuantity(position);
  const total = positionTotal(position);
  const areaInputValue = position.calcMode === "area" ? areaFieldValue(position) : position.qty;
  const assemblyOptions = assemblyCatalogAddonOptions(position, catalogItems);
  const hasCatalogAssemblyOptions = assemblyOptions.length > 0;
  const assemblyAddonsToShow = hasCatalogAssemblyOptions
    ? assemblyOptions
    : assemblyAddons.map((addon) => ({
        id: addon.id,
        label: addon.label,
        minCost: 0,
        unit: position.unit,
        unitCost: addon.unitCost,
      }));

  function patchNumber(field: keyof CostPosition, value: string) {
    onPatch({ [field]: inputNumber(value) } as Partial<CostPosition>);
  }

  function toggleAddon(addonId: string) {
    const current = new Set(position.addons || []);
    if (current.has(addonId)) current.delete(addonId);
    else current.add(addonId);

    const addons = [...current];
    onPatch(assemblyPatchForAddons(position, addons, catalogItems));
  }

  function patchAreaQuantity(value: string) {
    onPatch({
      height: undefined,
      qty: inputNumber(value),
      width: undefined,
    });
  }

  return (
    <div className="calc-position">
      <div className={catalogItem ? "position-main with-favorite" : "position-main"}>
        {catalogItem ? (
          <div
            className="position-title position-title-readonly"
            title="Название меняется только в справочнике"
          >
            {catalogItem.title}
          </div>
        ) : (
          <input
            className="position-title"
            value={position.title}
            onChange={(event) => onPatch({ title: event.target.value })}
            placeholder="Позиция"
          />
        )}
        {catalogItem && (
          <button
            className={catalogItem.favorite ? "favorite-toggle active" : "favorite-toggle"}
            title={catalogItem.favorite ? "Убрать из избранного" : "Добавить в избранное"}
            onClick={() => onToggleFavorite(catalogItem)}
          >
            <Star size={16} />
          </button>
        )}
        <button title="Удалить" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>

      {position.calcMode === "area" && (
        <div className="field-grid">
          <NumberField label="Ширина, м" value={position.width} onChange={(value) => patchNumber("width", value)} />
          <NumberField label="Высота, м" value={position.height} onChange={(value) => patchNumber("height", value)} />
          <NumberField label="м/кв" value={areaInputValue} onChange={patchAreaQuantity} />
          <NumberField label="Цена / м2" value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
        </div>
      )}

      {position.calcMode === "linear" && (
        <div className="field-grid">
          <NumberField label="Длина, м" value={position.length} onChange={(value) => patchNumber("length", value)} />
          <NumberField label="Кол-во" value={position.qty} onChange={(value) => patchNumber("qty", value)} />
          <NumberField
            label={position.section === "milling" || position.title.toLowerCase().includes("фрез") ? "Толщина, мм" : "Толщина / профиль"}
            value={position.thickness}
            onChange={(value) => patchNumber("thickness", value)}
          />
          <NumberField label="Цена / п.м" value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
        </div>
      )}

      {(position.calcMode === "pieces" || position.calcMode === "manual" || !position.calcMode) && (
        <div className="field-grid">
          <NumberField label="Кол-во" value={position.qty} onChange={(value) => patchNumber("qty", value)} />
          <TextField label="Ед." value={position.unit} onChange={(value) => onPatch({ unit: value })} />
          <NumberField label="Цена / ед." value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
        </div>
      )}

      {position.calcMode === "hourly" && (
        <div className="field-grid">
          <NumberField label="Часы" value={position.qty} onChange={(value) => patchNumber("qty", value)} />
          <NumberField label="Ставка / час" value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
        </div>
      )}

      {position.calcMode === "letterAssembly" && (
        <>
          {catalogItem?.assemblyGroup && (
            <div className="assembly-set-summary">
              <span>
                База: {catalogItem.assemblyOperation || catalogItem.title} ·{" "}
                {formatMoney(position.baseUnitCost ?? catalogItem.unitCost)} / {position.unit}
              </span>
              {position.minCost ? <small>Минимум: {formatMoney(position.minCost)}</small> : null}
            </div>
          )}
          <div className="field-grid">
            <NumberField label={`Кол-во, ${position.unit}`} value={position.qty} onChange={(value) => patchNumber("qty", value)} />
            <NumberField label={`Сумма / ${position.unit}`} value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
          </div>
          <div className="addons-grid">
            {assemblyAddonsToShow.map((addon) => (
              <label key={addon.id}>
                <input
                  checked={(position.addons || []).includes(addon.id)}
                  type="checkbox"
                  onChange={() => toggleAddon(addon.id)}
                />
                <span>{addon.label}</span>
                <small>
                  {formatMoney(addon.unitCost)}
                  {addon.minCost ? ` · мин. ${formatMoney(addon.minCost)}` : ""}
                </small>
              </label>
            ))}
          </div>
        </>
      )}

      <input
        className="position-note"
        value={position.note || ""}
        onChange={(event) => onPatch({ note: event.target.value })}
        placeholder="Комментарий / источник"
      />
      <div className="position-total-row">
        <span>
          {formatQuantity(quantity)} {position.unit}
          {position.minCost ? <small>мин. {formatMoney(position.minCost)}</small> : null}
        </span>
        <strong>{formatMoney(total)}</strong>
      </div>
    </div>
  );
}

function areaFieldValue(position: CostPosition) {
  const width = Number(position.width) || 0;
  const height = Number(position.height) || 0;
  if (width && height) {
    return Math.round((width * height + Number.EPSILON) * 100) / 100;
  }

  const qty = Number(position.qty) || 0;
  return qty || undefined;
}

function inputNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
    </label>
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

function normalizePosition(position: CostPosition): CostPosition {
  const calcMode = position.calcMode || modeForUnit(position.unit);
  const unit = unitForMode(calcMode, position.unit);
  const addons = position.addons || [];

  return {
    ...position,
    calcMode,
    unit,
    qty: Number.isFinite(Number(position.qty)) ? Number(position.qty) : defaultQuantityForMode(calcMode),
    unitCost:
      calcMode === "letterAssembly" && addons.length && assemblyAddonsTotal(addons) > 0 && !position.baseUnitCost
        ? assemblyAddonsTotal(addons)
        : Number.isFinite(Number(position.unitCost))
          ? Number(position.unitCost)
          : 0,
  };
}

function modeForCatalogItem(item: CatalogItem): CostCalcMode {
  if (item.section === "materials") return modeForUnit(item.unit);
  if (item.section === "milling") return "linear";
  if (item.section === "print" || item.section === "plotter") return "area";
  if (item.section === "assembly") return item.assemblyGroup ? "letterAssembly" : modeForUnit(item.unit);
  if (item.section === "lighting") return "pieces";
  if (item.section === "mounting") return "pieces";
  if (item.section === "defects") return modeForUnit(item.unit);
  return modeForUnit(item.unit);
}

function filterBlockCatalogItems(
  items: CatalogItem[],
  sections: ReadonlyArray<CostSection>,
  materialGroups?: ReadonlyArray<string>,
) {
  const allowedMaterialGroups = materialGroups?.length ? new Set(materialGroups) : undefined;

  return items.filter((item) => {
    if (!sections.some((section) => section === item.section)) return false;
    if (item.section !== "materials" || !allowedMaterialGroups) return true;
    return allowedMaterialGroups.has(item.materialGroup || "Без группы");
  });
}

function uniqueCatalogItems(items: CatalogItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function modeForUnit(unit?: string): CostCalcMode {
  const normalized = (unit || "").toLowerCase();
  if (normalized.includes("м2") || normalized.includes("м²") || normalized.includes("кв")) return "area";
  if (normalized.includes("п/м") || normalized.includes("п.м") || normalized.includes("пог")) return "linear";
  if (normalized.includes("ч")) return "hourly";
  return "pieces";
}

function unitForMode(mode: CostCalcMode, fallback?: string) {
  if (mode === "area") return "м2";
  if (mode === "linear") return "п/м";
  if (mode === "hourly") return "ч";
  return fallback || "шт";
}

function defaultQuantityForMode(mode: CostCalcMode) {
  return mode === "area" ? 0 : 1;
}

function createManualCatalogItem(block: CostBlock): CatalogItem {
  const template = block.actions[0]?.template;
  const section = block.catalogTargetSection || template?.section || block.sections[0];
  const calcMode = template?.calcMode || modeForUnit(template?.unit);
  const materialGroup = section === "materials" ? manualMaterialGroupForBlock(block) : undefined;

  return {
    id: `manual-block-${block.id}-${crypto.randomUUID().slice(0, 8)}`,
    section,
    title: manualTitleForBlock(block),
    unit: unitForMode(calcMode, template?.unit),
    unitCost: 0,
    source: `Добавлено из блока: ${block.title.replace(/^\d+\.\s*/, "")}`,
    materialGroup,
    materialFamily: materialGroup ? "Ручной ввод" : undefined,
    materialSubgroup: materialGroup ? "Ручной ввод" : undefined,
    materialGroupPath: materialGroup ? `${materialGroup} / Ручной ввод` : undefined,
    favorite: false,
  };
}

function manualTitleForBlock(block: CostBlock) {
  return manualItemTitles[block.id] || "Новая позиция";
}

function manualCatalogButtonLabel(block: CostBlock) {
  if (block.id === "materials") return "Добавить новый материал в справочник";
  if (block.id === "defects") return "Добавить новый косяк в справочник";
  return "Добавить новую позицию в справочник";
}

function manualMaterialGroupForBlock(block: CostBlock) {
  return block.catalogMaterialGroups?.[0] || "Без группы";
}

function isManualBlockCatalogItem(item: CatalogItem) {
  return item.id.startsWith("manual-block-");
}

function syncManualCatalogPosition(items: CatalogItem[], catalogItem: CatalogItem, position: CostPosition) {
  const title = position.title.trim();

  return items.map((item) => {
    if (item.id !== catalogItem.id) return item;

    return {
      ...item,
      title: title || item.title,
      unit: position.unit || item.unit,
      unitCost: Number.isFinite(Number(position.unitCost)) ? Number(position.unitCost) : item.unitCost,
    };
  });
}

function assemblyCatalogAddonOptions(position: CostPosition, catalogItems: CatalogItem[]) {
  const baseItem = position.catalogId
    ? catalogItems.find((item) => item.id === position.catalogId)
    : undefined;
  if (!baseItem?.assemblyGroup) return [];

  return catalogItems
    .filter((item) => item.section === "assembly")
    .filter((item) => item.id !== baseItem.id)
    .filter((item) => item.assemblySheet === baseItem.assemblySheet)
    .filter((item) => item.assemblyGroup === baseItem.assemblyGroup)
    .map((item) => ({
      id: item.id,
      label: item.assemblyOperation || item.title,
      minCost: item.assemblyMinCost || 0,
      unit: item.unit,
      unitCost: item.unitCost,
    }));
}

function assemblyPatchForAddons(
  position: CostPosition,
  addons: string[],
  catalogItems: CatalogItem[],
): Partial<CostPosition> {
  const catalogOptions = assemblyCatalogAddonOptions(position, catalogItems);
  if (!catalogOptions.length) {
    return {
      addons,
      minCost: undefined,
      unitCost: assemblyAddonsTotal(addons),
    };
  }

  const selected = new Set(addons);
  const baseCost = Number(position.baseUnitCost) || 0;
  const baseMinCost = Number(position.baseMinCost) || 0;
  const addonCost = catalogOptions
    .filter((option) => selected.has(option.id))
    .reduce((sum, option) => sum + option.unitCost, 0);
  const addonMinCost = catalogOptions
    .filter((option) => selected.has(option.id))
    .reduce((sum, option) => sum + option.minCost, 0);
  const minCost = baseMinCost + addonMinCost;

  return {
    addons,
    minCost: minCost || undefined,
    unitCost: baseCost + addonCost,
  };
}

function assemblyAddonsTotal(addons: string[]) {
  return assemblyAddons
    .filter((addon) => addons.includes(addon.id))
    .reduce((sum, addon) => sum + addon.unitCost, 0);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function catalogWithOtherPositions(items: CatalogItem[], positions: CostPosition[]) {
  return positions
    .filter((position) => position.section === "other" && position.title.trim())
    .reduce((currentItems, position) => {
      const item = catalogItemFromOtherPosition(position);
      if (!item) return currentItems;
      return currentItems.some((current) => current.id === item.id)
        ? currentItems.map((current) => (current.id === item.id ? item : current))
        : [...currentItems, item];
    }, items);
}

function catalogItemFromOtherPosition(position: CostPosition): CatalogItem | undefined {
  const title = position.title.trim();
  if (!title) return undefined;

  return {
    id: position.catalogId || `other-manual-${slugify(title)}`,
    section: "other",
    title,
    unit: position.unit || unitForMode(position.calcMode || "pieces"),
    unitCost: Number.isFinite(Number(position.unitCost)) ? Number(position.unitCost) : 0,
    source: "Прочие из расчетов",
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || crypto.randomUUID().slice(0, 8);
}

function upsertCalculation(stored: StoredCalculations, calculation: DealCalculation) {
  const rest = stored.calculations.filter((item) => item.dealId !== calculation.dealId);
  return [...rest, calculation];
}
