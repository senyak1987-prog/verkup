import { useEffect, useRef, useState } from 'react';
const places = [{ id:'windows', title:'Над окнами' },{ id:'shop', title:'Над витриной' },{ id:'canopy', title:'На козырьке' },{ id:'entrance', title:'У входа' }];
export function SignPlacements({ markup, night }: { markup: string; night: boolean }) {
  const [selected, select] = useState('windows');
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedPreview = useRef<HTMLDivElement>(null);
  const previewCards = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      const svg = previewCards.current?.querySelector('button[data-place="' + selected + '"] svg');
      if (svg && selectedPreview.current) selectedPreview.current.innerHTML = svg.outerHTML.replace(/id="([^"]+)"/g, (_a,id:string)=>`id="enlarged-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a,id:string)=>`url(#enlarged-${id})`);
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open, selected]);
  const inner = markup.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<svg\b([^>]*)>/, (_tag, attributes: string) => '<svg x="85" y="47" width="330" height="82" ' + attributes.replace(/\s(?:width|height)="[^"]*"/g, '') + '>');
  return <section className={'sign-placements ' + (night ? 'night' : 'day')} aria-label="Примеры размещения вывески">
    <div className="placements-heading"><h2>На вашем фасаде</h2><span>Примеры размещения</span></div>
    <div className="placements-grid" ref={previewCards}>{places.map(place => <button type="button" key={place.id} data-place={place.id} aria-label={"Посмотреть размещение: " + place.title} aria-pressed={selected===place.id} onClick={()=>{select(place.id);setOpen(true);}} className={selected===place.id?'active':''}>
      <svg viewBox="0 0 500 280" aria-label={place.title} role="img">
        <rect width="500" height="280" fill={night?'#243e38':'#e2dfd3'}/>
        <path d="M0 25H500M0 140H500M0 267H500" stroke={night?'#375049':'#cec9bc'} strokeWidth="4"/>
        {place.id==='canopy' && <><path d="M40 60H455L475 130H20Z" fill={night?'#384d46':'#6b8174'} stroke="#416957" strokeWidth="4"/><path d="M20 130H475V144H20Z" fill="#1d5540"/></>}
        {place.id==='entrance'?<><rect x="310" y="145" width="100" height="123" fill="#173d36"/><rect x="323" y="158" width="74" height="98" fill={night?'#d9b768':'#7ba1a3'}/><path d="M389 199v22" stroke="#f4e9c4" strokeWidth="4"/></>
          :place.id==='shop'?<><rect x="50" y="150" width="400" height="118" fill="#24463e"/><rect x="60" y="160" width="380" height="100" fill={night?'#c1a46b':'#89a7a7'}/><path d="M170 155V265M330 155V265" stroke="#355347" strokeWidth="10"/><path d="M65 161L155 258M220 161L300 258M350 161L435 252" stroke="#d3e3df" strokeOpacity=".3" strokeWidth="18"/></>
          :[60,210,360].map(x=><g key={x}><rect x={x} y="150" width="85" height="115" fill="#416754"/><rect x={x+7} y="157" width="71" height="101" fill={night?'#c8b779':'#8eadae'}/><path d={`M${x+42} 157v101M${x+7} 207h71`} stroke="#496b59" strokeWidth="5"/></g>)}
        <g className="placement-sign" dangerouslySetInnerHTML={{__html:inner.replace(/id="([^"]+)"/g, (_a,id:string)=>`id="${place.id}-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a,id:string)=>`url(#${place.id}-${id})`)}} />
      </svg><span>{place.title}</span></button>)}</div>
    <dialog ref={dialog} className="placement-dialog" aria-labelledby="placement-title" onCancel={event=>{event.preventDefault();setOpen(false);}}><header><h2 id="placement-title">{places.find(place=>place.id===selected)?.title}</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Закрыть пример размещения">Закрыть ×</button></header><div ref={selectedPreview}/><p>Иллюстрация размещения. Габариты указаны на основном макете.</p></dialog>
    <p>Иллюстрация размещения. Для проверки масштаба используйте размеры основного макета.</p>
  </section>;
}
