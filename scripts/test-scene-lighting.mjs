import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/lib/sceneLighting.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const lighting={};new Function('exports',compiled)(lighting);
const {sceneLightingAt,sceneLightingDuration,SCENE_LIGHTING_TIMING}=lighting;
const close=(value,expected)=>assert.ok(Math.abs(value-expected)<.000001,`${value} != ${expected}`);

test('The scene reaches night before the warm window lights fade in',()=>{
  const from={night:0,windows:0};
  assert.deepEqual(sceneLightingAt(from,true,0),from);
  const halfway=sceneLightingAt(from,true,SCENE_LIGHTING_TIMING.sceneMs/2);
  close(halfway.night,.5);close(halfway.windows,0);
  const dark=sceneLightingAt(from,true,SCENE_LIGHTING_TIMING.sceneMs);
  assert.deepEqual(dark,{night:1,windows:0});
  assert.ok(SCENE_LIGHTING_TIMING.windowsDelayMs>SCENE_LIGHTING_TIMING.sceneMs,'Interior lighting waits until the ambient transition has completed');
  assert.deepEqual(sceneLightingAt(from,true,SCENE_LIGHTING_TIMING.windowsDelayMs),{night:1,windows:0});
  const warming=sceneLightingAt(from,true,SCENE_LIGHTING_TIMING.windowsDelayMs+SCENE_LIGHTING_TIMING.windowsFadeMs/2);
  close(warming.night,1);close(warming.windows,.5);
  const duration=sceneLightingDuration(true);
  assert.equal(duration,SCENE_LIGHTING_TIMING.windowsDelayMs+SCENE_LIGHTING_TIMING.windowsFadeMs);
  assert.deepEqual(sceneLightingAt(from,true,duration),{night:1,windows:1});
});

test('Window interiors turn off before the scene completes its return to day',()=>{
  const from={night:1,windows:1};
  assert.deepEqual(sceneLightingAt(from,false,0),from);
  const halfway=sceneLightingAt(from,false,SCENE_LIGHTING_TIMING.windowsOffMs/2);
  close(halfway.windows,.5);
  assert.ok(halfway.night>.5,'The window lights fade while the exterior remains predominantly dark');
  const off=sceneLightingAt(from,false,SCENE_LIGHTING_TIMING.windowsOffMs);
  close(off.windows,0);assert.ok(off.night>0);
  assert.equal(sceneLightingDuration(false),SCENE_LIGHTING_TIMING.sceneMs);
  assert.deepEqual(sceneLightingAt(from,false,sceneLightingDuration(false)),{night:0,windows:0});
});

test('Interrupted day/night transitions continue from both current light levels without a jump',()=>{
  const interrupted=sceneLightingAt({night:0,windows:0},true,SCENE_LIGHTING_TIMING.windowsDelayMs+SCENE_LIGHTING_TIMING.windowsFadeMs*.35);
  assert.ok(interrupted.windows>0&&interrupted.windows<1);
  assert.deepEqual(sceneLightingAt(interrupted,false,0),interrupted,'Reversing direction preserves the displayed frame');
  const reversing=sceneLightingAt(interrupted,false,SCENE_LIGHTING_TIMING.windowsOffMs*.3);
  assert.ok(reversing.windows<interrupted.windows&&reversing.windows>0);
  assert.deepEqual(sceneLightingAt(reversing,true,0),reversing,'A second reversal preserves the current window illumination too');
  const waiting=sceneLightingAt(reversing,true,SCENE_LIGHTING_TIMING.windowsDelayMs);
  close(waiting.windows,reversing.windows);
  assert.deepEqual(sceneLightingAt(reversing,true,sceneLightingDuration(true)),{night:1,windows:1});
});

test('Lighting remains bounded, monotonic and settled before or after its animation interval',()=>{
  for(const target of [false,true]) {
    const from={night:.3,windows:.7};
    assert.deepEqual(sceneLightingAt(from,target,-100),from);
    let previous=from;
    for(let elapsed=0;elapsed<=sceneLightingDuration(target)+100;elapsed+=25) {
      const state=sceneLightingAt(from,target,elapsed);
      for(const key of ['night','windows']) {
        assert.ok(Number.isFinite(state[key])&&state[key]>=0&&state[key]<=1);
        assert.ok(target?state[key]>=previous[key]-.000001:state[key]<=previous[key]+.000001,'The transition does not flicker or reverse its light level');
      }
      previous=state;
    }
    const endpoint=target?1:0;
    assert.deepEqual(sceneLightingAt(from,target,10000),{night:endpoint,windows:endpoint});
  }
});

test('Reduced-motion preference immediately settles both exterior and interior light levels',()=>{
  for(const target of [false,true]) {
    const endpoint=target?1:0;
    assert.equal(sceneLightingDuration(target,true),0);
    assert.deepEqual(sceneLightingAt({night:.4,windows:.6},target,0,true),{night:endpoint,windows:endpoint});
  }
});
