import { createFacadeSvg, SIGN_PLACEMENTS } from '../lib/signFacade';
import type { FacadeOptions, FacadeSignBox, SignPlacement } from '../lib/signFacade';
import type { ReactNode } from 'react';
export function SignPlacements({markup,signBox,panelMount,night,selected,palette='stone',onPaletteChange,onChange,children}:{markup:string;signBox:FacadeSignBox;panelMount?:FacadeOptions['panelMount'];night:boolean;selected:SignPlacement;palette?:'stone'|'brick'|'charcoal';onPaletteChange?:(value:'stone'|'brick'|'charcoal')=>void;onChange:(value:SignPlacement)=>void;children?:ReactNode}) {
  return <section className={'sign-placements '+(night?'night':'day')} aria-label="Примеры размещения вывески">
    <div className="placements-heading"><h2>На вашем фасаде</h2><button type="button" aria-pressed={selected==='none'} onClick={()=>onChange('none')}>Без фасада</button></div>
    <div className="facade-finishes" role="group" aria-label="Отделка фасада">{([{id:'stone',title:'Камень',color:'#ded6c7'},{id:'brick',title:'Кирпич',color:'#aa6651'},{id:'charcoal',title:'Графит',color:'#4c5057'}] as const).map(item=><button type="button" key={item.id} aria-pressed={palette===item.id} onClick={()=>onPaletteChange?.(item.id)}><i aria-hidden="true" style={{background:item.color}}/>{item.title}</button>)}</div>
    <div className="placements-grid">{SIGN_PLACEMENTS.filter(p=>p.id!=='none').map(place=><button type="button" key={place.id} aria-label={'Показать в просмотре: '+place.title} aria-pressed={selected===place.id} className={selected===place.id?'active':''} onClick={()=>onChange(place.id)}>
      <div dangerouslySetInnerHTML={{__html:createFacadeSvg(place.id,markup,night,place.id,{palette,signBox,panelMount})}}/><span>{place.title}</span>
    </button>)}</div><p>Вывеска и фасад в едином масштабе: дверь 1100 × 2100 мм. Козырёк выступает на 1500 мм, с двумя опорами и тремя ступенями.</p>{children}
  </section>;
}

type PlacementThumbnailProps = {
  markup: string; signBox: FacadeSignBox; panelMount?: FacadeOptions['panelMount'];
  night: boolean; selected: SignPlacement; palette: NonNullable<FacadeOptions['palette']>;
  onChange: (value: SignPlacement) => void;
};

export function SignPlacementThumbnails({ markup, signBox, panelMount, night, selected, palette, onChange }: PlacementThumbnailProps) {
  return <nav className={'scene-placement-thumbnails ' + (night ? 'night' : 'day')} aria-label="Размещение вывески в 3D">
    <button className="scene-placement-none" type="button" aria-pressed={selected === 'none'} onClick={() => onChange('none')}>Без фасада</button>
    {(['shop', 'windows', 'canopy', 'entrance'] as const).map(id => {
      const title = SIGN_PLACEMENTS.find(place => place.id === id)!.title;
      return <button className="scene-placement-card" type="button" key={id} aria-label={'Разместить вывеску: ' + title} aria-pressed={selected === id} onClick={() => onChange(id)}>
        <span className="scene-placement-image" aria-hidden="true" dangerouslySetInnerHTML={{ __html: createFacadeSvg(id, markup, night, 'scene-picker-' + id, { palette, signBox, panelMount }) }}/>
        <span className="scene-placement-caption">{title}</span>
      </button>;
    })}
  </nav>;
}
