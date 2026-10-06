import { useEffect, useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { createNeonDesign, NEON_FONTS } from '../lib/neonConstruction';
import { EXTERNAL_NEON_FONTS, loadNeonFont } from '../lib/neonFonts';

export type NeonLineOffset = { x: number; y: number };
export type NeonSettings = {
  neonText: string; neonFont: string; neonHeight: number; neonDiameter: number; neonColor: string;
  neonBackerWidth: number; neonBackerHeight: number; neonBackerShape: string; neonBrightness: number; neonAlign: string;
  neonLineFonts: string[]; neonLineColors: string[]; neonLineScales: number[]; neonLineOffsets: NeonLineOffset[];
  neonIcon: string; neonBackerColor: 'clear' | 'white' | 'black'; neonInstallMode: 'standoffs' | 'hanging';
  neonUse: 'indoor' | 'outdoor'; neonTargetWidth: number; neonKeepAspect: boolean;
};
const COLORS = [
  ['#ff5eae', 'Розовый'], ['#ff4b3e', 'Красный'], ['#ffa658', 'Оранжевый'], ['#ffd45f', 'Желтый'],
  ['#6cfa96', 'Зеленый'], ['#61d6ff', 'Голубой'], ['#687dff', 'Синий'], ['#bf85ff', 'Фиолетовый'],
  ['#ffe6bb', 'Теплый белый'], ['#f1faff', 'Белый'],
] as const;
const ICONS = [
  ['none', 'Без значка'], ['heart', 'Сердце'], ['star', 'Звезда'], ['bolt', 'Молния'], ['cup', 'Чашка'],
  ['music', 'Нота'], ['infinity', 'Бесконечность'],
] as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Props = {
  project: NeonSettings; onChange: (patch: Partial<NeonSettings>) => void; onUndo?: () => void; canUndo?: boolean;
  selectedLine?: number; onSelectLine?: (index: number) => void;
  measuredWidth?: number;
};

export function NeonControls({ project, onChange, onUndo, canUndo = false, selectedLine, onSelectLine, measuredWidth }: Props) {
  const [category, setCategory] = useState('Все'), [localLine, selectLocalLine] = useState(0);
  const [version, refresh] = useState(0), [failedFonts, setFailedFonts] = useState<string[]>([]);
  const line = clamp(selectedLine ?? localLine, 0, 2);
  const selectedText = project.neonText.split('\n').slice(0, 3)[line] ?? '';
  const fontId = project.neonLineFonts?.[line] || project.neonFont;
  const color = project.neonLineColors?.[line] || project.neonColor;
  const scale = project.neonLineScales?.[line] ?? 1;
  const offset = project.neonLineOffsets?.[line] ?? { x: 0, y: 0 };
  useEffect(() => {
    let active = true;
    void Promise.allSettled(EXTERNAL_NEON_FONTS.map(font => loadNeonFont(font.id))).then(results => {
      if (!active) return;
      setFailedFonts(results.flatMap((result, index) => result.status === 'rejected' ? [EXTERNAL_NEON_FONTS[index].id] : []));
      refresh(value => value + 1);
    });
    return () => { active = false; };
  }, []);
  const samples = useMemo(() => new Map(NEON_FONTS.map(font => {
    try { return [font.id, createNeonDesign(font.cyrillic ? 'Свет' : 'Neon', 300, 6, font.id)] as const; }
    catch { return [font.id, null] as const; }
  })), [version]);
  const selectLine = (index: number) => { selectLocalLine(index); onSelectLine?.(index); };
  const setLineFont = (value: string) => onChange({ neonLineFonts: Array.from({ length: 3 }, (_, index) => index === line ? value : project.neonLineFonts?.[index] || project.neonFont) });
  const setLineColor = (value: string) => onChange({ neonLineColors: Array.from({ length: 3 }, (_, index) => index === line ? value : project.neonLineColors?.[index] || project.neonColor) });
  const setLineScale = (value: number) => onChange({ neonLineScales: Array.from({ length: 3 }, (_, index) => index === line ? clamp(value, .5, 2) : project.neonLineScales?.[index] ?? 1) });
  const setLineOffset = (value: NeonLineOffset) => onChange({ neonLineOffsets: Array.from({ length: 3 }, (_, index) => index === line ? value : project.neonLineOffsets?.[index] ?? { x: 0, y: 0 }) });
  const hasCyrillic = /[А-Яа-яЁё]/.test(selectedText);
  return <div className="neon-controls" data-font-catalog-version={version} data-selected-line={line}>
    <div className="neon-controls-heading"><h3>Неоновая надпись</h3>{onUndo && <button type="button" className="neon-undo" onClick={onUndo} disabled={!canUndo} aria-label="Отменить последнее изменение"><Undo2 size={15} aria-hidden="true" />Отменить</button>}</div>
    <label className="builder-field"><span>Текст вывески</span><textarea rows={3} maxLength={60} value={project.neonText} onChange={event => onChange({ neonText: event.target.value.split('\n').slice(0, 3).join('\n') })} /><small>До трех строк и 60 символов. Enter добавляет строку.</small></label>
    <div className="neon-alignment" role="group" aria-label="Выравнивание строк">{[['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']].map(([value, label]) => <button type="button" key={value} aria-pressed={project.neonAlign === value} onClick={() => onChange({ neonAlign: value })}>{label}</button>)}</div>
    <div className="neon-alignment neon-row-tabs" role="group" aria-label="Строка для редактирования">{[0, 1, 2].map(index => <button type="button" key={index} aria-pressed={line === index} onClick={() => selectLine(index)}>Строка {index + 1}</button>)}</div>
    <p className="control-note neon-line-caption">{selectedText ? `«${selectedText}»` : `Добавьте текст в строку ${line + 1}`} · шрифт, цвет и размер этой строки</p>
    <label className="builder-field"><span>Шрифт строки {line + 1}</span><select value={fontId} onChange={event => setLineFont(event.target.value)}>{['Современные', 'Рукописные'].map(group => <optgroup key={group} label={group}>{NEON_FONTS.filter(font => font.group === group).map(font => <option key={font.id} value={font.id} disabled={(!font.cyrillic && hasCyrillic) || failedFonts.includes(font.id) || !samples.get(font.id)}>{font.label}{font.cyrillic ? ' · RU / EN' : ' · EN'}</option>)}</optgroup>)}</select></label>
    <div className="neon-font-filters" role="group" aria-label="Группа неоновых шрифтов">{['Все', 'Кириллица', 'Рукописные', 'Современные'].map(label => <button type="button" key={label} aria-pressed={category === label} onClick={() => setCategory(label)}>{label}</button>)}</div>
    <div className="neon-font-gallery">{NEON_FONTS.filter(font => category === 'Все' || category === 'Кириллица' && font.cyrillic || font.group === category).map(font => {
      const design = samples.get(font.id), unsupported = !font.cyrillic && hasCyrillic, unavailable = failedFonts.includes(font.id);
      return <button type="button" key={font.id} aria-label={'Шрифт ' + font.label} aria-pressed={fontId === font.id} disabled={unsupported || unavailable || !design} title={unsupported ? 'Шрифт для латиницы. Для этой строки выберите RU / EN.' : unavailable ? 'Шрифт не загрузился. Выберите другой.' : font.label} onClick={() => setLineFont(font.id)}>
        {design ? <svg viewBox={`-15 -15 ${design.width + 30} ${design.height + 30}`} aria-hidden="true"><g fill="none" stroke="#ffd3ad" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">{design.paths.map((path, index) => <polyline key={index} points={path.map(point => point.join(',')).join(' ')} />)}</g></svg> : <span className="neon-font-placeholder">{unavailable ? 'Недоступен' : 'Загрузка…'}</span>}
        <strong>{font.label}</strong><small>{font.cyrillic ? 'RU / EN' : 'EN · латиница'}</small>
      </button>;
    })}</div>
    {failedFonts.length > 0 && <p className="control-note" role="status">Некоторые шрифты не загрузились. Доступные шрифты можно выбрать выше.</p>}
    <fieldset className="neon-color-palette"><legend>Цвет строки {line + 1}</legend>{COLORS.map(([value, label]) => <button type="button" key={value} aria-label={label} aria-pressed={color === value} title={label} style={{ background: value }} onClick={() => setLineColor(value)} />)}</fieldset>
    <label className="builder-field"><span>Свой цвет строки {line + 1}</span><input type="color" value={color} onChange={event => setLineColor(event.target.value)} /></label>
    <label className="builder-field"><span>Масштаб строки {line + 1} · {Math.round(scale * 100)}%</span><input aria-label={`Масштаб строки ${line + 1}`} type="range" min={50} max={200} step={5} value={Math.round(scale * 100)} onChange={event => setLineScale(Number(event.target.value) / 100)} /></label>
    <div className="dimension-number-grid">{(['x', 'y'] as const).map((axis, index) => <label key={axis} className="builder-field"><span>{index ? 'Сдвиг по вертикали' : 'Сдвиг по горизонтали'}, мм</span><input type="number" min={index ? -700 : -1800} max={index ? 700 : 1800} step={5} value={offset[axis]} onChange={event => setLineOffset({ ...offset, [axis]: clamp(Number(event.target.value) || 0, index ? -700 : -1800, index ? 700 : 1800) })} /></label>)}</div>
    <div className="neon-alignment"><button type="button" onClick={() => setLineOffset({ x: 0, y: 0 })}>Центровать строку</button><button type="button" onClick={() => setLineScale(1)}>Масштаб 100%</button></div>
    <p className="control-note">В режиме 2D строку можно выбрать и переместить прямо на макете. Угловой маркер меняет ее размер.</p>
    <h3>Размер вывески</h3>
    <div className="neon-alignment neon-size-presets" role="group" aria-label="Готовая ширина надписи">{[[600, '60 см'], [900, '90 см'], [1200, '120 см']].map(([value, label]) => <button type="button" key={value} aria-pressed={project.neonTargetWidth === value} onClick={() => onChange({ neonTargetWidth: Number(value) })}>{label}</button>)}</div>
    <label className="builder-field"><span>Ширина надписи, мм</span><input type="number" min={150} max={3800} step={10} value={project.neonTargetWidth || Math.round(measuredWidth || Math.max(150, project.neonBackerWidth - 60))} onChange={event => onChange({ neonTargetWidth: clamp(Number(event.target.value) || 150, 150, 3800) })} /></label>
    <label className={'width-auto-checkbox ' + (project.neonKeepAspect ? 'checked' : '')}><input type="checkbox" checked={project.neonKeepAspect} onChange={event => onChange({ neonKeepAspect: event.target.checked })} /><span><strong>Сохранять пропорции</strong><small>{project.neonKeepAspect ? 'Высота меняется вместе с шириной' : 'Высоту букв можно менять отдельно'}</small></span></label>
    <label className="builder-field"><span>Высота букв, мм</span><input type="number" min={40} max={800} step={10} value={project.neonHeight} onChange={event => onChange({ neonHeight: clamp(Number(event.target.value) || 40, 40, 800) })} /></label>
    <label className="builder-field"><span>Толщина неона</span><select value={project.neonDiameter} onChange={event => onChange({ neonDiameter: Number(event.target.value) })}><option value={6}>6 мм</option><option value={8}>8 мм</option></select></label>
    <label className="builder-field"><span>Неоновый значок</span><select value={project.neonIcon || 'none'} onChange={event => onChange({ neonIcon: event.target.value })}>{ICONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="builder-field"><span>Яркость свечения · {project.neonBrightness}%</span><input aria-label="Яркость свечения" type="range" min={10} max={100} value={project.neonBrightness} onChange={event => onChange({ neonBrightness: Number(event.target.value) })} /></label>
    <h3>Подложка и крепление</h3>
    <label className="builder-field"><span>Форма подложки</span><select value={project.neonBackerShape} onChange={event => onChange({ neonBackerShape: event.target.value })}><option value="rectangle">Прямоугольная</option><option value="rounded">Скругленные углы</option><option value="contour">По внешнему контуру</option></select></label>
    <label className="builder-field"><span>Цвет подложки</span><select value={project.neonBackerColor || 'clear'} onChange={event => onChange({ neonBackerColor: event.target.value as NeonSettings['neonBackerColor'] })}><option value="clear">Прозрачная</option><option value="white">Белая</option><option value="black">Черная</option></select></label>
    <div className="dimension-number-grid">{(['neonBackerWidth', 'neonBackerHeight'] as const).map((key, index) => <label key={key} className="builder-field"><span>{index ? 'Высота' : 'Ширина'} подложки, мм</span><input type="number" min={150} max={index ? 1450 : 3950} step={10} value={project[key]} onChange={event => onChange({ [key]: clamp(Number(event.target.value) || 150, 150, index ? 1450 : 3950) })} /></label>)}</div>
    <label className="builder-field"><span>Крепление</span><select value={project.neonInstallMode || 'standoffs'} onChange={event => onChange({ neonInstallMode: event.target.value as NeonSettings['neonInstallMode'] })}><option value="standoffs">На дистанционных держателях</option><option value="hanging">На подвесах</option></select><small>{project.neonInstallMode === 'hanging' ? 'Два подвеса над подложкой' : 'Дистанционные держатели · отступ 20 мм'}</small></label>
    <label className="builder-field"><span>Где будет вывеска</span><select value={project.neonUse || 'indoor'} onChange={event => onChange({ neonUse: event.target.value as NeonSettings['neonUse'] })}><option value="indoor">В помещении</option><option value="outdoor">На улице</option></select>{project.neonUse === 'outdoor' && <small>Уличное исполнение согласуем при расчёте.</small>}</label>
    <p className="control-note">Подложка увеличивается, если надпись не помещается. Цвет, размеры и крепление видны в 2D и 3D.</p>
  </div>;
}
