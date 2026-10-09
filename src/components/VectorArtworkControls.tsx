import { MousePointer2, Upload, X } from 'lucide-react';
import type { VectorArtworkObject } from '../lib/vectorArtwork';
import '../vector-artwork.css';

type Props = {
  objects: VectorArtworkObject[];
  selectedIndex: number;
  importing: boolean;
  report: string;
  onImport: () => void;
  onSelect: (index: number) => void;
  onChange: (index: number, patch: Partial<VectorArtworkObject>) => void;
  onRemove: (index: number) => void;
};

export function VectorArtworkControls({ objects, selectedIndex, importing, report, onImport, onSelect, onChange, onRemove }: Props) {
  const selected = objects[selectedIndex];
  return <section className="vector-artwork-controls control-section" aria-label="Свой макет">
    <h3>Свой макет</h3>
    <button type="button" className="studio-button" disabled={importing} onClick={onImport}>
      <Upload size={16} />{importing ? 'Читаем контуры…' : 'Добавить свой макет'}
    </button>
    <p className="control-note">PDF, CDR или SVG · до 10 МБ. Объекты добавляются в макет, их можно перемещать, менять размер и цвет.</p>
    <details className="vector-file-requirements">
      <summary>Какие файлы подойдут</summary>
      <ul>
        <li><strong>PDF:</strong> одна страница, текст переведён в кривые, рисунок из замкнутых контуров с однотонной заливкой.</li>
        <li><strong>CDR:</strong> первая страница векторного макета CorelDRAW, текст в кривых. Совместимость проверяется при загрузке; если версия или эффект не поддерживаются, экспортируйте макет в PDF или SVG.</li>
        <li><strong>SVG:</strong> контуры и простые фигуры с заливкой. Текст и обводки заранее преобразуйте в контуры.</li>
      </ul>
      <p>Сканы и фотографии не превращаются в вектор. Градиенты, тени, прозрачности и обтравочные маски нужно убрать или преобразовать в простые залитые контуры. До 64 объектов в макете.</p>
      <p>Импорт сохраняет форму и взаимное расположение объектов. Начальный размер подбирается для макета; проверьте размер в миллиметрах после загрузки. Надпись в кривых редактируется как фигура, её шрифт и исходный текст не восстанавливаются.</p>
      <p>Прямоугольник вокруг надписи распознаётся как плоская подложка, остальные контуры — как объёмные буквы. Назначение каждого объекта можно изменить вручную.</p>
      <p>Файл обрабатывается на вашем устройстве и не отправляется на сервер.</p>
    </details>
    {report && <p className="vector-import-report control-note" role="status">{report}</p>}
    {!!objects.length && <>
      <label className="builder-field"><span>Векторный объект</span>
        <select aria-label="Векторный объект" value={selectedIndex} onChange={event => onSelect(Number(event.target.value))}>
          {objects.map((object, index) => <option key={object.id} value={index}>{object.name}{object.visible ? '' : ' · скрыт'}</option>)}
        </select>
      </label>
      {selected && <fieldset className="control-section vector-object-fields" aria-label="Настройки векторного объекта">
        <label className="builder-field"><span>Назначение</span>
          <select aria-label="Назначение векторного объекта" value={selected.role ?? 'letter'} onChange={event => onChange(selectedIndex, { role: event.target.value as 'letter' | 'backing' })}>
            <option value="letter">Буквы · объёмные</option>
            <option value="backing">Подложка · плоская</option>
          </select>
        </label>
        <p className="control-note">{selected.role === 'backing' ? 'Плоская подложка толщиной 3 мм. Буквы размещаются перед ней.' : 'Глубина букв — из настроек надписи. При контражуре используются проставки 20 мм.'}</p>
        <label className="builder-field"><span>Название</span><input type="text" aria-label="Название векторного объекта" value={selected.name} maxLength={80}
          onChange={event => onChange(selectedIndex, { name: event.target.value })} /></label>
        <div className="dimension-number-grid">
          <label className="builder-field"><span>Высота, мм</span><input type="number" aria-label="Высота векторного объекта, мм" min={1} max={700} step={1} value={Number(selected.height.toFixed(2))}
            onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1 && value <= 700) onChange(selectedIndex, { height: value }); }} /></label>
          <label className="builder-field"><span>Цвет лица</span><input type="color" aria-label="Цвет векторного объекта" value={selected.color}
            onChange={event => onChange(selectedIndex, { color: event.target.value })} /></label>
        </div>
        <div className="dimension-number-grid">
          {(['x', 'y'] as const).map(axis => <label key={axis} className="builder-field"><span>Смещение {axis.toUpperCase()}, мм</span>
            <input type="number" aria-label={`Смещение ${axis.toUpperCase()} векторного объекта, мм`} min={-20000} max={20000} step={1} value={Number(selected.offset[axis].toFixed(2))}
              onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && Math.abs(value) <= 20000) onChange(selectedIndex, { offset: { ...selected.offset, [axis]: value } }); }} />
          </label>)}
        </div>
        <label className="simple-toggle"><input type="checkbox" checked={selected.visible} onChange={event => onChange(selectedIndex, { visible: event.target.checked })} />Показывать объект</label>
        <div className="dimension-number-grid">
          <button type="button" className="studio-button" onClick={() => onSelect(selectedIndex)}><MousePointer2 size={14} />На макете</button>
          <button type="button" className="studio-remove" onClick={() => onRemove(selectedIndex)}><X size={14} />Удалить объект</button>
        </div>
        <small className="control-note">Тяните объект в 2D. Маркер сверху справа меняет размер с сохранением пропорций. Стрелки — 1 мм, Shift — 10 мм.</small>
      </fieldset>}
    </>}
  </section>;
}
