import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RC_WORDMARK_PATHS } from './brandWordmark';

export interface TrxMaterials {
  body: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  silver: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  spring: THREE.MeshStandardMaterial;
}

/** The RC truck uses the existing chassis-local +Z forward and independent suspension. */
export const TRX_ANTENNA_MOUNT = { x: -.17, y: .64, z: -.20 };

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
  x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.set(x, y, z);
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent: THREE.Object3D, name: string, w: number, h: number, d: number,
  material: THREE.Material, x = 0, y = 0, z = 0, radius = .008) {
  return mesh(parent, name, new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, x, y, z);
}

function polySide(parent: THREE.Object3D, name: string, points: Array<[number, number]>,
  material: THREE.Material, x: number, thickness = .012) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y));
  shape.closePath();
  const object = mesh(parent, name, new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: false, curveSegments: 10,
  }), material, x);
  object.rotation.y = -Math.PI / 2;
  return object;
}

function textureMaterial(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: .42,
    metalness: .02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** Original outlined wordmark; no substitute symbol or platform font. */
export function brandLivery() {
  const canvas = document.createElement('canvas');
  canvas.width = 1536; canvas.height = 384;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#102c23';
  context.beginPath(); context.roundRect(4, 4, 1528, 376, 26); context.fill();
  context.save(); context.translate(72, 52); context.scale(1392 / 420, 1392 / 420);
  context.beginPath(); context.rect(0, 0, 420, 84); context.clip();
  for (const path of RC_WORDMARK_PATHS) {
    context.fillStyle = path.fill;
    if (typeof Path2D !== 'undefined') context.fill(new Path2D(path.d));
  }
  context.restore();
  const material=textureMaterial(canvas);
  material.name='rc-official-gorod-svet-wordmark';
  material.userData.source='public/gorod-svet-wordmark.svg';
  material.alphaTest=.12; material.transparent=false; material.depthWrite=true; material.side=THREE.FrontSide;
  material.roughness=.65; material.metalness=0;
  material.polygonOffsetFactor=-4; material.polygonOffsetUnits=-4;
  return material;
}

function ramGrilleBadge() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#cbd5cf'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '900 106px Arial Black, Arial, sans-serif'; context.fillText('RAM', 256, 70);
  return textureMaterial(canvas);
}

/** A crew-cab, wide-body pickup with an open bed, sculpted wheel openings and TRX-style hood. */
export function createTrxTruck(materials: TrxMaterials): { chassis: THREE.Group } {
  const chassis = new THREE.Group(); chassis.name = 'rc-chassis';
  chassis.userData.vehicle = 'trx-inspired-pickup';
  chassis.userData.brand = 'Город Свет';
  chassis.userData.forward = '+Z';
  const { body, dark, silver, window } = materials;
  const led = new THREE.MeshStandardMaterial({ color: '#f4fff1', emissive: '#dcffe1', emissiveIntensity: .28, roughness: .25 });
  const amber = new THREE.MeshStandardMaterial({ color: '#ffaa29', emissive: '#ff9223', emissiveIntensity: .3, roughness: .3 });
  const tail = new THREE.MeshStandardMaterial({ color: '#ef3b32', emissive: '#e52015', emissiveIntensity: .23, roughness: .3 });
  const livery = brandLivery();

  box(chassis, 'rc-trx-frame', .74, .09, 1.66, dark, 0, -.145, -.02);
  box(chassis, 'rc-trx-floor', .83, .09, .92, body, 0, -.045, -.02, .028);
  // The side panels have real wheel cut-outs instead of boxes intersecting the tyres.
  const sideShape = new THREE.Shape();
  const bottom = -.175, centreY = -.29, radius = .34;
  const angle = Math.asin((bottom - centreY) / radius);
  const half = Math.cos(angle) * radius;
  sideShape.moveTo(-.95, bottom);
  for (const wheelZ of [-.44, .44]) {
    sideShape.lineTo(wheelZ - half, bottom);
    sideShape.absarc(wheelZ, centreY, radius, Math.PI - angle, angle, true);
  }
  sideShape.lineTo(.93, bottom); sideShape.lineTo(.93, .145);
  sideShape.lineTo(.78, .215); sideShape.lineTo(.32, .22);
  sideShape.lineTo(-.35, .195); sideShape.lineTo(-.95, .175); sideShape.closePath();
  const sideGeometry = new THREE.ExtrudeGeometry(sideShape, { depth: .032, bevelEnabled: false, curveSegments: 18 });
  for (const side of [-1, 1]) {
    const panel = mesh(chassis, `rc-trx-body-side-${side}`, sideGeometry, body, side > 0 ? .49 : -.458);
    panel.rotation.y = -Math.PI / 2;
    for (const wheelZ of [-.44, .44]) {
      const flare = mesh(chassis, `rc-trx-wide-fender-${side}-${wheelZ}`,
        new THREE.TorusGeometry(.325, .04, 6, 26, Math.PI), dark, side * .535, -.28, wheelZ);
      flare.rotation.y = Math.PI / 2;
      for (const offset of [-.17, 0, .17]) {
        mesh(chassis, 'rc-trx-fender-rivet', new THREE.SphereGeometry(.009, 6, 4), silver,
          side * .578, -.28 + Math.sqrt(.325 ** 2 - offset ** 2), wheelZ + offset);
      }
    }
    box(chassis, 'rc-trx-running-board', .13, .035, .64, dark, side * .51, -.105, -.005);
    box(chassis, 'rc-trx-running-board-edge', .018, .012, .58, silver, side * .563, -.083, -.005, .002);
  }

  // Pickup hood: broad shoulders, a raised centre and the intake facing forward.
  box(chassis, 'rc-trx-hood', .86, .07, .54, body, 0, .195, .585, .022);
  box(chassis, 'rc-trx-hood-centre', .42, .035, .44, body, 0, .244, .525, .013);
  box(chassis, 'rc-trx-hood-scoop', .36, .075, .22, dark, 0, .293, .421, .019);
  box(chassis, 'rc-trx-hood-scoop-inlet', .29, .038, .018, window, 0, .294, .54, .003);
  for (const side of [-1, 1]) {
    box(chassis, 'rc-trx-hood-vent', .09, .009, .17, dark, side * .29, .234, .49, .002);
    for (let i = 0; i < 4; i++) box(chassis, 'rc-trx-hood-vent-louvre', .078, .009, .01,
      body, side * .29, .243, .433 + i * .037, .001);
  }

  // Sloped front and rear pillars make the cab a recognisable pickup silhouette.
  for (const side of [-1, 1]) {
    const outerX = side > 0 ? .421 : -.403;
    polySide(chassis, `rc-trx-crew-cab-${side}`, [[-.37, .14], [-.32, .58], [.095, .58], [.355, .205]], body, outerX, .018);
    const glassX = side > 0 ? .427 : -.421;
    polySide(chassis, 'rc-trx-rear-door-window', [[-.292, .535], [-.121, .535], [-.121, .305], [-.312, .305]], window, glassX, .008);
    polySide(chassis, 'rc-trx-front-door-window', [[-.082, .535], [.075, .535], [.255, .306], [-.082, .306]], window, glassX, .008);
    box(chassis, 'rc-trx-window-b-pillar', .023, .249, .025, dark, side * .431, .421, -.102, .003);
    // Door seams, two handles and the lower crease remain visible below the livery.
    for (const z of [-.328, -.10, .288]) box(chassis, 'rc-trx-door-seam', .009, .125, .009, dark, side * .492, .103, z, .001);
    for (const z of [-.246, .036]) box(chassis, 'rc-trx-door-handle', .016, .024, .072, dark, side * .493, .229, z, .004);
    box(chassis, 'rc-trx-door-crease', .013, .012, .56, dark, side * .496, .009, -.019, .001);
    box(chassis, 'rc-trx-mirror-arm', .08, .021, .026, dark, side * .457, .36, .23, .004);
    box(chassis, 'rc-trx-mirror', .082, .076, .12, dark, side * .516, .373, .238, .012);
    box(chassis, 'rc-trx-mirror-glass', .067, .054, .009, silver, side * .517, .377, .174, .003);
    const doorLogo = mesh(chassis, `rc-trx-gorod-svet-door-logo-${side}`, new THREE.PlaneGeometry(.48, .16), livery,
      side * .493, .118, -.032);
    doorLogo.rotation.y = side * Math.PI / 2; doorLogo.castShadow = doorLogo.receiveShadow = false;
  }
  box(chassis, 'rc-trx-roof', .82, .043, .465, body, 0, .585, -.111, .019);
  box(chassis, 'rc-trx-roof-inset', .57, .012, .30, dark, 0, .614, -.106, .015);
  const windscreen = mesh(chassis, 'rc-trx-front-windscreen', new THREE.PlaneGeometry(.722, .364), window, 0, .422, .217);
  windscreen.rotation.x = -.60;
  const rearGlass = mesh(chassis, 'rc-trx-rear-windscreen', new THREE.PlaneGeometry(.712, .231), window, 0, .425, -.343);
  rearGlass.rotation.set(.11, Math.PI, 0);
  box(chassis, 'rc-trx-windscreen-divider', .009, .19, .013, dark, 0, .425, -.362, .002);
  for (const side of [-1, 1]) box(chassis, 'rc-trx-windscreen-wiper', .235, .009, .015, dark, side * .195, .279, .322, .002);
  for (const x of [-.17, 0, .17]) box(chassis, 'rc-trx-roof-marker', .032, .018, .042, amber, x, .615, .067, .004);

  // The bed is genuinely open: a ribbed dark liner, side rails and a separate tailgate.
  box(chassis, 'rc-trx-bed-liner', .82, .027, .54, dark, 0, .001, -.642, .003);
  for (let i = 0; i < 9; i++) box(chassis, 'rc-trx-bed-rib', .018, .012, .486, dark, -.32 + i * .08, .019, -.644, .002);
  for (const side of [-1, 1]) {
    box(chassis, 'rc-trx-bed-side', .065, .182, .55, body, side * .43, .097, -.65, .014);
    box(chassis, 'rc-trx-bed-rail', .078, .024, .557, dark, side * .432, .197, -.65, .006);
    box(chassis, 'rc-trx-bed-wheel-well', .11, .081, .28, dark, side * .355, .05, -.46, .014);
  }
  box(chassis, 'rc-trx-tailgate', .87, .216, .065, body, 0, .077, -.931, .016);
  box(chassis, 'rc-trx-tailgate-rail', .87, .024, .073, dark, 0, .195, -.933, .004);
  box(chassis, 'rc-trx-tailgate-handle', .16, .033, .018, dark, 0, .128, -.969, .005);
  for (const side of [-1, 1]) {
    box(chassis, 'rc-trx-tail-light-housing', .094, .174, .025, dark, side * .385, .064, -.974, .006);
    box(chassis, 'rc-trx-tail-light', .068, .144, .013, tail, side * .385, .067, -.99, .004);
    box(chassis, 'rc-trx-tail-light-reverse', .069, .022, .015, led, side * .385, .052, -.998, .001);
    box(chassis, 'rc-trx-exhaust', .084, .052, .12, silver, side * .345, -.16, -.925, .014);
  }
  const tailLogo = mesh(chassis, 'rc-trx-gorod-svet-tailgate-logo', new THREE.PlaneGeometry(.36, .12), livery, 0, .049, -.968);
  tailLogo.rotation.y = Math.PI; tailLogo.castShadow = tailLogo.receiveShadow = false;

  // Black grille, outlined LEDs and red recovery hooks instead of a featureless front box.
  box(chassis, 'rc-trx-grille-surround', .91, .213, .08, body, 0, .054, .894, .022);
  box(chassis, 'rc-trx-grille', .593, .17, .032, dark, 0, .053, .94, .017);
  for (let i = 0; i < 12; i++) box(chassis, 'rc-trx-grille-fin', .009, .134, .014, silver, -.257 + i * .047, .053, .960, .001);
  for (const y of [-.002, .043, .088]) box(chassis, 'rc-trx-grille-bar', .548, .008, .018, dark, 0, y, .973, .001);
  const ram = mesh(chassis, 'rc-trx-ram-grille-badge', new THREE.PlaneGeometry(.355, .092), ramGrilleBadge(), 0, .053, .985);
  ram.castShadow = ram.receiveShadow = false;
  for (const side of [-1, 1]) {
    const x = side * .386;
    box(chassis, 'rc-trx-headlight-housing', .163, .114, .036, dark, x, .073, .932, .012);
    box(chassis, 'rc-trx-headlight-upper', .134, .012, .018, led, x, .116, .954, .003);
    box(chassis, 'rc-trx-headlight-lower', .134, .012, .018, led, x, .029, .954, .003);
    box(chassis, 'rc-trx-headlight-outer', .012, .094, .018, led, x + side * .061, .073, .954, .003);
    box(chassis, 'rc-trx-headlight-projector', .081, .029, .021, silver, x, .073, .956, .007);
    box(chassis, 'rc-trx-front-side-marker', .016, .054, .024, amber, side * .475, .072, .88, .003);
  }
  box(chassis, 'rc-trx-front-bumper', 1.015, .118, .154, dark, 0, -.104, .881, .019);
  box(chassis, 'rc-trx-front-skid-plate', .525, .06, .135, silver, 0, -.165, .828, .009);
  box(chassis, 'rc-trx-rear-bumper', 1.01, .086, .121, dark, 0, -.131, -.931, .016);
  for (const side of [-1, 1]) {
    const hook = mesh(chassis, 'rc-trx-front-tow-hook', new THREE.TorusGeometry(.036, .011, 6, 12), tail,
      side * .295, -.1, .974);
    hook.scale.set(1, .72, 1);
    box(chassis, 'rc-trx-bumper-fog-light', .061, .019, .011, led, side * .42, -.073, .963, .003);
  }
  const hoodLogo = mesh(chassis, 'rc-trx-gorod-svet-hood-logo', new THREE.PlaneGeometry(.375, .125), livery, 0, .2635, .671);
  hoodLogo.rotation.x = -Math.PI / 2; hoodLogo.castShadow = hoodLogo.receiveShadow = false;
  return { chassis };
}

/** Rotates around local X inside the unchanged independent steering/suspension hub. */
export function createTrxWheel(materials: TrxMaterials): THREE.Group {
  const rotor = new THREE.Group(); rotor.name = 'rc-trx-wheel-rotor';
  const tire = mesh(rotor, 'rc-trx-offroad-tire', new THREE.CylinderGeometry(.174, .174, .174, 32), materials.tire);
  tire.rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const shoulder = mesh(rotor, 'rc-trx-tire-shoulder', new THREE.TorusGeometry(.15, .037, 7, 32), materials.tire, side * .067);
    shoulder.rotation.y = Math.PI / 2;
    const rim = mesh(rotor, 'rc-trx-alloy-rim', new THREE.CylinderGeometry(.119, .119, .018, 24), materials.silver, side * .092);
    rim.rotation.z = Math.PI / 2;
    const inset = mesh(rotor, 'rc-trx-rim-inset', new THREE.CylinderGeometry(.107, .107, .021, 24), materials.dark, side * .099);
    inset.rotation.z = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      for (const split of [-1, 1]) {
        const spoke = box(rotor, 'rc-trx-split-spoke', .014, .083, .016, materials.silver,
          side * .112, Math.cos(angle) * .066 - Math.sin(angle) * split * .012,
          Math.sin(angle) * .066 + Math.cos(angle) * split * .012, .003);
        spoke.rotation.x = angle;
      }
      const lug = mesh(rotor, 'rc-trx-wheel-lug', new THREE.CylinderGeometry(.007, .007, .009, 6), materials.silver,
        side * .13, Math.cos(angle) * .038, Math.sin(angle) * .038);
      lug.rotation.z = Math.PI / 2;
    }
    const hub = mesh(rotor, 'rc-trx-wheel-hub', new THREE.CylinderGeometry(.03, .03, .025, 6), materials.dark, side * .118);
    hub.rotation.z = Math.PI / 2;
  }
  // Three offset rows of individual rubber blocks use one instanced draw call per wheel.
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(.058, .028, .039), materials.tire, 66);
  blocks.name = 'rc-trx-knobby-tread'; blocks.castShadow = blocks.receiveShadow = true;
  const transform = new THREE.Object3D();
  let index = 0;
  for (let row = -1; row <= 1; row++) for (let i = 0; i < 22; i++) {
    const angle = i * Math.PI * 2 / 22 + (row === 0 ? .068 : 0);
    transform.position.set(row * .055, Math.cos(angle) * .178, Math.sin(angle) * .178);
    transform.rotation.set(angle, 0, row * .19); transform.updateMatrix(); blocks.setMatrixAt(index++, transform.matrix);
  }
  blocks.instanceMatrix.needsUpdate = true; rotor.add(blocks);
  return rotor;
}
