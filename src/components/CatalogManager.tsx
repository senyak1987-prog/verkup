import { Check, CirclePlus, Save, Search, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  catalogGroups,
  createEmptyCatalogItem,
  filterCatalogItems,
  materialFamilyOptions,
  materialFamilyValue,
  materialGroupLabel,
  materialGroupOptions,
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
  onChange: (items: CatalogItem[]) => void;
  onClose: () => void;
};

export function CatalogManager({ items, onChange, onClose }: CatalogManagerProps) {
  const [query, setQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string>("materials");
  const [activeMaterialGroup, setActiveMaterialGroup] = useState("");
  const [activeMaterialFamily, setActiveMaterialFamily] = useState("");
  const [selectedId, setSelectedId] = useState(items[0]?.id || "");
  const [draft, setDraft] = useState<CatalogItem>(() =>
    items[0] ? { ...items[0] } : createEmptyCatalogItem(),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [saveApiUrl, setSaveApiUrl] = useState(() => defaultSaveApiUrl());
  const canSave = saveApiUrl.trim().length > 0;

  const activeGroup =
    catalogGroups.find((group) => group.id === activeGroupId) || catalogGroups[0];
  const materialGroups = useMemo(() => materialGroupOptions(items), [items]);
  const materialFamilies = useMemo(
    () => materialFamilyOptions(items, activeMaterialGroup),
    [activeMaterialGroup, items],
  );
  const groupItems = useMemo(() => {
    const sectionItems = items.filter((item) =>
      activeGroup.sections.some((section) => section === item.section),
    );
    if (activeGroup.id !== "materials") return sectionItems;

    return sectionItems
      .filter((item) => !activeMaterialGroup || (item.materialGroup || "Без группы") === activeMaterialGroup)
      .filter((item) => !activeMaterialFamily || materialFamilyValue(item) === activeMaterialFamily);
  }, [activeGroup.id, activeGroup.sections, activeMaterialFamily, activeMaterialGroup, items]);
  const filteredItems = useMemo(() => filterCatalogItems(groupItems, query, 300), [groupItems, query]);

  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  function selectItem(item: CatalogItem) {
    setSelectedId(item.id);
    setDraft({ ...item });
    setSaveState("idle");
    setSaveError("");
  }

  function selectGroup(groupId: string) {
    const nextGroup = catalogGroups.find((group) => group.id === groupId) || catalogGroups[0];
    const firstItem = items.find((item) => nextGroup.sections.some((section) => section === item.section));

    setActiveGroupId(groupId);
    if (nextGroup.id !== "materials") {
      setActiveMaterialGroup("");
      setActiveMaterialFamily("");
    }
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
      materialGroup: activeGroup.id === "materials" ? activeMaterialGroup : undefined,
      materialFamily: activeGroup.id === "materials" ? activeMaterialFamily : undefined,
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
            <div className="catalog-group-tabs">
              {catalogGroups.map((group) => {
                const count = items.filter((item) => group.sections.some((section) => section === item.section)).length;
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
            {activeGroup.id === "materials" && (
              <>
                <label className="material-group-filter">
                  <span>Группа материалов</span>
                  <select
                    value={activeMaterialGroup}
                    onChange={(event) => {
                      setActiveMaterialGroup(event.target.value);
                      setActiveMaterialFamily("");
                    }}
                  >
                    <option value="">Все группы</option>
                    {materialGroups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
                {activeMaterialGroup && (
                  <label className="material-group-filter">
                    <span>Подгруппа</span>
                    <select
                      value={activeMaterialFamily}
                      onChange={(event) => setActiveMaterialFamily(event.target.value)}
                    >
                      <option value="">Все подгруппы</option>
                      {materialFamilies.map((family) => (
                        <option key={family} value={family}>
                          {family}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <div className="catalog-browser-list">
              {filteredItems.map((item) => (
                <div className={`catalog-item-card ${item.id === selectedId ? "active" : ""}`} key={item.id}>
                  <button className="catalog-item-main" onClick={() => selectItem(item)}>
                    <span>{item.title}</span>
                    <small>
                      {sectionLabels[item.section]} · {formatMoney(item.unitCost)} / {item.unit}
                      {materialGroupLabel(item) ? ` · ${materialGroupLabel(item)}` : ""}
                    </small>
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
                <Check size={16} /> Применить
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
