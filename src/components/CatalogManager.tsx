import { Check, CirclePlus, Save, Search, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  catalogItemInGroup,
  catalogPrimarySubgroupValue,
  catalogGroups,
  catalogSecondarySubgroupValue,
  createEmptyCatalogItem,
  filterCatalogItems,
  materialGroupLabel,
  normalizeCatalogItem,
  sectionLabels,
  toggleCatalogFavorite,
  upsertCatalogItem,
} from "../lib/catalog";
import { formatMoney } from "../lib/costing";
import {
  defaultSaveApiUrl,
  isSaveApiUrlConfigured,
  persistSaveApiSettings,
  saveCatalogs,
} from "../lib/saveApi";
import type { CatalogItem, CostSection } from "../types";

type CatalogManagerProps = {
  items: CatalogItem[];
  initialDraft?: CatalogItem;
  onApplyAndReturn?: (item: CatalogItem) => void;
  onChange: (items: CatalogItem[]) => void;
  onClose: () => void;
};

export function CatalogManager({
  items,
  initialDraft,
  onApplyAndReturn,
  onChange,
  onClose,
}: CatalogManagerProps) {
  const [query, setQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string>(() =>
    initialDraft ? groupIdForItem(initialDraft) : "materials",
  );
  const [activePrimarySubgroup, setActivePrimarySubgroup] = useState(
    initialDraft ? catalogPrimarySubgroupValue(initialDraft) : "",
  );
  const [activeSecondarySubgroup, setActiveSecondarySubgroup] = useState(
    initialDraft ? catalogSecondarySubgroupValue(initialDraft) : "",
  );
  const [selectedId, setSelectedId] = useState(initialDraft ? "" : items[0]?.id || "");
  const [draft, setDraft] = useState<CatalogItem>(() =>
    initialDraft ? { ...initialDraft } : items[0] ? { ...items[0] } : createEmptyCatalogItem(),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [saveApiUrl, setSaveApiUrl] = useState(() => defaultSaveApiUrl());
  const canSave = saveApiUrl.trim().length > 0;

  const activeGroup =
    catalogGroups.find((group) => group.id === activeGroupId) || catalogGroups[0];
  const pageItems = useMemo(
    () => items.filter((item) => catalogItemInGroup(item, activeGroup)),
    [activeGroup, items],
  );
  const primarySubgroups = useMemo(
    () => uniqueSubgroups(pageItems.map(catalogPrimarySubgroupValue), activeGroup.id),
    [activeGroup.id, pageItems],
  );
  const secondarySubgroups = useMemo(
    () =>
      uniqueSubgroups(
        pageItems
          .filter((item) => !activePrimarySubgroup || catalogPrimarySubgroupValue(item) === activePrimarySubgroup)
          .map(catalogSecondarySubgroupValue),
        activeGroup.id,
      ),
    [activeGroup.id, activePrimarySubgroup, pageItems],
  );
  const groupItems = useMemo(() => {
    return pageItems
      .filter((item) => !activePrimarySubgroup || catalogPrimarySubgroupValue(item) === activePrimarySubgroup)
      .filter((item) => !activeSecondarySubgroup || catalogSecondarySubgroupValue(item) === activeSecondarySubgroup);
  }, [activePrimarySubgroup, activeSecondarySubgroup, pageItems]);
  const filteredItems = useMemo(() => filterCatalogItems(groupItems, query, 300), [groupItems, query]);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  useEffect(() => {
    if (!initialDraft) return;

    setActiveGroupId(groupIdForItem(initialDraft));
    setActivePrimarySubgroup(catalogPrimarySubgroupValue(initialDraft));
    setActiveSecondarySubgroup(catalogSecondarySubgroupValue(initialDraft));
    setSelectedId(items.some((item) => item.id === initialDraft.id) ? initialDraft.id : "");
    setDraft({ ...initialDraft });
    setSaveState("idle");
    setSaveError("");
  }, [initialDraft, items]);

  function selectItem(item: CatalogItem) {
    setSelectedId(item.id);
    setDraft({ ...item });
    setSaveState("idle");
    setSaveError("");
  }

  function selectGroup(groupId: string) {
    const nextGroup = catalogGroups.find((group) => group.id === groupId) || catalogGroups[0];
    const firstItem = items.find((item) => catalogItemInGroup(item, nextGroup));

    setActiveGroupId(groupId);
    setActivePrimarySubgroup("");
    setActiveSecondarySubgroup("");
    setSelectedId(firstItem?.id || "");
    setDraft(firstItem ? { ...firstItem } : { ...createEmptyCatalogItem(), section: nextGroup.sections[0] });
    setSaveState("idle");
    setSaveError("");
  }

  function startNewItem() {
    setSelectedId("");
    setDraft({
      ...createEmptyCatalogItem(),
      section: activeGroup.sections[0],
      materialGroup: activeGroup.id === "materials" ? activePrimarySubgroup : undefined,
      materialFamily: activeGroup.id === "materials" ? activeSecondarySubgroup : undefined,
    });
    setSaveState("idle");
    setSaveError("");
  }

  function patchDraft(patch: Partial<CatalogItem>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState("idle");
  }

  function applyDraft() {
    const normalized = normalizeCatalogItem(draft);
    if (!normalized) {
      setSaveState("error");
      setSaveError("Заполните название позиции.");
      return;
    }

    const nextItems = upsertCatalogItem(items, normalized);
    onChange(nextItems);
    setSelectedId(normalized.id);
    setDraft(normalized);
    setSaveState("idle");
    setSaveError("");
    onApplyAndReturn?.(normalized);
  }

  function deleteDraft() {
    if (!selectedId) return;
    onChange(items.filter((item) => item.id !== selectedId));
    startNewItem();
  }

  function toggleFavorite(itemId: string) {
    const nextItems = toggleCatalogFavorite(items, itemId);
    onChange(nextItems);
    if (itemId === selectedId) {
      const updated = nextItems.find((item) => item.id === itemId);
      if (updated) setDraft({ ...updated });
    }
    setSaveState("idle");
  }

  async function saveCatalog() {
    const settings = {
      apiUrl: saveApiUrl,
    };
    setSaveState("saving");
    setSaveError("");
    persistSaveApiSettings(settings);

    try {
      const hasDraft = Boolean(selectedId || draft.title.trim());
      const normalized = normalizeCatalogItem(draft);
      if (hasDraft && !normalized) {
        throw new Error("Заполните название позиции.");
      }

      const itemsToSave = normalized ? upsertCatalogItem(items, normalized) : items;
      if (normalized) {
        onChange(itemsToSave);
        setSelectedId(normalized.id);
        setDraft(normalized);
      }

      await saveCatalogs(settings, {
        generatedAt: new Date().toISOString(),
        items: itemsToSave,
      });

      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить справочник");
    }
  }

  return (
    <div className="catalog-modal-backdrop">
      <section aria-label="Редактор справочника" className="catalog-modal">
        <div className="catalog-modal-head">
          <div>
            <h2>Справочник</h2>
            <p>{items.length} позиций в GitHub-каталоге</p>
          </div>
          <button title="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="catalog-group-tabs">
          {catalogGroups.map((group) => {
            const count = items.filter((item) => catalogItemInGroup(item, group)).length;
            return (
              <button
                className={activeGroup.id === group.id ? "active" : ""}
                key={group.id}
                onClick={() => selectGroup(group.id)}
              >
                <span>{group.label}</span>
                <small>{count}</small>
              </button>
            );
          })}
        </div>

        <div className="catalog-manager">
          <aside className="catalog-sidebar">
            <div className="catalog-search">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название, раздел, источник..."
              />
            </div>
            <div className="catalog-toolbar">
              <button className="secondary" onClick={startNewItem}>
                <CirclePlus size={16} /> Новая позиция
              </button>
              <span>{filteredItems.length} найдено</span>
            </div>
            {primarySubgroups.length > 0 && (
              <label className="material-group-filter">
                <span>{primarySubgroupLabel(activeGroup.id)}</span>
                <select
                  value={activePrimarySubgroup}
                  onChange={(event) => {
                    setActivePrimarySubgroup(event.target.value);
                    setActiveSecondarySubgroup("");
                  }}
                >
                  <option value="">Все подразделы</option>
                  {primarySubgroups.map((subgroup) => (
                    <option key={subgroup} value={subgroup}>
                      {subgroup}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {activePrimarySubgroup && secondarySubgroups.length > 1 && (
              <label className="material-group-filter">
                <span>Подгруппа</span>
                <select
                  value={activeSecondarySubgroup}
                  onChange={(event) => setActiveSecondarySubgroup(event.target.value)}
                >
                  <option value="">Все подгруппы</option>
                  {secondarySubgroups.map((subgroup) => (
                    <option key={subgroup} value={subgroup}>
                      {subgroup}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="catalog-browser-list">
              {filteredItems.map((item) => (
                <div className={`catalog-item-card ${item.id === selectedId ? "active" : ""}`} key={item.id}>
                  <button
                    className={item.imageUrl ? "catalog-item-main with-thumb" : "catalog-item-main"}
                    onClick={() => selectItem(item)}
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
                  <button
                    className={item.favorite ? "favorite-toggle active" : "favorite-toggle"}
                    onClick={() => toggleFavorite(item.id)}
                    title={item.favorite ? "Убрать из избранного" : "Добавить в избранное"}
                  >
                    <Star size={15} />
                  </button>
                </div>
              ))}
              {!filteredItems.length && <p className="empty-state">Позиции не найдены.</p>}
            </div>
          </aside>

          <div className="catalog-form">
            <label>
              <span>Раздел</span>
              <select
                value={draft.section}
                onChange={(event) => patchDraft({ section: event.target.value as CostSection })}
              >
                {Object.entries(sectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Единица</span>
              <input
                value={draft.unit}
                onChange={(event) => patchDraft({ unit: event.target.value })}
                placeholder="шт"
              />
            </label>
            <label className="catalog-form-wide">
              <span>Название</span>
              <input
                value={draft.title}
                onChange={(event) => patchDraft({ title: event.target.value })}
                placeholder="Название позиции"
              />
            </label>
            <label>
              <span>Цена</span>
              <input
                type="number"
                value={draft.unitCost}
                onChange={(event) => patchDraft({ unitCost: Number(event.target.value) })}
                placeholder="0"
              />
            </label>
            <label className="catalog-form-check catalog-form-wide">
              <input
                checked={Boolean(draft.favorite)}
                type="checkbox"
                onChange={(event) => patchDraft({ favorite: event.target.checked })}
              />
              <span>Избранный материал для быстрого доступа</span>
            </label>
            <label>
              <span>Код товара</span>
              <input
                value={draft.productCode || ""}
                onChange={(event) => patchDraft({ productCode: event.target.value })}
                placeholder="10010700"
              />
            </label>
            <label className="catalog-form-wide">
              <span>Ссылка на товар</span>
              <input
                value={draft.productUrl || ""}
                onChange={(event) => patchDraft({ productUrl: event.target.value })}
                placeholder="https://www.remex.ru/product/..."
              />
            </label>
            <label className="catalog-form-wide">
              <span>Картинка</span>
              <input
                value={draft.imageUrl || ""}
                onChange={(event) => patchDraft({ imageUrl: event.target.value })}
                placeholder="https://www.remex.ru/storage/..."
              />
            </label>
            {draft.imageUrl && (
              <div className="catalog-image-preview catalog-form-wide">
                <img src={draft.imageUrl} alt="" loading="lazy" />
                <span>{draft.productUrl ? "Картинка из карточки товара" : "Картинка справочника"}</span>
              </div>
            )}
            {draft.section === "materials" && (
              <>
                <label>
                  <span>Группа материалов</span>
                  <input
                    value={draft.materialGroup || ""}
                    onChange={(event) =>
                      patchDraft({
                        materialGroup: event.target.value,
                        materialGroupPath: [event.target.value, draft.materialSubgroup]
                          .filter(Boolean)
                          .join(" / "),
                      })
                    }
                    placeholder="Пленки"
                  />
                </label>
                <label className="catalog-form-wide">
                  <span>Путь в таблице</span>
                  <input
                    value={draft.materialSubgroup || ""}
                    onChange={(event) =>
                      patchDraft({
                        materialSubgroup: event.target.value,
                        materialGroupPath: [draft.materialGroup, event.target.value]
                          .filter(Boolean)
                          .join(" / "),
                      })
                    }
                    placeholder="Пленки / Пленка ORACAL-641"
                  />
                </label>
                <label>
                  <span>Подгруппа для фильтра</span>
                  <input
                    value={draft.materialFamily || ""}
                    onChange={(event) => patchDraft({ materialFamily: event.target.value })}
                    placeholder="ПВХ, АКП, Акрил молочный"
                  />
                </label>
              </>
            )}
            <label className="catalog-form-wide">
              <span>Источник</span>
              <input
                value={draft.source}
                onChange={(event) => patchDraft({ source: event.target.value })}
                placeholder="Ручной справочник"
              />
            </label>

            <div className="catalog-form-actions">
              <button className="primary" onClick={applyDraft}>
                <Check size={16} /> {onApplyAndReturn ? "Добавить в расчет" : "Применить"}
              </button>
              <button className="danger" disabled={!selectedId} onClick={deleteDraft}>
                <Trash2 size={16} /> Удалить
              </button>
            </div>

            <div className="catalog-save-panel">
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
              <button
                className="primary"
                disabled={!canSave || saveState === "saving"}
                onClick={saveCatalog}
              >
                {saveState === "saved" ? <Check size={18} /> : <Save size={18} />}
                {saveState === "saving" ? "Сохраняю..." : "Сохранить справочник"}
              </button>
              {saveState === "error" && <p className="error">{saveError}</p>}
              {saveState === "saved" && <p className="ok">Справочник записан в GitHub через API.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function groupIdForItem(item: CatalogItem) {
  return catalogGroups.find((group) => catalogItemInGroup(item, group))?.id || groupIdForSection(item.section);
}

function groupIdForSection(section: CostSection) {
  return catalogGroups.find((group) => group.sections.some((groupSection) => groupSection === section))?.id || "materials";
}

function uniqueSubgroups(values: string[], groupId: string) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (groupId === "assembly") return uniqueValues;
  return uniqueValues.sort((first, second) => first.localeCompare(second, "ru"));
}

function primarySubgroupLabel(groupId: string) {
  if (groupId === "assembly") return "Лист таблицы";
  return groupId === "materials" ? "Группа материалов" : "Подраздел";
}
