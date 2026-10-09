import type { LetterContours } from './letterContours';
import { containBox, backerSeams } from './backerConstraints';
import { letterFrameLayout } from './letterFrame';
import { classifyVectorArtwork } from './vectorArtwork';
import type { VectorArtworkObject } from './vectorArtwork';

type Box = { x:number; y:number; width:number; height:number };
export type LetterRowSetting = { index:number; text:string; font:string; height:number; offset:{x:number;y:number} };
export type LetterRowLayout = {
  id:string; index:number; text:string; font:string; box:Box; pathBox:Box; inkBox:Box;
  pathData:string; naturalBox:Box; defaultX:number; defaultY:number;
  frameBox?:Box;
  kind?:'vector'; vectorRole?:'letter'|'backing'; color?:string; name?:string;
};
export type LetterRowsLayoutConfig = {
  height:number; contours?:LetterContours|null; lineSettings:LetterRowSetting[];
  logoEnabled?:boolean; logoScale:number; logoSizeMm?:number; logoShape:string; letterOutlineEnabled:boolean;
  widthOverride?:number; logoOffsetX?:number; logoOffsetY?:number; textOffsetX?:number; textOffsetY?:number;
  mountMode:string; acpLayout:{faceWidth:number;faceHeight:number;depth?:number}; frameTopPosition:number;frameBottomPosition:number;
  vectorArtwork?:VectorArtworkObject[];
};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const validBox=(box:Box|undefined):box is Box=>!!box&&[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>0&&box.height>0;
const coordinate=(value:number|undefined)=>Number.isFinite(value)?value!:0;
const union=(boxes:Box[]):Box=>{
  if(!boxes.length)return{x:0,y:0,width:1,height:1};
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return{x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
};

/** A supplied rectangular backing already supports the enclosed letters. */
export function contourBackingRows(rows: readonly LetterRowLayout[]): LetterRowLayout[] {
  const backing=rows.filter(row=>row.vectorRole==='backing');
  return rows.filter(row=>row.vectorRole!=='backing'&&!backing.some(plate=>
    row.box.x>=plate.box.x-.01&&row.box.y>=plate.box.y-.01&&
    row.box.x+row.box.width<=plate.box.x+plate.box.width+.01&&row.box.y+row.box.height<=plate.box.y+plate.box.height+.01));
}

/** Independent contours are placed in physical millimetres before either renderer consumes them. */
export function createLetterRowsLayout(config:LetterRowsLayoutConfig) {
  const records=config.contours?.lines??(config.contours?[config.contours]:[]);
  const baseHeight=clamp(config.height,100,700);
  const draft=config.lineSettings.map((setting,i)=>{
    const fallback:LetterContours={pathData:'',mainBox:{x:0,y:-714,width:Math.max(1,setting.text.length)*640,height:714},inkBox:{x:0,y:-714,width:Math.max(1,setting.text.length)*640,height:714}};
    const record=records[i],data=record&&validBox(record.mainBox)&&validBox(record.inkBox)?record:fallback;
    const height=clamp(setting.height||baseHeight,100,700),outline=config.letterOutlineEnabled?Math.max(4,height*.035):0;
    const coreHeight=Math.max(1,height-outline*2),width=data.mainBox.width/data.mainBox.height*coreHeight;
    const overTop=Math.max(0,data.mainBox.y-data.inkBox.y)/data.mainBox.height*coreHeight;
    const overBottom=Math.max(0,data.inkBox.y+data.inkBox.height-data.mainBox.y-data.mainBox.height)/data.mainBox.height*coreHeight;
    return{setting:{...setting,offset:{x:coordinate(setting.offset?.x),y:coordinate(setting.offset?.y)}},data,height,outline,width:width+outline*2,coreHeight,overTop,overBottom,y:0};
  }).filter(row=>row.setting.text.trim());
  let previous:typeof draft[number]|undefined;
  for(const row of draft){row.y=previous?previous.y+previous.height+Math.max(Math.max(previous.height,row.height)*.35,previous.overBottom+row.overTop+15):0;previous=row;}
  // Imported path coordinates are normalized to physical millimetres once, at import.
  // Their source anchors remain fixed when one part is independently resized.
  const vectors=classifyVectorArtwork(config.vectorArtwork??[]).map((object,index)=>({object,index}))
    .filter(({object})=>object.visible!==false&&object.pathData&&validBox(object.box))
    .map(({object,index})=>{const height=clamp(Number.isFinite(object.height)?object.height:object.box.height,1,700);
      return{object,index,height,width:object.box.width*height/object.box.height};});
  const vectorSourceBox=union((config.vectorArtwork??[]).filter(object=>validBox(object.box)).map(object=>object.box));
  const vectorSpan=union(vectors.map(({object,width,height})=>({x:object.box.x-vectorSourceBox.x,y:object.box.y-vectorSourceBox.y,width,height})));
  const vectorWidth=vectorSpan.x+vectorSpan.width,vectorHeight=vectorSpan.y+vectorSpan.height;
  const ordinaryTextHeight=draft.length?Math.max(...draft.map(r=>r.y+r.height)):0;
  const vectorTop=vectors.length&&draft.length?ordinaryTextHeight+baseHeight*.35:0;
  const textNaturalWidth=Math.max(1,...draft.map(r=>r.width),...(vectors.length?[vectorWidth]:[]));
  const textNaturalHeight=Math.max(ordinaryTextHeight,vectors.length?vectorTop+vectorHeight:0);
  const logoSize=config.logoEnabled?(config.logoSizeMm===undefined?clamp(baseHeight*clamp(config.logoScale,45,130)/100,100,700):clamp(config.logoSizeMm,100,700)):0;
  const hasArtwork=draft.length>0||vectors.length>0;
  const gap=config.logoEnabled&&hasArtwork?baseHeight*.16:0;
  const widthRequested=hasArtwork?(config.widthOverride?Math.max(logoSize+gap+20,config.widthOverride,...(vectors.length?[logoSize+gap+vectorWidth]:[])):logoSize+gap+textNaturalWidth):Math.max(1,logoSize);
  const stretch=Math.max(1,widthRequested-logoSize-gap)/textNaturalWidth;
  const overTop=Math.max(0,...draft.map(r=>r.overTop-r.y));
  const overBottom=Math.max(0,...draft.map(r=>r.y+r.height+r.overBottom-textNaturalHeight));
  const signHeight=Math.max(textNaturalHeight,logoSize);
  const panelRequired=config.mountMode==='acp';
  const minimumFit=Math.max(0,...draft.map(row=>100/row.height),...vectors.map(row=>1/row.height),...(logoSize?[100/logoSize]:[]));
  const fit=panelRequired?Math.max(minimumFit,Math.min(1,(config.acpLayout.faceWidth-12)/widthRequested,
    (config.acpLayout.faceHeight-12)/(signHeight+overTop+overBottom))):1;
  const textWidth=hasArtwork?(widthRequested-logoSize-gap)*fit:0,textHeight=textNaturalHeight*fit;
  const offsets=[...config.lineSettings.map(s=>({x:coordinate(s.offset?.x),y:coordinate(s.offset?.y)})),
    ...vectors.map(({object})=>({x:coordinate(object.offset?.x),y:coordinate(object.offset?.y)}))];
  const extraX=panelRequired?0:Math.max(Math.abs(config.logoOffsetX??0),Math.abs(config.textOffsetX??0)+Math.max(0,...offsets.map(o=>Math.abs(o.x))));
  const extraY=panelRequired?0:Math.max(Math.abs(config.logoOffsetY??0),Math.abs(config.textOffsetY??0)+Math.max(0,...offsets.map(o=>Math.abs(o.y))));
  const baseWidth=panelRequired?config.acpLayout.faceWidth:widthRequested*fit+extraX*2;
  const baseCanvasHeight=panelRequired?config.acpLayout.faceHeight:signHeight*fit+extraY*2;
  const margin=Math.max(100,(overTop+overBottom)*fit+70,Math.min(550,Math.max(baseCanvasHeight*.24,baseWidth*.045)));
  const viewWidth=baseWidth+margin*2,viewHeight=baseCanvasHeight+margin*2;
  const baseX=(viewWidth-widthRequested*fit)/2,baseY=(viewHeight-signHeight*fit)/2;
  const groupX=baseX+(logoSize+gap)*fit,groupY=baseY+(signHeight-textNaturalHeight)*fit/2;
  const panelBox={x:(viewWidth-config.acpLayout.faceWidth)/2,y:(viewHeight-config.acpLayout.faceHeight)/2,width:config.acpLayout.faceWidth,height:config.acpLayout.faceHeight};
  const container={x:panelBox.x+6,y:panelBox.y+6,width:panelBox.width-12,height:panelBox.height-12};
  const textRows:LetterRowLayout[]=draft.map(row=>{
    const width=row.width*stretch*fit,height=row.height*fit;
    const defaultX=groupX+(textWidth-width)/2+(config.textOffsetX??0),defaultY=groupY+row.y*fit+(config.textOffsetY??0);
    let box={x:defaultX+row.setting.offset.x,y:defaultY+row.setting.offset.y,width,height};
    const outlineX=row.outline*stretch*fit,outlineY=row.outline*fit;
    let pathBox={x:box.x+outlineX,y:box.y+outlineY,width:Math.max(1,box.width-outlineX*2),height:Math.max(1,box.height-outlineY*2)};
    const sx=pathBox.width/row.data.mainBox.width,sy=pathBox.height/row.data.mainBox.height;
    let inkBox={x:pathBox.x+(row.data.inkBox.x-row.data.mainBox.x)*sx-outlineX,
      y:pathBox.y+(row.data.inkBox.y-row.data.mainBox.y)*sy-outlineY,
      width:Math.max(1,row.data.inkBox.width*sx+outlineX*2),height:Math.max(1,row.data.inkBox.height*sy+outlineY*2)};
    if(panelRequired){const bounded=containBox(inkBox,container),dx=bounded.x-inkBox.x,dy=bounded.y-inkBox.y;
      box={...box,x:box.x+dx,y:box.y+dy};pathBox={...pathBox,x:pathBox.x+dx,y:pathBox.y+dy};inkBox=bounded;}
    const support=row.data.supportBox??row.data.mainBox;
    const frameBox={...box,y:pathBox.y+(support.y-row.data.mainBox.y)*sy-outlineY,height:support.height*sy+outlineY*2};
    return{id:'line-'+row.setting.index,index:row.setting.index,text:row.setting.text,font:row.setting.font,box,pathBox,inkBox,frameBox,pathData:row.data.pathData,naturalBox:row.data.mainBox,defaultX,defaultY};
  });
  for(const {object,index,width,height} of vectors){
    const defaultX=groupX+(textWidth-vectorWidth*fit)/2+(object.box.x-vectorSourceBox.x)*fit+(config.textOffsetX??0);
    const defaultY=groupY+(vectorTop+object.box.y-vectorSourceBox.y)*fit+(config.textOffsetY??0);
    let box={x:defaultX+coordinate(object.offset?.x),y:defaultY+coordinate(object.offset?.y),width:width*fit,height:height*fit};
    if(panelRequired)box=containBox(box,container);
    textRows.push({id:'line-'+(3+index),index:3+index,text:object.name||'Вектор '+(index+1),font:'',kind:'vector',vectorRole:object.role??'letter',name:object.name,color:object.color,
      box,pathBox:box,inkBox:box,pathData:object.pathData,naturalBox:object.box,defaultX,defaultY});
  }
  const defaultLogoX=baseX,defaultLogoY=baseY+(signHeight-logoSize)*fit/2;
  let logoBox={x:defaultLogoX+(config.logoOffsetX??0),y:defaultLogoY+(config.logoOffsetY??0),width:logoSize*fit,height:logoSize*fit};
  if(panelRequired)logoBox=containBox(logoBox,container);
  const emptyTextBox={x:groupX+(config.textOffsetX??0),y:groupY+(config.textOffsetY??0),width:1,height:1};
  const textBox=textRows.length?union(textRows.map(r=>r.box)):emptyTextBox,textInkBox=textRows.length?union(textRows.map(r=>r.inkBox)):emptyTextBox;
  const signObjects=[...textRows.map(r=>r.box),...(config.logoEnabled?[logoBox]:[])];
  const signBox=signObjects.length?union(signObjects):{x:baseX,y:baseY,width:1,height:1};
  const frame=letterFrameLayout(textRows.filter(r=>r.text.trim()&&r.vectorRole!=='backing').map(r=>({id:r.id,box:r.frameBox??r.box})),{profile:15,topInset:config.frameTopPosition,bottomInset:config.frameBottomPosition,
    logo:config.logoEnabled?{box:logoBox,shape:config.logoShape as 'circle'|'square'|'rounded',cornerRadius:logoBox.width*.16}:undefined});
  const firstRails=frame.rowRails[0];
  const haloBackerBox={x:signBox.x-baseHeight*fit*.16,y:signBox.y-baseHeight*fit*.11,width:signBox.width+baseHeight*fit*.32,height:signBox.height+baseHeight*fit*.22};
  return{viewWidth,viewHeight,signBox,logoBox,logoCornerRadius:logoBox.width*.16,textRows,frameSegments:frame.segments,textStretch:stretch,naturalTextWidth:textNaturalWidth,
    textX:textBox.x,textTop:textBox.y,textBaseline:textRows[0]?textRows[0].pathBox.y-textRows[0].naturalBox.y*textRows[0].pathBox.height/textRows[0].naturalBox.height:textBox.y+textBox.height,
    textWidth:textBox.width,textHeight:textBox.height,textInkBox,
    defaultTextX:textBox.x-(config.textOffsetX??0),defaultTextY:textBox.y-(config.textOffsetY??0),defaultLogoX,defaultLogoY,
    letterLineOffsets:Array.from({length:3+(config.vectorArtwork?.length??0)},(_,index)=>{const row=index<3?config.lineSettings.find(s=>s.index===index):config.vectorArtwork?.[index-3];return{x:coordinate(row?.offset?.x),y:coordinate(row?.offset?.y)};}),
    fontSize:(textRows[0]?.pathBox.height??baseHeight)*1000/(textRows[0]?.naturalBox.height??714),
    textPathData:config.contours?.pathData??'',textNaturalBox:validBox(config.contours?.mainBox)?config.contours!.mainBox:
      textRows[0]?.naturalBox??{x:0,y:-714,width:714,height:714},
    railX:firstRails?.x??signBox.x,railWidth:firstRails?.width??signBox.width,railHeight:15,railTopY:firstRails?.top??signBox.y+22.5,railBottomY:firstRails?.bottom??signBox.y+signBox.height-22.5,
    panelBox,panelCornerRadius:0,haloBackerBox,haloBackerRadius:Math.min(baseHeight*fit*.28,haloBackerBox.height/2),seamXs:panelRequired?backerSeams(panelBox.width,config.acpLayout.depth??50).map(x=>panelBox.x+x):[] as number[],seamYs:[] as number[],fit};
}
