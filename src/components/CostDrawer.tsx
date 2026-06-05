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
import { useMemo, useState } from "react";
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
  materialFamilyOptions,
  materialFamilyValue,
  materialGroupLabel,
  materialGroupOptions,
  sectionLabels,
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

const costBlocks: CostBlock[] = [
  {
    id: "materials",
    title: "1. Материалы / рама",
    hint: "Листы считаются по м2, рама по погонным метрам.",
    sections: ["materials"],
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

export function CostDrawer({
  deal,
  calculation,
  catalogItems,
  storedCalculations,
  onClose,
  onOpenCatalog,
  onChange,
  onCatalogChange,
  onStageMoved,
}: CostDrawerProps) {
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
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

  if (!deal) {
    return null;
  }

  const sales = saleBreakdownForDeal(deal, activeCalculation, storedCalculations.agentCostRatio);
  const isAgent = isAgentDeal(deal);
  const currentStage = stageCodeForDeal(deal);
  const isLaunchDeal = currentStage === "launch";
  const isProductionDeal = currentStage === "production";
  const hasSaveApiUrl = saveApiUrl.trim().length > 0;
  const canSave = hasSaveApiUrl;
  const canMoveStage = canSave;
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
    const position = normalizePosition({
      id,
      catalogId: template.section === "other" ? `other-manual-${id}` : template.catalogId,
      qty: 1,
      unit: "шт",
      unitCost: 0,
      ...template,
    });

    updatePositions([position, ...activeCalculation.positions]);
  }

  function addCatalogItem(item: CatalogItem, targetSection?: CostSection) {
    const section = targetSection || item.section;
    addPosition({
      section,
      title: section === "defects" ? `Брак: ${item.title}` : item.title,
      calcMode: modeForCatalogItem(item),
      qty: 1,
      unit: item.unit,
      unitCost: item.unitCost,
      note: item.source,
      catalogId: item.id,
    });
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
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить расчет");
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
              positions={activeCalculation.positions.filter((position) =>
                block.sections.includes(position.section),
              )}
              onAdd={addPosition}
              onAddCatalog={addCatalogItem}
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
            positions={activeCalculation.positions.filter((position) => position.section === "defects")}
            onAdd={addPosition}
            onAddCatalog={addCatalogItem}
            onDelete={deletePosition}
            onPatch={patchPosition}
            onToggle={() => setExpandedBlockId((current) => current === defectBlock.id ? null : defectBlock.id)}
            onToggleFavorite={toggleFavorite}
            />
        </section>

        <section className="github-save">
          <div className="section-title">
            <h3>Сохранение</h3>
            <Save size={18} />
          </div>
          {!isSaveApiUrlConfigured() && (
            <input
              value={saveApiUrl}
              onChange={(event) => setSaveApiUrl(event.target.value)}
              placeholder="Адрес API сохранения, например https://verkup-save-api...workers.dev"
            />
          )}
          <button className="primary" disabled={!canSave || saveState === "saving"} onClick={saveCalculation}>
            {saveState === "saved" ? <Check size={18} /> : <Save size={18} />}
            {saveState === "saving" ? "Сохраняю..." : "Сохранить расчет"}
          </button>
          {isLaunchDeal && (
            <button
              className="production-button"
              disabled={!canMoveStage || moveState === "moving"}
              onClick={() => moveToStage("production")}
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
          {isProductionDeal && (
            <button
              className="production-button rollback"
              disabled={!canMoveStage || moveState === "moving"}
              onClick={() => moveToStage("launch")}
              title={
                !moveHints.length
                  ? "Сохранить расчет и вернуть сделку в стадию Запустить в производство"
                  : moveHints.join(" ")
              }
            >
              {moveState === "moved" ? <Check size={18} /> : <ArrowLeft size={18} />}
              {moveState === "moving" ? "Откатываю..." : "Откатить в запуск"}
            </button>
          )}
          {(isLaunchDeal || isProductionDeal) && moveState !== "moved" && !!moveHints.length && (
            <p className="hint">{moveHints.join(" ")}</p>
          )}
          {saveState === "error" && <p className="error">{saveError}</p>}
          {saveState === "saved" && <p className="ok">Расчет записан в GitHub через API.</p>}
          {moveState === "error" && <p className="error">{moveError}</p>}
          {moveState === "moved" && (
            <p className="ok">Запущено изменение стадии в Bitrix24. Обновление подтянется после Actions.</p>
          )}
        </section>
      </div>
    </section>
  );
}

function CostBlockView({
  block,
  catalogItems,
  isOpen,
  positions,
  onAdd,
  onAddCatalog,
  onToggle,
  onToggleFavorite,
  onPatch,
  onDelete,
}: {
  block: CostBlock;
  catalogItems: CatalogItem[];
  isOpen: boolean;
  positions: CostPosition[];
  onAdd: (template: PositionTemplate) => void;
  onAddCatalog: (item: CatalogItem, targetSection?: CostSection) => void;
  onToggle: () => void;
  onToggleFavorite: (item: CatalogItem) => void;
  onPatch: (id: string, patch: Partial<CostPosition>) => void;
  onDelete: (id: string) => void;
}) {
  const total = positions.reduce((sum, position) => sum + positionTotal(position), 0);

  return (
    <section className={`calc-block ${isOpen ? "open" : "collapsed"}`}>
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
      {isOpen && (
        <div className="calc-block-body">
          <BlockCatalogPicker
            block={block}
            catalogItems={catalogItems}
            onAdd={(item) => onAddCatalog(item, block.catalogTargetSection)}
            onToggleFavorite={onToggleFavorite}
          />
          <PositionList
            emptyText="Пока нет позиций в этом блоке."
            positions={positions}
            onDelete={onDelete}
            onPatch={onPatch}
          />
          <div className="calc-block-actions">
            {block.actions.map((action) => (
              <button key={action.label} onClick={() => onAdd(action.template)}>
                <CirclePlus size={16} />
                {action.label}
              </button>
            ))}
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
  const [activeSection, setActiveSection] = useState<CostSection | "">("");
  const [activeMaterialGroup, setActiveMaterialGroup] = useState("");
  const [activeMaterialFamily, setActiveMaterialFamily] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const sectionItems = catalogItems.filter((item) =>
    catalogSections.some((section) => section === item.section),
  );
  const materialGroups = useMemo(() => materialGroupOptions(sectionItems), [sectionItems]);
  const materialFamilies = useMemo(
    () => materialFamilyOptions(sectionItems, activeMaterialGroup),
    [activeMaterialGroup, sectionItems],
  );
  const showSectionFilter = catalogSections.length > 1;
  const isMaterialOnlyBlock = catalogSections.length === 1 && catalogSections[0] === "materials";
  const showMaterialFilters =
    catalogSections.includes("materials") && (isMaterialOnlyBlock || activeSection === "materials");
  const addLabel = blockAddLabels[block.id] || "позицию";
  const baseItems = sectionItems
    .filter((item) => !activeSection || item.section === activeSection)
    .filter((item) => !activeMaterialGroup || (item.materialGroup || "Без группы") === activeMaterialGroup)
    .filter((item) => !activeMaterialFamily || materialFamilyValue(item) === activeMaterialFamily);
  const itemOptions = baseItems
    .filter((item) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;

      return [
        item.title,
        item.source,
        item.unit,
        item.materialGroup,
        item.materialFamily,
        item.materialSubgroup,
        item.materialGroupPath,
        sectionLabels[item.section],
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .slice(0, 500);
  const selectedItem =
    itemOptions.find((item) => item.id === selectedItemId) ||
    baseItems.find((item) => item.id === selectedItemId);
  const favoriteItems = sectionItems
    .filter((item) => item.favorite)
    .slice(0, 12);
  const materialSelectDisabled = showMaterialFilters && !activeMaterialGroup;

  function changeSection(value: CostSection | "") {
    setActiveSection(value);
    setActiveMaterialGroup("");
    setActiveMaterialFamily("");
    setSelectedItemId("");
  }

  return (
    <div className="block-catalog">
      <div className="block-add-layout">
        <div className="block-add-card">
          <div className="block-add-tab">
            <CirclePlus size={16} />
            <span>Добавить {addLabel}</span>
          </div>
          <div className="catalog-cascade">
            {showSectionFilter && (
              <label className="catalog-field">
                <span>Группа</span>
                <select
                  value={activeSection}
                  onChange={(event) => changeSection(event.target.value as CostSection | "")}
                >
                  <option value="">Все разделы</option>
                  {catalogSections.map((section) => (
                    <option key={section} value={section}>
                      {sectionLabels[section]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showMaterialFilters && (
              <>
                <label className="catalog-field">
                  <span>Группа</span>
                  <select
                    value={activeMaterialGroup}
                    onChange={(event) => {
                      setActiveMaterialGroup(event.target.value);
                      setActiveMaterialFamily("");
                      setSelectedItemId("");
                    }}
                  >
                    <option value="">Выберите группу</option>
                    {materialGroups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="catalog-field">
                  <span>Подгруппа</span>
                  <select
                    disabled={!activeMaterialGroup}
                    value={activeMaterialFamily}
                    onChange={(event) => {
                      setActiveMaterialFamily(event.target.value);
                      setSelectedItemId("");
                    }}
                  >
                    <option value="">Все подгруппы</option>
                    {materialFamilies.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="catalog-field wide">
              <span>{showMaterialFilters ? "Материал" : "Позиция"}</span>
              <select
                disabled={materialSelectDisabled}
                value={selectedItemId}
                onChange={(event) => setSelectedItemId(event.target.value)}
              >
                <option value="">
                  {materialSelectDisabled ? "Сначала выберите группу" : "Выберите позицию"}
                </option>
                {itemOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {formatMoney(item.unitCost)} / {item.unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="catalog-field wide">
              <span>Быстрый поиск</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название, толщина, источник..."
              />
            </label>
          </div>

          <div className="selected-catalog-item">
            {selectedItem ? (
              <>
                <div>
                  <strong>{selectedItem.title}</strong>
                  <small>
                    {sectionLabels[selectedItem.section]} · {formatMoney(selectedItem.unitCost)} / {selectedItem.unit}
                    {materialGroupLabel(selectedItem) ? ` · ${materialGroupLabel(selectedItem)}` : ""}
                  </small>
                </div>
                <button
                  className={selectedItem.favorite ? "favorite-toggle active" : "favorite-toggle"}
                  onClick={() => onToggleFavorite(selectedItem)}
                  title={selectedItem.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                >
                  <Star size={15} />
                </button>
                <button className="catalog-add-toggle with-text" onClick={() => onAdd(selectedItem)}>
                  <CirclePlus size={16} />
                  Добавить
                </button>
              </>
            ) : (
              <p>Выберите позицию из списка выше.</p>
            )}
          </div>
        </div>

        <aside className="block-favorites">
          <div className="section-title compact">
            <h3>Избранное</h3>
            <span>{favoriteItems.length}</span>
          </div>
          <div className="block-favorite-list">
            {favoriteItems.map((item) => (
              <div className="block-favorite-item" key={item.id}>
                <button className="block-favorite-main" onClick={() => onAdd(item)}>
                  <span>{item.title}</span>
                  <small>{formatMoney(item.unitCost)} / {item.unit}</small>
                </button>
                <button
                  className="favorite-toggle active"
                  onClick={() => onToggleFavorite(item)}
                  title="Убрать из избранного"
                >
                  <Star size={15} />
                </button>
              </div>
            ))}
            {!favoriteItems.length && (
              <p className="empty-state compact">Отметьте позицию звездой, и она будет здесь во всех сделках.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function PositionList({
  emptyText,
  positions,
  onPatch,
  onDelete,
}: {
  emptyText: string;
  positions: CostPosition[];
  onPatch: (id: string, patch: Partial<CostPosition>) => void;
  onDelete: (id: string) => void;
}) {
  if (!positions.length) {
    return <p className="calc-block-empty">{emptyText}</p>;
  }

  return (
    <div className="calc-lines">
      {positions.map((position) => (
        <PositionEditor
          key={position.id}
          position={position}
          onDelete={() => onDelete(position.id)}
          onPatch={(patch) => onPatch(position.id, patch)}
        />
      ))}
    </div>
  );
}

function PositionEditor({
  position,
  onPatch,
  onDelete,
}: {
  position: CostPosition;
  onPatch: (patch: Partial<CostPosition>) => void;
  onDelete: () => void;
}) {
  const quantity = positionQuantity(position);
  const total = positionTotal(position);

  function patchNumber(field: keyof CostPosition, value: string) {
    onPatch({ [field]: Number(value) } as Partial<CostPosition>);
  }

  function toggleAddon(addonId: string) {
    const current = new Set(position.addons || []);
    if (current.has(addonId)) current.delete(addonId);
    else current.add(addonId);

    const addons = [...current];
    onPatch({
      addons,
      unitCost: assemblyAddonsTotal(addons),
    });
  }

  return (
    <div className="calc-position">
      <div className="position-main">
        <input
          className="position-title"
          value={position.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          placeholder="Позиция"
        />
        <button title="Удалить" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>

      {position.calcMode === "area" && (
        <div className="field-grid">
          <NumberField label="Ширина, м" value={position.width} onChange={(value) => patchNumber("width", value)} />
          <NumberField label="Высота, м" value={position.height} onChange={(value) => patchNumber("height", value)} />
          <NumberField label="Кол-во" value={position.qty} onChange={(value) => patchNumber("qty", value)} />
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
          <div className="field-grid">
            <NumberField label="Кол-во ед." value={position.qty} onChange={(value) => patchNumber("qty", value)} />
            <NumberField label="Цена / ед." value={position.unitCost} onChange={(value) => patchNumber("unitCost", value)} />
          </div>
          <div className="addons-grid">
            {assemblyAddons.map((addon) => (
              <label key={addon.id}>
                <input
                  checked={(position.addons || []).includes(addon.id)}
                  type="checkbox"
                  onChange={() => toggleAddon(addon.id)}
                />
                <span>{addon.label}</span>
                <small>{formatMoney(addon.unitCost)}</small>
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
        </span>
        <strong>{formatMoney(total)}</strong>
      </div>
    </div>
  );
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
    qty: Number.isFinite(Number(position.qty)) ? Number(position.qty) : 1,
    unitCost:
      calcMode === "letterAssembly" && addons.length
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
  if (item.section === "assembly") return "pieces";
  if (item.section === "lighting") return "pieces";
  if (item.section === "mounting") return "pieces";
  if (item.section === "defects") return modeForUnit(item.unit);
  return modeForUnit(item.unit);
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
