import { NEON_FONTS } from '../lib/neonConstruction';
export type NeonSettings = { neonText: string; neonFont: string; neonHeight: number; neonDiameter: number; neonColor: string; neonBackerWidth: number; neonBackerHeight: number };
export function NeonControls({ project, onChange }: { project: NeonSettings; onChange: (patch: Partial<NeonSettings>) => void }) {
  return <div className="neon-controls">
    <label className="builder-field"><span>Неоновая надпись</span><textarea rows={2} maxLength={60} value={project.neonText} onChange={e=>onChange({neonText:e.target.value.split("\n").slice(0,2).join("\n")})}/><small>До двух строк · русские и латинские буквы, цифры</small></label>
    <label className="builder-field"><span>Неоновый шрифт</span><select value={project.neonFont} onChange={e=>onChange({neonFont:e.target.value})}>{NEON_FONTS.map(font=><option key={font.id} value={font.id}>{font.label}</option>)}</select><small>Линейные шрифты под трубку · прописные буквы</small></label>
    <label className="builder-field"><span>Толщина неона</span><select value={project.neonDiameter} onChange={e=>onChange({neonDiameter:Number(e.target.value)})}><option value={6}>6 мм</option><option value={8}>8 мм</option></select></label>
    <label className="builder-field"><span>Высота букв, мм</span><input type="number" min={120} max={800} step={10} value={project.neonHeight} onChange={e=>onChange({neonHeight:Math.max(120,Math.min(800,Number(e.target.value)||120))})}/></label>
    <label className="builder-field"><span>Цвет свечения</span><input type="color" value={project.neonColor} onChange={e=>onChange({neonColor:e.target.value})}/></label>
    <h3>Прозрачная подложка</h3><p className="control-note">Прозрачный акрил · дистанционные держатели 20 мм</p>
    <div className="dimension-number-grid">{(['neonBackerWidth','neonBackerHeight'] as const).map((key,i)=><label key={key} className="builder-field"><span>{i?'Высота':'Ширина'}, мм</span><input type="number" min={150} max={i?1450:3950} step={10} value={project[key]} onChange={e=>onChange({[key]:Math.max(150,Math.min(i?1450:3950,Number(e.target.value)||150))})}/></label>)}</div>
    <p className="control-note">Подложка автоматически увеличивается под надпись. Изменения видны в 2D и 3D.</p>
  </div>;
}
