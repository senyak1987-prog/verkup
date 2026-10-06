import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const source=fs.readFileSync(new URL('../src/lib/sceneLighting.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const lighting={};new Function('exports',compiled)(lighting);
const {sceneLightingAt,sceneLightingDuration,SCENE_LIGHTING_TIMING}=lighting;
const close=(value,expected)=>assert.ok(Math.abs(value-expected)<.000001,`${value} != ${expected}`);

const sceneSource=fs.readFileSync(new URL('../src/components/SignScene3D.tsx',import.meta.url),'utf8');
const shadowSource=sceneSource.slice(sceneSource.indexOf('export function pointShadowFrustum('),sceneSource.indexOf('\ntype SceneRuntime'));
const shadowCompiled=ts.transpileModule(shadowSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const shadowApi={};new Function('exports','THREE',shadowCompiled)(shadowApi,THREE);

test('Point shadow planes contain every caster and receiver at all daylight marker positions',()=>{
  for(const span of [100,550,2624,7800])for(const marker of [{x:.06,y:.94},{x:.5,y:.5},{x:.94,y:.06}]) {
    const bounds=new THREE.Box3(new THREE.Vector3(-span/2,-span*.35,-90),new THREE.Vector3(span/2,span*.35,80));
    const position=new THREE.Vector3((marker.x-.5)*span*4,(.5-marker.y)*span*4,span*2.8);
    const range=shadowApi.pointShadowFrustum(bounds,position);
    assert.ok(range.near>0&&range.far>range.near);
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const axisDepth=Math.max(Math.abs(x-position.x),Math.abs(y-position.y),Math.abs(z-position.z));
      assert.ok(axisDepth>range.near&&axisDepth<range.far,'Cube-face clipping must retain the entire physical scene');
    }
    assert.ok(range.bias<0&&Number.isFinite(range.bias));
  }
});

test('Tight cube depth improves precision for small letters on a wide sign without detaching their shadows',()=>{
  for(const span of [550,2624,7800]) {
    const bounds=new THREE.Box3(new THREE.Vector3(-span/2,-250,-15),new THREE.Vector3(span/2,250,60));
    const position=new THREE.Vector3(-span*1.28,span*1.2,span*2.8);
    const range=shadowApi.pointShadowFrustum(bounds,position),axisDepth=position.z;
    const derivative=(near,far,z)=>near*far/((far-near)*z*z);
    const previousNear=span*.005,previousFar=position.length()+span*3;
    const oldPrecision=1/(2**24*derivative(previousNear,previousFar,axisDepth));
    const precision=1/(2**24*derivative(range.near,range.far,axisDepth));
    assert.ok(oldPrecision/precision>100,'The near plane must not waste almost all perspective precision near the light');
    assert.ok(precision<.01,'Even a small 80 mm second row retains submillimetre depth precision');
    const farthest=Math.max(...['x','y','z'].flatMap(axis=>[Math.abs(position[axis]-bounds.min[axis]),Math.abs(position[axis]-bounds.max[axis])]));
    close(-range.bias/derivative(range.near,range.far,farthest),.35);
  }
});

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
