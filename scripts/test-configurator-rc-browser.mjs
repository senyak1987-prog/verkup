import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const url = process.env.RC_CONFIGURATOR_URL || 'http://127.0.0.1:5174/verkup/sign-configurator/';
const cdp = process.env.RC_CDP_URL || 'http://127.0.0.1:9334';
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = ({data}) => {
  const message = JSON.parse(data);
  if(message.id) { const p=pending.get(message.id);message.error?p?.reject(message.error):p?.resolve(message.result);pending.delete(message.id); }
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
};
const call = (method,params={}) => new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params}));});
async function evaluate(expression) {const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;}
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(expression,timeout=35000) {const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await wait(180);}throw new Error(`Timed out: ${expression}`);}
async function click(text) {assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true;})()`),true,text);}
async function screenshot(name) {const {data}=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(new URL(`../.impeccable/review/${name}.png`,import.meta.url),Buffer.from(data,'base64'));}
async function size(width,height,mobile=false){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await call('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:1});}
const view = "document.querySelector('.sign-scene-3d-viewport')";
const snapshot = `(()=>{const h=${view};return {zoom:h.dataset.cameraZoom,target:h.dataset.cameraTarget,height:h.dataset.cameraViewHeight,placement:document.querySelector('[aria-label="Размещение в основном просмотре"]').value};})()`;
await fs.mkdir(new URL('../.impeccable/review/',import.meta.url),{recursive:true});
try {
  await call('Runtime.enable');await call('Page.enable');await size(1440,960);await call('Page.navigate',{url});
  await until("!!document.querySelector('[aria-label=\"Примерка · 3D\"]')");await click('Примерка · 3D');
  await until("!!document.querySelector('.facade-rc-start') && !document.querySelector('.facade-rc-start').disabled");
  await wait(1000);assert.equal(await evaluate("document.querySelectorAll('.sign-scene-3d canvas').length"),1,'One shared renderer');
  await screenshot('facade-rc-desktop');const before=await evaluate(snapshot);
  await click('Поиграть с машинкой');await until(`${view}?.dataset.rcActive==='true'`);
  await until("document.querySelector('.sign-scene-3d canvas').clientHeight >= innerHeight-2");
  assert.equal(await evaluate("document.querySelectorAll('.sign-scene-3d canvas').length"),1,'Fullscreen retains the same renderer');
  await screenshot('facade-rc-game');
  await click('На время');
  const point=await evaluate("(()=>{const r=document.querySelector('.sign-scene-3d canvas').getBoundingClientRect();return {x:r.x+r.width*.65,y:r.y+r.height*.58};})()");
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point,buttons:0});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await until("Number(document.querySelector('.facade-rc-speed strong').textContent) > .5");
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
  await click('Поставить заезд на паузу');const time=await evaluate("document.querySelector('.facade-rc-time strong').textContent");
  await wait(600);assert.equal(await evaluate("document.querySelector('.facade-rc-time strong').textContent"),time,'Pause stops timer');
  await click('Вернуть машинку на старт');assert.equal(await evaluate("document.querySelector('.facade-rc-speed strong').textContent"),'0.0');
  await click('Машинка');await wait(400);await screenshot('facade-rc-car');
  await click('К вывеске');await until(`${view}?.dataset.rcActive==='false' && !document.querySelector('main').classList.contains('is-rc-playing')`);await wait(250);assert.deepEqual(await evaluate(snapshot),before,'Exit restores exact view and placement');
  await click('Поиграть с машинкой');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(`${view}?.dataset.rcActive==='false'`);await wait(250);assert.deepEqual(await evaluate(snapshot),before,'Escape restores exact view');
  await click('Ночь');await wait(1400);await click('Поиграть с машинкой');await wait(500);await screenshot('facade-rc-night');
  await click('К вывеске');assert.equal(await evaluate("document.querySelector('.sign-scene-3d').classList.contains('night')"),true,'Exit retains night');
  await click('День');
  await size(390,844,true);await wait(500);await screenshot('facade-rc-mobile');await click('Поиграть с машинкой');await click('Свободно');await click('Площадка');
  await until("document.querySelector('.sign-scene-3d canvas').clientHeight >= innerHeight-2");
  const touch=await evaluate("(()=>{const r=document.querySelector('.sign-scene-3d canvas').getBoundingClientRect();return {x:r.x+r.width*.70,y:r.y+r.height*.60};})()");
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});await until("Number(document.querySelector('.facade-rc-speed strong').textContent) > .5");
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await click('Вернуть машинку на старт');await screenshot('facade-rc-mobile-game');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'No mobile page overflow');
  assert.equal(await evaluate("(()=>{const h=document.querySelector('.facade-rc-controls');return h.scrollWidth<=h.clientWidth;})()"),true,'HUD fits mobile scene');
  await click('Поставить заезд на паузу');await size(844,390,true);await wait(400);
  await click('К вывеске');await until(`${view}?.dataset.rcActive==='false'`);await wait(400);
  const projection = await evaluate(`(()=>{const h=${view};return {camera:Number(h.dataset.cameraViewWidth)/Number(h.dataset.cameraViewHeight),viewport:h.clientWidth/h.clientHeight};})()`);
  assert.ok(Math.abs(projection.camera-projection.viewport)<1e-7,`Exit after orientation change restores undistorted projection: ${JSON.stringify(projection)}`);
  await click('Конструктор · 2D');await until("!document.querySelector('.sign-scene-3d')");
  assert.equal(await evaluate("!!document.querySelector('.facade-rc-start')"),false,'Game unavailable in 2D');
  assert.deepEqual(errors,[],'No browser errors');
  console.log('PASS: same scene/canvas, full viewport, mouse/touch, pause/reset, cameras, exact exit/Escape view, resized exit, night retained and 2D cleanup');
}catch(error){console.error('Browser diagnostics:',JSON.stringify({errors,page:await evaluate('document.body.innerText')}));throw error;}
finally{await call('Page.close').catch(()=>{});ws.close();}
