import { useEffect, useState } from "react";
import { MousePointer2, Plus, X } from "lucide-react";
import { SIGN_FONTS, resolveSignFont } from "../lib/letterContours";
import { systemFontAvailable } from "../lib/systemFontContours";

export type LetterLineControlRow = { index: number; text: string; font: string; height: number };
type Props = {
  rows: LetterLineControlRow[];
  onTextChange: (index: number, text: string) => void;
  onFontChange: (index: number, font: string) => void;
  onHeightChange: (index: number, height: number) => void;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
};

export function LetterLinesControls({ rows, onTextChange, onFontChange, onHeightChange, onSelect, onAdd, onRemove }: Props) {
  const visibleRows = rows.slice(0, 3);
  const embeddedCount = SIGN_FONTS.filter(font => font.file).length;
  const systemCount = SIGN_FONTS.length - embeddedCount;
  return <div className="control-section">
    {visibleRows.map(row => {
      const number = row.index + 1;
      const selectedFont = resolveSignFont(row.font);
      const options = SIGN_FONTS.some(font => font.value === selectedFont.value)
        ? SIGN_FONTS : [selectedFont, ...SIGN_FONTS];
      return <fieldset key={row.index} className="control-section" aria-label={`Строка ${number}`}
        style={{ margin: 0, border: 0, padding: 0, minWidth: 0, width: "100%" }}>
        <legend><strong>Строка {number}</strong></legend>
        <label className="builder-field"><span>Текст</span>
          <input type="text" aria-label={`Текст строки ${number}`} maxLength={60} value={row.text}
            placeholder={row.index === 0 ? "Например, ЦВЕТЫ" : "Надпись ниже"}
            onChange={event => onTextChange(row.index, event.target.value)} />
        </label>
        <div className="dimension-number-grid">
          <label className="builder-field"><span>Шрифт</span>
            <select aria-label={`Шрифт строки ${number}`} value={selectedFont.value}
              onChange={event => onFontChange(row.index, event.target.value)}>
              {options.map(font => <option key={font.value} value={font.value}
                disabled={!font.file && !systemFontAvailable(font.value.split(",")[0].replace(/"/g, ""), font.weight)}>
                {font.label}
              </option>)}
            </select>
          </label>
          <RowHeightField number={number} value={row.height} onChange={height => onHeightChange(row.index, height)} />
        </div>
        <div className="dimension-number-grid">
          <button type="button" className="studio-button" aria-label={`Выбрать строку ${number} на макете`}
            onClick={() => onSelect(row.index)}><MousePointer2 size={14} />На макете</button>
          {row.index > 0 && <button type="button" className="studio-remove" aria-label={`Удалить строку ${number}`}
            onClick={() => onRemove(row.index)}><X size={14} />Удалить строку</button>}
        </div>
      </fieldset>;
    })}
    {visibleRows.length < 3 && <button type="button" className="studio-button" onClick={onAdd}>
      <Plus size={14} />Добавить строку
    </button>}
    <small className="control-note">{embeddedCount} встроенных шрифтов + {systemCount} системных. Контуры одинаковы в 2D и 3D.</small>
  </div>;
}

function RowHeightField({ number, value, onChange }: { number: number; value: number; onChange: (height: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : value;
    const next = Math.max(100, Math.min(700, Math.round(Number.isFinite(parsed) ? parsed : value)));
    setDraft(String(next)); onChange(next);
  };
  return <label className="builder-field"><span>Высота, мм</span>
    <input type="number" aria-label={`Высота строки ${number}, мм`} min={100} max={700} step={1} value={draft}
      onChange={event => {
        const raw = event.target.value; setDraft(raw);
        const next = Number(raw);
        if (raw && Number.isFinite(next) && next >= 100 && next <= 700) onChange(Math.round(next));
      }}
      onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
  </label>;
}
