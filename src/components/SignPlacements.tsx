import { createFacadeSvg, SIGN_PLACEMENTS } from '../lib/signFacade';
import type { SignPlacement } from '../lib/signFacade';
import type { ReactNode } from 'react';
export function SignPlacements({markup,night,selected,palette='stone',onPaletteChange,onChange,children}:{markup:string;night:boolean;selected:SignPlacement;palette?:'stone'|'brick'|'charcoal';onPaletteChange?:(value:'stone'|'brick'|'charcoal')=>void;onChange:(value:SignPlacement)=>void;children?:ReactNode}) {
  return <section className={'sign-placements '+(night?'night':'day')} aria-label="Примеры размещения вывески">
    <div className="placements-heading"><h2>На вашем фасаде</h2><button type="button" aria-pressed={selected==='none'} onClick={()=>onChange('none')}>Без фасада</button></div>
    <div className="facade-finishes" role="group" aria-label="Отделка фасада">{([{id:'stone',title:'Камень',color:'#ded6c7'},{id:'brick',title:'Кирпич',color:'#aa6651'},{id:'charcoal',title:'Графит',color:'#4c5057'}] as const).map(item=><button type="button" key={item.id} aria-pressed={palette===item.id} onClick={()=>onPaletteChange?.(item.id)}><i aria-hidden="true" style={{background:item.color}}/>{item.title}</button>)}</div>
    <div className="placements-grid">{SIGN_PLACEMENTS.filter(p=>p.id!=='none').map(place=><button type="button" key={place.id} aria-label={'Показать в просмотре: '+place.title} aria-pressed={selected===place.id} className={selected===place.id?'active':''} onClick={()=>onChange(place.id)}>
      <div dangerouslySetInnerHTML={{__html:createFacadeSvg(place.id,markup,night,place.id,{palette})}}/><span>{place.title}</span>
    </button>)}</div><p>Выбранный фасад отображается в основном макете в 2D и 3D. Пропорции здания — иллюстрация размещения.</p>{children}
  </section>;
}
