import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Check, ImagePlus, Layers, Paintbrush, Plus, Ruler, Search, Trash2, Type, Undo2, X } from 'lucide-react';
import { createNeonDesign, neonUnsupportedCharacters, NEON_FONTS } from '../lib/neonConstruction';
import { EXTERNAL_NEON_FONTS, loadNeonFont } from '../lib/neonFonts';
import { suggestNeonSizes } from '../lib/neonSizing';

export type NeonLineOffset = { x: number; y: number };
export type NeonSettings = {
  neonText: string; neonFont: string; neonHeight: number; neonDiameter: number; neonColor: string;
  neonBackerWidth: number; neonBackerHeight: number; neonBackerShape: string; neonBrightness: number; neonAlign: string;
  neonLineFonts: string[]; neonLineColors: string[]; neonLineScales: number[]; neonLineOffsets: NeonLineOffset[];
  neonIcon: string; neonBackerColor: 'clear' | 'white' | 'black'; neonInstallMode: 'standoffs' | 'hanging';
  neonUse: 'indoor' | 'outdoor'; neonTargetWidth: number; neonKeepAspect: boolean;
  neonLetterSpacing: number; neonLineSpacing: number; neonReferenceImage: string;
};
const COLORS = [['#ff5eae','Розовый'],['#ff4b3e','Красный'],['#ffa658','Оранжевый'],['#ffd45f','Желтый'],['#6cfa96','Зеленый'],['#61d6ff','Голубой'],['#687dff','Синий'],['#bf85ff','Фиолетовый'],['#ffe6bb','Теплый белый'],['#f1faff','Белый']] as const;
const ICONS = [['none','Без значка'],['heart','Сердце'],['star','Звезда'],['bolt','Молния'],['cup','Чашка'],['music','Нота'],['infinity','Бесконечность']] as const;
const SECTIONS = [{id:'text',label:'Надпись',icon:Type},{id:'style',label:'Стиль',icon:Paintbrush},{id:'size',label:'Размер',icon:Ruler},{id:'backer',label:'Подложка',icon:Layers},{id:'reference',label:'Эскиз',icon:ImagePlus}] as const;
const clamp = (n: number, min: number, max: number) => Math.max(min,Math.min(max,n));
type Props = {
  project: NeonSettings; onChange: (patch: Partial<NeonSettings>) => void; onUndo?: () => void; canUndo?: boolean;
  selectedLine?: number; onSelectLine?: (index: number) => void; measuredWidth?: number;
  requiredBacker?: {width:number;height:number}; onReferenceChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};
function BackerExample({shape}:{shape:string}) {
  const outline=shape==='contour'?'M8 26Q7 9 24 9H38Q45 2 56 9H78Q94 10 92 27Q94 44 78 45H60Q49 51 39 45H24Q8 44 8 26Z':shape==='rounded'?'M18 6H82Q94 6 94 18V36Q94 48 82 48H18Q6 48 6 36V18Q6 6 18 6Z':'M6 6H94V48H6Z';
  return <svg viewBox="0 0 100 54" aria-hidden="true"><path className="backer-example-sheet" d={outline}/><path d="M19 35V18L33 35V18M43 27H57M68 35V18H82M68 26H79M68 35H82" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function MountExample({hanging}:{hanging:boolean}) {
  return <svg viewBox="0 0 100 54" aria-hidden="true"><path d="M15 19H85V49H15Z" className="backer-example-sheet"/>{hanging?<path d="M26 1V23M74 1V23" fill="none" stroke="currentColor" strokeWidth="2"/>:<g fill="none" stroke="currentColor" strokeWidth="2">{[[23,27],[77,27],[23,41],[77,41]].map(([x,y])=><circle key={x+','+y} cx={x} cy={y} r="3"/>)}</g>}<path d="M34 37H66" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}

export function NeonControls({project,onChange,onUndo,canUndo=false,selectedLine,onSelectLine,measuredWidth,requiredBacker,onReferenceChange}:Props) {
  const [section,setSection]=useState<(typeof SECTIONS)[number]['id']>('text');
  const [category,setCategory]=useState('Все'),[query,setQuery]=useState(''),[localLine,selectLocalLine]=useState(0);
  const [version,refresh]=useState(0),[failedFonts,setFailedFonts]=useState<string[]>([]);
  const textLines=project.neonText.split('\n').slice(0,3),line=clamp(selectedLine??localLine,0,textLines.length-1);
  const selectedText=textLines[line]??'',sampleText=useDeferredValue(selectedText);
  const fontId=project.neonLineFonts?.[line]||project.neonFont,color=project.neonLineColors?.[line]||project.neonColor;
  const scale=project.neonLineScales?.[line]??1,offset=project.neonLineOffsets?.[line]??{x:0,y:0};
  useEffect(()=>{let active=true;void Promise.allSettled(EXTERNAL_NEON_FONTS.map(font=>loadNeonFont(font.id))).then(results=>{if(active){setFailedFonts(results.flatMap((r,i)=>r.status==='rejected'?[EXTERNAL_NEON_FONTS[i].id]:[]));refresh(v=>v+1);}});return()=>{active=false;};},[]);
  const samples=useMemo(()=>new Map(NEON_FONTS.map(font=>{
    const unsupported=neonUnsupportedCharacters(sampleText,font.id);
    try{return [font.id,createNeonDesign(!unsupported.length&&sampleText.trim()?sampleText:font.cyrillic?'Свет':'Neon',300,6,font.id)] as const;}catch{return [font.id,null] as const;}
  })),[version,sampleText]);
  const sizes=useMemo(()=>suggestNeonSizes(project.neonText,project.neonDiameter,project.neonFont,project.neonAlign,{lineFonts:project.neonLineFonts,lineScales:project.neonLineScales,lineOffsets:project.neonLineOffsets,icon:project.neonIcon,letterSpacing:project.neonLetterSpacing,lineSpacing:project.neonLineSpacing}),[version,project.neonText,project.neonDiameter,project.neonFont,project.neonAlign,project.neonLineFonts,project.neonLineScales,project.neonLineOffsets,project.neonIcon,project.neonLetterSpacing,project.neonLineSpacing]);
  const selectLine=(index:number)=>{selectLocalLine(index);onSelectLine?.(index);};
  const setLineFont=(value:string)=>onChange({neonLineFonts:Array.from({length:3},(_,i)=>i===line?value:project.neonLineFonts?.[i]||project.neonFont)});
  const setLineColor=(value:string)=>onChange({neonLineColors:Array.from({length:3},(_,i)=>i===line?value:project.neonLineColors?.[i]||project.neonColor)});
  const setLineScale=(value:number)=>onChange({neonLineScales:Array.from({length:3},(_,i)=>i===line?clamp(value,.5,2):project.neonLineScales?.[i]??1)});
  const setLineOffset=(value:NeonLineOffset)=>onChange({neonLineOffsets:Array.from({length:3},(_,i)=>i===line?value:project.neonLineOffsets?.[i]??{x:0,y:0})});
  const removeLine=()=>{
    const remove=<T,>(values:T[],fallback:T)=>Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>values[j]??fallback).filter((_,j)=>j!==line)[i]??fallback);
    onChange({neonText:textLines.filter((_,i)=>i!==line).join('\n'),neonLineFonts:remove(project.neonLineFonts,project.neonFont),neonLineColors:remove(project.neonLineColors,project.neonColor),neonLineScales:remove(project.neonLineScales,1),neonLineOffsets:remove(project.neonLineOffsets,{x:0,y:0})});selectLine(Math.max(0,line-1));
  };
  const fonts=NEON_FONTS.filter(font=>(category==='Все'||category==='Кириллица'&&font.cyrillic||font.group===category)&&(font.label+' '+font.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const incompatible=textLines.some(text=>neonUnsupportedCharacters(text,fontId).length>0);
  const title={text:'Неоновая надпись',style:'Шрифт и цвет',size:'Размер и свечение',backer:'Подложка и крепление',reference:'Свой эскиз'}[section];
  return <div className="neon-controls" data-font-catalog-version={version} data-selected-line={line}>
    <nav className="neon-sections" aria-label="Разделы настроек неона">{SECTIONS.map(item=><button type="button" key={item.id} aria-pressed={section===item.id} onClick={()=>setSection(item.id)}><item.icon size={17} aria-hidden="true"/><span>{item.label}</span></button>)}</nav>
    <div className="neon-controls-heading"><h3>{title}</h3>{onUndo&&<button type="button" className="neon-undo" onClick={onUndo} disabled={!canUndo} aria-label="Отменить последнее изменение"><Undo2 size={15} aria-hidden="true"/>Отменить</button>}</div>
    {(section==='text'||section==='style')&&<>
      <div className="neon-row-selector" role="group" aria-label="Строка для редактирования">{textLines.map((text,i)=><button type="button" key={i} aria-pressed={line===i} onClick={()=>selectLine(i)} title={text||'Пустая строка'}>Строка {i+1}</button>)}{section==='text'&&<button type="button" className="neon-add-line" disabled={textLines.length>=3||project.neonText.length>=60} onClick={()=>{onChange({neonText:project.neonText+'\n'});selectLine(textLines.length);}}><Plus size={14}/>Строка</button>}</div>
      {section==='style'&&<p className="control-note neon-line-caption">{selectedText?`«${selectedText}»`:`Добавьте текст в строку ${line+1}`} · меняем эту строку</p>}
    </>}
    {section==='text'&&<>
      <label className="builder-field"><span>Текст вывески</span><textarea rows={3} maxLength={60} value={project.neonText} onChange={e=>onChange({neonText:e.target.value.split('\n').slice(0,3).join('\n')})}/><small>До трёх строк и 60 символов. Enter добавляет строку.</small></label>
      <div className="neon-alignment" role="group" aria-label="Выравнивание строк">{[['left','Слева'],['center','По центру'],['right','Справа']].map(([value,label])=><button type="button" key={value} aria-pressed={project.neonAlign===value} onClick={()=>onChange({neonAlign:value})}>{label}</button>)}</div>
      <div className="dimension-number-grid"><label className="builder-field"><span>Интервал букв, мм</span><input type="number" min={0} max={100} step={1} value={project.neonLetterSpacing} onChange={e=>onChange({neonLetterSpacing:clamp(Number(e.target.value)||0,0,100)})}/></label><label className="builder-field"><span>Интервал строк, мм</span><input type="number" min={0} max={300} step={5} value={project.neonLineSpacing} onChange={e=>onChange({neonLineSpacing:clamp(Number(e.target.value)||0,0,300)})}/></label></div>
      <small className="control-note">Дополнительный отступ. Форма самой трубки сохраняется.</small>
      <label className="builder-field"><span>Неоновый значок</span><select value={project.neonIcon||'none'} onChange={e=>onChange({neonIcon:e.target.value})}>{ICONS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <details className="neon-advanced"><summary>Положение и масштаб строки {line+1}</summary><div>
        <label className="builder-field"><span>Масштаб строки {line+1} · {Math.round(scale*100)}%</span><input aria-label={`Масштаб строки ${line+1}`} type="range" min={50} max={200} step={5} value={Math.round(scale*100)} onChange={e=>setLineScale(Number(e.target.value)/100)}/></label>
        <div className="dimension-number-grid">{(['x','y'] as const).map((axis,i)=><label key={axis} className="builder-field"><span>{i?'Сдвиг по вертикали':'Сдвиг по горизонтали'}, мм</span><input type="number" min={i?-700:-1800} max={i?700:1800} step={5} value={offset[axis]} onChange={e=>setLineOffset({...offset,[axis]:clamp(Number(e.target.value)||0,i?-700:-1800,i?700:1800)})}/></label>)}</div>
        <div className="neon-alignment"><button type="button" onClick={()=>setLineOffset({x:0,y:0})}>Центровать строку</button><button type="button" onClick={()=>setLineScale(1)}>Масштаб 100%</button></div>
      </div></details>
      <p className="control-note">Нажмите «Редактировать макет» в 2D, чтобы двигать строку и менять её размер мышью.</p>
      <div className="neon-text-actions"><button type="button" className="neon-next" onClick={()=>setSection('style')}>Выбрать шрифт и цвет<Paintbrush size={15}/></button>{textLines.length>1&&<button type="button" className="neon-remove-line" onClick={removeLine}><Trash2 size={14}/>Удалить строку {line+1}</button>}</div>
    </>}
    {section==='style'&&<>
      <label className="builder-field"><span>Шрифт строки {line+1}</span><select value={fontId} onChange={e=>setLineFont(e.target.value)}>{['Современные','Рукописные'].map(group=><optgroup key={group} label={group}>{NEON_FONTS.filter(font=>font.group===group).map(font=><option key={font.id} value={font.id} disabled={neonUnsupportedCharacters(selectedText,font.id).length>0||failedFonts.includes(font.id)||!samples.get(font.id)}>{font.label}{font.cyrillic?' · RU / EN':' · EN'}</option>)}</optgroup>)}</select></label>
      <label className="neon-font-search"><Search size={16} aria-hidden="true"/><input type="search" aria-label="Поиск неонового шрифта" placeholder="Найти шрифт" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="neon-font-filters" role="group" aria-label="Группа неоновых шрифтов">{['Все','Кириллица','Рукописные','Современные'].map(label=><button type="button" key={label} aria-pressed={category===label} onClick={()=>setCategory(label)}>{label}</button>)}</div>
      <div className="neon-font-gallery">{fonts.map(font=>{
        const design=samples.get(font.id),unsupported=neonUnsupportedCharacters(selectedText,font.id),unavailable=failedFonts.includes(font.id);
        return <button type="button" key={font.id} aria-label={'Шрифт '+font.label} aria-pressed={fontId===font.id} disabled={unsupported.length>0||unavailable||!design} title={unsupported.length?`Не поддерживает: ${unsupported.join(' ')}. Выберите другой шрифт.`:unavailable?'Шрифт не загрузился. Выберите другой.':font.label} onClick={()=>setLineFont(font.id)}>
          {design?<svg viewBox={`-15 -15 ${design.width+30} ${design.height+30}`} aria-hidden="true"><g fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">{design.paths.map((path,i)=><polyline key={i} points={path.map(p=>p.join(',')).join(' ')}/>)}</g></svg>:<span className="neon-font-placeholder">{unavailable?'Недоступен':'Загрузка…'}</span>}
          <strong>{font.label}{fontId===font.id&&<Check size={13}/>}</strong><small>{unsupported.length?'Не все символы поддержаны':font.cyrillic?'Кириллица / латиница':'Латиница'}</small>
        </button>;
      })}</div>
      {!fonts.length&&<p className="control-note" role="status">Шрифт не найден. Измените запрос или выберите другую группу.</p>}
      {failedFonts.length>0&&<p className="control-note" role="status">Некоторые шрифты не загрузились. Выберите доступный вариант.</p>}
      <button type="button" className="neon-link-action" disabled={incompatible} title={incompatible?'Этот шрифт поддерживает не все строки':undefined} onClick={()=>onChange({neonLineFonts:[fontId,fontId,fontId]})}>Один шрифт для всех строк</button>
      <fieldset className="neon-color-palette"><legend>Цвет строки {line+1}</legend>{COLORS.map(([value,label])=><button type="button" key={value} aria-label={label} aria-pressed={color===value} title={label} style={{background:value}} onClick={()=>setLineColor(value)}/>)}</fieldset>
      <label className="builder-field"><span>Свой цвет строки {line+1}</span><input type="color" value={color} onChange={e=>setLineColor(e.target.value)}/></label>
      <button type="button" className="neon-link-action" onClick={()=>onChange({neonLineColors:[color,color,color]})}>Один цвет для всех строк</button>
    </>}
    {section==='size'&&<>
      <div className="neon-size-presets" role="group" aria-label="Готовый размер неона">{sizes.map((size,i)=><button type="button" key={size.width} aria-pressed={Math.abs((project.neonTargetWidth||measuredWidth||0)-size.width)<5} onClick={()=>onChange({neonKeepAspect:true,neonHeight:size.height,neonTargetWidth:0,neonBackerWidth:size.backerWidth,neonBackerHeight:size.backerHeight})}><strong>{['Компактный','Средний','Крупный'][i]}</strong><span>{Math.round(size.width)} × {Math.round(size.designHeight)} мм</span></button>)}</div>
      <small className="control-note">Готовые размеры рассчитаны под вашу надпись, шрифт и толщину неона.</small>
      <div className="dimension-number-grid"><label className="builder-field"><span>Ширина надписи, мм</span><input type="number" min={150} max={3800} step={10} value={project.neonTargetWidth||Math.round(measuredWidth||Math.max(150,project.neonBackerWidth-60))} onChange={e=>onChange({neonTargetWidth:clamp(Number(e.target.value)||150,150,3800)})}/></label><label className="builder-field"><span>Высота букв, мм</span><input type="number" min={40} max={800} step={10} value={project.neonHeight} onChange={e=>onChange({neonHeight:clamp(Number(e.target.value)||40,40,800)})}/></label></div>
      <label className={'width-auto-checkbox '+(project.neonKeepAspect?'checked':'')}><input type="checkbox" checked={project.neonKeepAspect} onChange={e=>onChange({neonKeepAspect:e.target.checked})}/><span><strong>Сохранять пропорции</strong><small>{project.neonKeepAspect?'Ширина и высота связаны':'Ширину и высоту можно менять отдельно'}</small></span></label>
      <div className="neon-choice-row" role="group" aria-label="Толщина неона">{[6,8].map(value=><button type="button" key={value} aria-pressed={project.neonDiameter===value} onClick={()=>onChange({neonDiameter:value})}>Неон {value} мм</button>)}</div>
      <label className="builder-field"><span>Яркость свечения · {project.neonBrightness}%</span><input aria-label="Яркость свечения" type="range" min={10} max={100} value={project.neonBrightness} onChange={e=>onChange({neonBrightness:Number(e.target.value)})}/></label>
      <p className="control-note">Выключатель «Свет» над макетом позволяет сравнить включённую и выключенную вывеску.</p>
    </>}
    {section==='backer'&&<>
      <div className="neon-choice-grid" role="group" aria-label="Форма подложки">{[['rectangle','Прямоугольная'],['rounded','Скруглённая'],['contour','По контуру']].map(([value,label])=><button type="button" key={value} aria-pressed={project.neonBackerShape===value} onClick={()=>onChange({neonBackerShape:value})}><BackerExample shape={value}/><span>{label}</span></button>)}</div>
      <label className="builder-field"><span>Цвет подложки</span><select value={project.neonBackerColor||'clear'} onChange={e=>onChange({neonBackerColor:e.target.value as NeonSettings['neonBackerColor']})}><option value="clear">Прозрачная</option><option value="white">Белая</option><option value="black">Чёрная</option></select></label>
      <div className="dimension-number-grid">{(['neonBackerWidth','neonBackerHeight'] as const).map((key,i)=><label key={key} className="builder-field"><span>{i?'Высота':'Ширина'} подложки, мм</span><input type="number" min={150} max={i?1450:3950} step={10} value={project[key]} onChange={e=>onChange({[key]:clamp(Number(e.target.value)||150,150,i?1450:3950)})}/></label>)}</div>
      <button type="button" className="neon-link-action" disabled={!requiredBacker||requiredBacker.width>3950||requiredBacker.height>1450} onClick={()=>{if(requiredBacker)onChange({neonBackerWidth:Math.max(150,Math.ceil(requiredBacker.width)),neonBackerHeight:Math.max(150,Math.ceil(requiredBacker.height))});}}>Подогнать подложку под надпись</button>
      <div className="neon-choice-grid mount-examples" role="group" aria-label="Крепление">{[['standoffs','Держатели'],['hanging','Подвесы']].map(([value,label])=><button type="button" key={value} aria-pressed={project.neonInstallMode===value} onClick={()=>onChange({neonInstallMode:value as NeonSettings['neonInstallMode']})}><MountExample hanging={value==='hanging'}/><span>{label}</span><small>{value==='hanging'?'Два подвеса':'Отступ от стены 20 мм'}</small></button>)}</div>
      <label className="builder-field"><span>Где будет вывеска</span><select value={project.neonUse||'indoor'} onChange={e=>onChange({neonUse:e.target.value as NeonSettings['neonUse']})}><option value="indoor">В помещении</option><option value="outdoor">На улице</option></select>{project.neonUse==='outdoor'&&<small>Уличное исполнение согласуем при расчёте.</small>}</label>
      <p className="control-note">Подложка увеличивается, если надпись не помещается. Размеры, форма и крепление видны в 2D и 3D.</p>
    </>}
    {section==='reference'&&<>
      <p className="control-note">Нужен неоновый логотип или рисунок? Приложите свой эскиз к проекту для согласования конструкции и стоимости.</p>
      {onReferenceChange&&<label className="neon-reference-upload"><ImagePlus size={19}/><span>{project.neonReferenceImage?'Заменить эскиз':'Загрузить эскиз'}<small>PNG, JPG или WebP до 2 МБ</small></span><input aria-label="Загрузить эскиз неона" type="file" accept="image/png,image/jpeg,image/webp" onChange={onReferenceChange}/></label>}
      {project.neonReferenceImage&&<><img className="neon-reference-image" src={project.neonReferenceImage} alt="Эскиз неоновой вывески для согласования"/><button type="button" className="neon-link-action" onClick={()=>onChange({neonReferenceImage:''})}><X size={14}/>Убрать эскиз</button></>}
      <p className="control-note">Эскиз сохраняется в файле проекта и в корзине на этом устройстве. Изображение не преобразуется в трубку автоматически. Чтобы передать его нам, скачайте проект.</p>
    </>}
  </div>;
}
