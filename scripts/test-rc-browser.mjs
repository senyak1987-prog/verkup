import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';

// Optional real-browser acceptance test. Start Vite and a separate Chrome with
// --remote-debugging-port=9334 first. Never connects to the user's browser profile.
const cdp = process.env.RC_CDP_URL || 'http://127.0.0.1:9334';
const url = process.env.RC_GAME_URL || 'http://127.0.0.1:5174/verkup/rc-playground/';
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (message.error) request?.reject(message.error); else request?.resolve(message.result);
    pending.delete(message.id);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`${message.params.response.status} ${message.params.response.url}`);
};
function call(method, params = {}) {
  const next = ++id;
  return new Promise((resolve, reject) => { pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await wait(120); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(text) {
  const result = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) return false; button.click(); return true; })()`);
  assert.equal(result, true, `Button ${text} must work`);
}
async function screenshot(name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(new URL(`../.impeccable/review/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}
async function size(width, height, mobile = false) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
}
async function noOverflow() {
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'No horizontal overflow');
  assert.equal(await evaluate('document.documentElement.scrollHeight <= innerHeight + 2'), true, 'Game fits viewport vertically');
}
await fs.mkdir(new URL('../.impeccable/review/', import.meta.url), { recursive: true });
try {
  await call('Runtime.enable'); await call('Network.enable'); await call('Page.enable');
  await size(1440, 960); await call('Page.navigate', { url });
  await until("!!document.querySelector('canvas') && !document.querySelector('.rc-stage-message') && document.querySelector('.rc-mode-selector button')?.disabled === false");
  await wait(1200); await noOverflow(); await screenshot('rc-game-desktop');
  assert.equal(await evaluate("[...document.images].every(i => i.complete && i.naturalWidth > 0)"), true, 'Brand images load under deployment base');
  await click('На время');
  await evaluate("window.rcTestInputs=[]; ['pointerdown','pointermove','pointerup','lostpointercapture','blur','mouseup','mousedown'].forEach(t=>document.querySelector('canvas').addEventListener(t,e=>window.rcTestInputs.push({t,buttons:e.buttons,button:e.button,id:e.pointerId})))");
  // Drive a real lap by projecting the six world-space checkpoints into the canvas.
  const rect = await evaluate("(() => { const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
  const camera = new THREE.PerspectiveCamera(36, rect.width / rect.height, .1, 150);
  const scale = Math.max(.98, 1.08 / camera.aspect);
  camera.position.set(14 * scale, 17 * scale, 20 * scale); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const checkpoints = [[6,3.6],[6,-4],[0,-5.5],[-6,-3],[-6,3.6],[0,3.6]];
  for (let i = 0; i < checkpoints.length; i++) {
    const [x,z] = checkpoints[i]; const p = new THREE.Vector3(x,0,z).project(camera);
    const screen = { x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2 };
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...screen, button: i ? 'left' : 'none', buttons: i ? 1 : 0 });
    if (i === 0) await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...screen, button: 'left', buttons: 1, clickCount: 1 });
    await until(i === 5 ? "!!document.querySelector('.rc-laps')" : `Number(document.querySelector('.rc-checkpoints strong').firstChild.textContent.trim()) === ${i+1}`, 35000);
    console.log(`Checkpoint ${i+1}/6 reached by mouse`);
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x+rect.width/2, y:rect.y+rect.height/2, button:'left', buttons:0, clickCount:1 });
  assert.ok(await evaluate("!!document.querySelector('.rc-best')"), 'Lap saves a local best time');
  await click('Пауза'); const time = await evaluate("document.querySelector('.rc-timer strong').textContent");
  await wait(500); assert.equal(await evaluate("document.querySelector('.rc-timer strong').textContent"), time, 'Pause freezes trial timer');
  await click('Детали'); await wait(250);
  await click('На старт');
  assert.equal(await evaluate("document.querySelector('.rc-speed strong').textContent"), '0.0', 'Reset removes momentum');
  await wait(300); await screenshot('rc-game-detail');
  await click('Свободный заезд');
  await size(390, 844, true); await click('Полигон'); await wait(800); await noOverflow(); await screenshot('rc-game-mobile');
  await size(360, 740, true); await wait(350); await noOverflow();
  const touchRect = await evaluate("(() => { const r=document.querySelector('canvas').getBoundingClientRect(); return {x:r.x+r.width*.72,y:r.y+r.height*.6}; })()");
  await call('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[touchRect]}); await wait(800);
  assert.ok(Number(await evaluate("document.querySelector('.rc-speed strong').textContent")) > .5, 'Touch drives the car');
  await call('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await size(900, 600); await call('Page.navigate', {url: `${url}?embed=1`});
  await until("!!document.querySelector('canvas') && !document.querySelector('.rc-stage-message')"); await wait(600);
  assert.equal(await evaluate("!!document.querySelector('.rc-header')"), false, 'Embed hides the page header');
  await noOverflow(); await screenshot('rc-game-embed');
  assert.deepEqual(errors, [], 'No browser exceptions or missing assets');
  console.log('PASS: mouse lap, persistence, pause, reset, cameras, mobile touch, embed and browser assets');
} catch (error) {
  console.error('Browser diagnostics:', JSON.stringify({ errors, page: await evaluate('document.body.innerText'), inputs: await evaluate('window.rcTestInputs') }));
  throw error;
} finally {
  await call('Page.close').catch(() => {}); ws.close();
}
