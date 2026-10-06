import { createFacadeSvg, SIGN_PLACEMENTS } from '../lib/signFacade';
import type { SignPlacement } from '../lib/signFacade';
export function SignPlacements({markup,night,selected,onChange}:{markup:string;night:boolean;selected:SignPlacement;onChange:(value:SignPlacement)=>void}) {
  return <section className={'sign-placements '+(night?'night':'day')} aria-label="Примеры размещения вывески">
    <div className="placements-heading"><h2>На вашем фасаде</h2><button type="button" aria-pressed={selected==='none'} onClick={()=>onChange('none')}>Без фасада</button></div>
    <div className="placements-grid">{SIGN_PLACEMENTS.filter(p=>p.id!=='none').map(place=><button type="button" key={place.id} aria-label={'Показать в просмотре: '+place.title} aria-pressed={selected===place.id} className={selected===place.id?'active':''} onClick={()=>onChange(place.id)}>
      <div dangerouslySetInnerHTML={{__html:createFacadeSvg(place.id,markup,night,place.id)}}/><span>{place.title}</span>
    </button>)}</div><p>Выбранный фасад отображается в основном макете в 2D и 3D. Пропорции здания — иллюстрация размещения.</p>
  </section>;
}
