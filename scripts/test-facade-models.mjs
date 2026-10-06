import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

function load(name, dependencies = {}) {
  const source = fs.readFileSync(new URL('../src/lib/' + name + '.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, id => {
    assert.ok(id in dependencies, 'Unknown facade dependency: ' + id);
    return dependencies[id];
  });
  return exports;
}

const panelMount = load('panelConstruction');
const facade = load('signFacade', { './panelConstruction': panelMount });
const scene = load('signFacade3D', { three: THREE, './signFacade': facade, './panelConstruction': panelMount });
const places = facade.SIGN_PLACEMENTS.filter(place => place.id !== 'none');
const dimensions = [[600, 180], [1800, 300], [5000, 300], [1200, 800]];
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .01, `${message}: ${actual} != ${expected}`);

function dispose(model) {
  const geometries = new Set(), materials = new Set();
  model.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) materials.add(child.material); });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose());
}

function bounds(mesh) {
  mesh.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(mesh);
}

function signSvgTag(svg) {
  const tag = svg.match(/<svg\b[^>]*\bdata-facade-sign="true"[^>]*>/)?.[0];
  assert.ok(tag, 'The sign must remain a separate SVG viewport with physical dimensions');
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
}

test('All facade palettes retain detailed architecture and one physical SVG coordinate system', () => {
  assert.equal(scene.createFacadeModel('none', 1800, 300).children.length, 0);
  assert.equal(facade.createFacadeSvg('none', '<svg/>', false), '<svg/>');
  for (const { id: palette } of facade.FACADE_PALETTES) for (const place of places) for (const night of [false, true]) {
    const rects = facade.facadeRects(place.id, night, { palette });
    const svg = facade.createFacadeSvg(place.id, '<svg viewBox="0 0 1800 300"><path id="sign" d="M0 0H1800V300H0Z"/></svg>', night,
      'audit-' + palette + '-' + place.id, { palette, signBox: { x: 0, y: 0, width: 1800, height: 300 } });
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    assert.match(svg, /data-facade-mm="true"/);
    assert.match(svg, /viewBox="0 0 7800 4050"/);
    assert.match(svg, new RegExp('id="audit-' + palette + '-' + place.id + '-sign"'));
    assert.ok(rects.some(r => r.kind === 'foliage'), 'Planting must be present');
    assert.ok(rects.some(r => r.kind === 'lamp'), 'Architectural lamps must be present');
    assert.ok(rects.some(r => r.name === 'entrance-threshold'), 'Every composition needs a real entrance threshold');
    const model = scene.createFacadeModel(place.id, 1800, 300, { palette });
    assert.equal(model.children.length, rects.length);
    assert.ok(model.getObjectByName('facade-wall').receiveShadow);
    dispose(model);
  }
});

test('The standard 1100 by 2100 mm door and the building never scale with the sign', () => {
  for (const place of places) {
    const rects = facade.facadeRects(place.id, false);
    const door = rects.find(r => r.name === 'door-opening');
    assert.ok(door, place.id + ': a door gives the viewer a physical reference');
    assert.equal(door.w, 1100); assert.equal(door.h, 2100);
    assert.equal(door.y + door.h, 3540, 'The door meets the upper landing');
    const wall = rects.find(r => r.kind === 'wall');
    assert.equal(wall.w, 7800); assert.equal(wall.h, 3990);
    let reference;
    for (const [width, height] of dimensions) {
      const model = scene.createFacadeModel(place.id, width, height, { signBackMm: 50 });
      model.updateMatrixWorld(true);
      const openingSize = bounds(model.getObjectByName('facade-door-opening')).getSize(new THREE.Vector3());
      close(openingSize.x, 1100, 'Door width in 3D'); close(openingSize.y, 2100, 'Door height in 3D');
      const wallSize = bounds(model.getObjectByName('facade-wall')).getSize(new THREE.Vector3());
      close(wallSize.x, 7800, 'Building width in 3D'); close(wallSize.y, 3990, 'Building height in 3D');
      const architecture = model.children.map(mesh => ({ name: mesh.name, size: bounds(mesh).getSize(new THREE.Vector3()).toArray(), position: mesh.position.toArray() }));
      if (reference) assert.deepEqual(architecture, reference, 'Changing the sign must not resize or move architectural features');
      else reference = architecture;
      dispose(model);
    }
  }
});

test('SVG signs keep their actual millimetre size and share the 3D mounting origin', () => {
  const anchor = facade.FACADE_SIGN_ANCHOR;
  assert.deepEqual(anchor, { x: 3900, y: 800 });
  for (const place of places) for (const [width, height] of dimensions) {
    const markup = `<svg width="999" height="999" viewBox="0 0 ${width} ${height}"><path d="M0 0H${width}V${height}H0Z"/></svg>`;
    const svg = facade.createFacadeSvg(place.id, markup, false, 'physical-size', { signBox: { x: 0, y: 0, width, height } });
    const tag = signSvgTag(svg);
    close(Number(tag.x), anchor.x - width / 2, 'SVG sign left');
    close(Number(tag.y), anchor.y - height / 2, 'SVG sign top');
    close(Number(tag.width), width, 'SVG sign width');
    close(Number(tag.height), height, 'SVG sign height');
    close(Number(tag['data-sign-width']), width, 'Reported sign width');
    close(Number(tag['data-sign-height']), height, 'Reported sign height');
    const rects = facade.facadeRects(place.id, false);
    const door = rects.find(r => r.name === 'door-opening');
    const model = scene.createFacadeModel(place.id, width, height, { signBackMm: 50 });
    const doorBox = bounds(model.getObjectByName('facade-door-opening'));
    close(doorBox.min.x, door.x - anchor.x, 'SVG and 3D door left');
    close(doorBox.max.y, anchor.y - door.y, 'SVG and 3D door top');
    close(Number(tag.width) / door.w, width / doorBox.getSize(new THREE.Vector3()).x, 'Sign to door width proportion');
    dispose(model);
  }
});

test('The SVG preserves editor and dimension margins without changing the construction scale', () => {
  const width = 1800, height = 300;
  const markup = '<svg viewBox="-150 -100 2100 600"><path id="face" d="M0 0H1800V300H0Z"/><path id="dimension" d="M0 450H1800"/></svg>';
  const tag = signSvgTag(facade.createFacadeSvg('entrance', markup, false, 'margins', { signBox: { x: 0, y: 0, width, height } }));
  close(Number(tag.width), 2100, 'One SVG unit remains one millimetre including the margin');
  close(Number(tag.height), 600, 'SVG dimension annotation area');
  close(Number(tag.x), 3900 - width / 2 - 150, 'The actual sign rather than the padded SVG is centred');
  close(Number(tag.y), 800 - height / 2 - 100, 'The actual sign rather than the padded SVG is centred vertically');
  assert.equal(tag.viewBox, '-150 -100 2100 600');
});

test('Windows have true apertures, restrained reflections and separated glazing at every sign size', () => {
  const anchor = facade.FACADE_SIGN_ANCHOR;
  for (const { id: palette } of facade.FACADE_PALETTES) for (const place of places) for (const [width, height] of dimensions) {
    const rects = facade.facadeRects(place.id, false, { palette });
    const model = scene.createFacadeModel(place.id, width, height, { palette, signBackMm: 50 });
    model.updateMatrixWorld(true);
    const wall = model.getObjectByName('facade-wall'), wallRect = rects.find(r => r.kind === 'wall');
    const positions = wall.geometry.getAttribute('position'), depth = wall.geometry.parameters.options.depth;
    let faceArea = 0;
    for (let index = 0; index < positions.count; index += 3) {
      if (![0, 1, 2].every(offset => Math.abs(positions.getZ(index + offset) - depth) < .005)) continue;
      const a = new THREE.Vector3().fromBufferAttribute(positions, index);
      const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
      faceArea += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    const openings = rects.filter(r => r.kind === 'opening');
    const expectedArea = wallRect.w * wallRect.h - openings.reduce((sum, r) => sum + r.w * r.h, 0);
    assert.ok(Math.abs(faceArea - expectedArea) < expectedArea * .000001, 'Wall triangles must not fill any glazing aperture');
    for (const glass of rects.filter(r => r.kind === 'glass')) {
      const ray = new THREE.Raycaster(new THREE.Vector3(glass.x + glass.w * .3 - anchor.x,
        anchor.y - glass.y - glass.h * .25, 5000), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObjects(model.children, false)[0];
      assert.equal(hit?.object.userData.facadeKind, 'glass', place.id + ': glazing must be visible through the wall');
      assert.ok(hit.object.material.roughness >= .08 && hit.object.material.roughness <= .5
        && hit.object.material.envMapIntensity >= .2 && hit.object.material.envMapIntensity <= 1.25,
        'Glazing has readable reflections without becoming a perfect mirror');
      assert.ok(hit.object.material.userData.facadeEmission, 'Interior light is independent of the sign switch');
      const frame = model.children.find(child => child.name === hit.object.name.replace('-glass', '-frame'));
      assert.ok(frame && frame.userData.frontZ >= hit.object.userData.frontZ + 10, 'Window fronts have a real reveal, preventing coplanar shimmer');
    }
    for (const mesh of model.children) {
      const attr = mesh.geometry.getAttribute('position');
      for (let index = 0; index < attr.array.length; index++) assert.ok(Number.isFinite(attr.array[index]));
      assert.ok(mesh.position.toArray().every(Number.isFinite) && mesh.scale.toArray().every(Number.isFinite));
    }
    dispose(model);
  }
});

test('Facade glass has separate stable light identities and architecture casts real receiving shadows',()=>{
  const glassMeshes=model=>{const items=[];model.traverse(child=>{if(child.userData.facadeKind==='glass')items.push(child);});return items;};
  for(const {id:palette} of facade.FACADE_PALETTES)for(const place of places)for(const mode of ['wall','corner','corner-front','corner-side']) {
    const pose=panelMount.panelMountLayout(550,'circle',120,60,160,mode);
    const model=scene.createFacadeModel(place.id,550,550,{palette,panelMount:pose}),glass=glassMeshes(model);
    assert.ok(glass.length>=3,'The facade includes multiple independently lit window/door panes');
    assert.equal(new Set(glass.map(mesh=>mesh.material)).size,glass.length,'One shared glass material cannot independently animate different windows');
    const indexes=glass.map(mesh=>mesh.material.userData.windowIndex);
    assert.ok(indexes.every(Number.isInteger),'Every pane has a stable numeric light identity');
    assert.deepEqual([...indexes].sort((a,b)=>a-b),Array.from({length:glass.length},(_,i)=>i),'The return wall continues the window sequence without duplicate identities');
    for(const mesh of glass) {
      const material=mesh.material;
      assert.ok(material.isMeshPhysicalMaterial,'Glass uses a physical dielectric material');
      assert.ok(material.roughness>=.08&&material.roughness<=.5,'Window reflections stay softer than a mirror');
      assert.equal(material.metalness,0,'Architectural glass remains a dielectric surface');
      assert.ok(material.envMapIntensity>=.2&&material.envMapIntensity<=1.25,'Scene reflections are present but restrained');
      assert.ok(material.userData.windowLight&&material.userData.facadeEmission,'The window light is separated from the sign lighting switch');
      assert.ok(material.userData.maxEmission>0,'Each window has a visible interior light level');
      assert.ok(mesh.receiveShadow&&!mesh.castShadow,'Glass receives architectural shade without casting an opaque pane shadow');
    }
    model.traverse(mesh=>{
      if(!mesh.geometry)return;
      if(mesh.userData.facadeKind==='wall')assert.ok(mesh.castShadow&&mesh.receiveShadow,'Masonry participates in real facade shadowing');
      if(mesh.name==='facade-canopy-roof'||mesh.name.startsWith('facade-canopy-column-')||mesh.name.startsWith('facade-entrance-step-')||mesh.name.endsWith('-frame'))
        assert.ok(mesh.castShadow&&mesh.receiveShadow,mesh.name+' casts and receives physical shadows');
      if(mesh.userData.facadeKind==='opening')assert.ok(!mesh.castShadow,'Opening backing cannot become an opaque occluder in front of glass');
    });
    const rebuilt=scene.createFacadeModel(place.id,1800,300,{palette,panelMount:pose});
    assert.deepEqual(glassMeshes(rebuilt).map(mesh=>[mesh.name,mesh.material.userData.windowIndex]),glass.map(mesh=>[mesh.name,mesh.material.userData.windowIndex]),'Light identities persist when the sign changes');
    dispose(model);dispose(rebuilt);
  }
});

test('SVG windows retain independent warm interiors and reflections with matching 3D light indices',()=>{
  const marker=(markup,name)=>[...markup.matchAll(new RegExp('<g\\b[^>]*data-'+name+'="true"[^>]*>','g'))].map(match=>{
    const attrs=Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(item=>[item[1],item[2]]));
    return attrs;
  });
  for(const place of places)for(const mode of ['wall','corner','corner-front','corner-side']) {
    const pose=panelMount.panelMountLayout(550,'circle',120,60,160,mode),options={panelMount:pose,signBox:{x:0,y:0,width:550,height:550}};
    const model=scene.createFacadeModel(place.id,550,550,options),indexes=[];
    model.traverse(child=>{if(child.userData.facadeKind==='glass')indexes.push(child.material.userData.windowIndex);});
    for(const [night,on,level] of [[false,true,1],[true,false,1],[true,true,.4],[true,true,1]]) {
      const markup=facade.createFacadeSvg(place.id,'<svg viewBox="0 0 550 550"/>',night,'windows-audit',{...options,windowLights:on,windowLightLevel:level});
      const lights=marker(markup,'window-light'),reflections=marker(markup,'window-reflection');
      assert.equal(lights.length,indexes.length,'Every glazed opening has an independent interior group');
      assert.deepEqual(lights.map(item=>Number(item['data-window-index'])).sort((a,b)=>a-b),[...indexes].sort((a,b)=>a-b));
      assert.deepEqual(reflections.map(item=>Number(item['data-window-index'])).sort((a,b)=>a-b),[...indexes].sort((a,b)=>a-b),'Reflections persist independently of interior light');
      for(const light of lights)assert.ok(Math.abs(Number(light.opacity)-(night&&on?level:0))<.001,'Warm interior level follows the window control rather than only a palette change');
      const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
      assert.equal(new Set(ids).size,ids.length,'Corner facade clipping and reflection definitions have no duplicate IDs');
      assert.doesNotMatch(markup,/NaN|Infinity|undefined/);
    }
    dispose(model);
  }
});

test('The entrance canopy projects 1500 mm with structural columns and three 150 mm risers', () => {
  for (const { id: palette } of facade.FACADE_PALETTES) for (const [width, height] of dimensions) {
    const rects = facade.facadeRects('canopy', false, { palette });
    const roof = rects.find(r => r.name === 'canopy-roof'), fascia = rects.find(r => r.name === 'canopy-fascia');
    const wall = rects.find(r => r.kind === 'wall');
    assert.equal(roof.depth, 1500); assert.equal(roof.z - wall.z, 1500);
    assert.equal(roof.w, 3500); assert.equal(roof.h, 180);
    assert.equal(fascia.h, 150, 'The front edge remains a thin canopy rather than a tall wall frieze');
    const model = scene.createFacadeModel('canopy', width, height, { palette, signBackMm: 100 });
    model.updateMatrixWorld(true);
    const roofMesh = model.getObjectByName('facade-canopy-roof'), wallMesh = model.getObjectByName('facade-wall');
    const roofBox = bounds(roofMesh);
    close(roofBox.getSize(new THREE.Vector3()).z, 1500, 'Roof projection in 3D');
    close(roofBox.max.z - wallMesh.userData.frontZ, 1500, 'Roof front stands 1500 mm from the wall');
    close(roofBox.min.z, wallMesh.userData.frontZ, 'Roof meets the wall');
    for (const side of ['left', 'right']) {
      const column = rects.find(r => r.name === 'canopy-column-' + side);
      assert.ok(column, 'Canopy has a ' + side + ' structural column');
      assert.equal(column.w, 80); assert.equal(column.h, 2660); assert.equal(column.depth, 80);
      assert.equal(column.y + column.h, 3990, 'Columns reach the ground');
      assert.equal(column.y, roof.y + roof.h, 'Column tops meet the underside of the canopy');
      const box = bounds(model.getObjectByName('facade-canopy-column-' + side));
      close(box.getSize(new THREE.Vector3()).x, 80, 'Column width in 3D');
      close(box.getSize(new THREE.Vector3()).y, 2660, 'Column height in 3D');
      assert.ok(box.max.z < roofBox.max.z && box.min.z > roofBox.min.z, 'Posts stand under the projecting roof');
    }
    const steps = [1, 2, 3].map(index => rects.find(r => r.name === 'entrance-step-' + index));
    assert.ok(steps.every(Boolean), 'The elevated entrance needs all three steps');
    for (const [index, step] of steps.entries()) {
      assert.equal(step.h, 150); assert.equal(step.y, 3540 + index * 150);
      const box = bounds(model.getObjectByName('facade-entrance-step-' + (index + 1)));
      close(box.getSize(new THREE.Vector3()).y, 150, 'Step riser in 3D');
      if (index) close(step.z - steps[index - 1].z, 300, 'Step tread depth');
    }
    assert.equal(steps.at(-1).y + steps.at(-1).h, 3990, 'The last riser meets the ground');
    dispose(model);
  }
});

test('Letters up to 550 mm stay above the canopy roof, with no architectural rescaling', () => {
  for (const { id: palette } of facade.FACADE_PALETTES) for (const [width, height] of [[600, 180], [1800, 300], [5000, 550]]) {
    const rects = facade.facadeRects('canopy', false, { palette });
    const roof = rects.find(r => r.name === 'canopy-roof');
    const signBottom = facade.FACADE_SIGN_ANCHOR.y + height / 2;
    assert.ok(signBottom < roof.y, 'The letters and canopy roof need separate physical vertical positions');
    const model = scene.createFacadeModel('canopy', width, height, { palette, signBackMm: 100 });
    model.updateMatrixWorld(true);
    for (const [x, y] of [[-width / 2 + 10, 0], [0, -height / 2 + 10], [width / 2 - 10, height / 2 - 10]]) {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, y, 5000), new THREE.Vector3(0, 0, -1)).intersectObjects(model.children, false);
      assert.ok(hits.every(hit => hit.object.name !== 'facade-canopy-roof' && !hit.object.name.startsWith('facade-canopy-column')), 'The roof and columns cannot occlude the letter area');
    }
    assert.equal(model.userData.signMountZ, -104, 'Actual sign depth still determines the mounting surface');
    dispose(model);
  }
});
