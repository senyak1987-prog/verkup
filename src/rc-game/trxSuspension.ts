import * as THREE from 'three';
import type { WheelState } from './physics';
import type { RcVehicleProfile } from './vehicleTypes';

type SuspensionMaterials = { dark: THREE.Material; silver: THREE.Material; spring: THREE.Material };
export type TrxSuspensionOptions = Partial<Pick<RcVehicleProfile, 'wheelRadius' | 'bodyRestHeight' | 'mountY' | 'modelScale'>>;
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;

/** Articulated front wishbones and rear axle; only the coil changes length. */
export function createTrxSuspension(parent: THREE.Object3D, materials: SuspensionMaterials, options: TrxSuspensionOptions = {}) {
  const wheelRadius = Math.max(.07, finite(options.wheelRadius, .19));
  const restHeight = wheelRadius - finite(options.bodyRestHeight, .48);
  const size = wheelRadius / .19;
  const chassisScale = Math.max(.1, finite(options.modelScale, 1));
  const mountY = finite(options.mountY, -.035);
  const armHeightShift = restHeight + .29 * chassisScale;
  const upperInset = .085 * size, lowerInset = .025 * size, lowerOffset = .025 * size;
  const minimumShockLength = Math.hypot(upperInset - lowerInset,
    Math.max(0, mountY - (restHeight + .14 + lowerOffset)));
  // A rigid housing fits inside the shock at the bump stop. The old 105 mm
  // housing overran the downloaded rig's shorter damper at full compression.
  const housingLength = Math.min(.105 * size, minimumShockLength * .72);
  const springCap = .015 * size;
  const root = new THREE.Group(); root.name = 'rc-trx-suspension'; parent.add(root);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
  const up = new THREE.Vector3(0, 1, 0), delta = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const mesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const object = new THREE.Mesh(geometry, material); object.name = name;
    object.castShadow = object.receiveShadow = true; root.add(object); return object;
  };
  const rod = (name: string, radius: number, material = materials.silver) => {
    const object = mesh(name, cylinder, material); object.scale.set(radius * size, 1, radius * size); return object;
  };
  const connect = (object: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
    delta.subVectors(to, from); object.position.copy(from).add(to).multiplyScalar(.5);
    object.scale.y = Math.max(.001, delta.length());
    object.quaternion.setFromUnitVectors(up, delta.normalize());
  };
  const coilGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
    Array.from({ length: 97 }, (_, i) => new THREE.Vector3(
      Math.cos(i / 96 * Math.PI * 12) * .034 * size, i / 96,
      Math.sin(i / 96 * Math.PI * 12) * .034 * size))), 96, .006 * size, 5, false);
  const shocks = Array.from({ length: 4 }, (_, i) => {
    const assembly = new THREE.Group(); assembly.name = `rc-trx-damper-${i}`; root.add(assembly);
    const body = new THREE.Mesh(cylinder, materials.dark); body.name = 'rc-trx-damper-body';
    body.scale.set(.023 * size, housingLength, .023 * size); assembly.add(body);
    const piston = new THREE.Mesh(cylinder, materials.silver); piston.name = 'rc-trx-sliding-piston';
    piston.scale.set(.009 * size, .15, .009 * size); assembly.add(piston);
    const coil = new THREE.Mesh(coilGeometry, materials.spring); coil.name = 'rc-trx-coil-spring'; assembly.add(coil);
    const reservoir = new THREE.Mesh(cylinder, materials.spring); reservoir.name = 'rc-trx-damper-reservoir';
    reservoir.scale.set(.017 * size, .075 * size, .017 * size); assembly.add(reservoir);
    for (const object of [body, piston, coil, reservoir]) object.castShadow = object.receiveShadow = true;
    return { assembly, body, piston, coil, reservoir };
  });
  const frontArms = Array.from({ length: 2 }, (_, i) => [
    rod(`rc-trx-front-upper-arm-${i}-a`, .010), rod(`rc-trx-front-upper-arm-${i}-b`, .010),
    rod(`rc-trx-front-lower-arm-${i}-a`, .014), rod(`rc-trx-front-lower-arm-${i}-b`, .014),
    rod(`rc-trx-steering-link-${i}`, .007),
  ]);
  const rearArms = Array.from({ length: 2 }, (_, i) => [
    rod(`rc-trx-rear-trailing-link-${i}`, .016, materials.dark), rod(`rc-trx-rear-upper-link-${i}`, .012),
  ]);
  const axle = rod('rc-trx-rear-solid-axle', .027, materials.dark);
  const panhard = rod('rc-trx-rear-panhard-link', .010);
  const differential = mesh('rc-trx-rear-differential', new THREE.SphereGeometry(.063 * size, 12, 8), materials.dark);
  differential.scale.set(1, .8, 1.15);

  return {
    root,
    update(wheels: readonly WheelState[]) {
      wheels.forEach((wheel, i) => {
        const side = Math.sign(wheel.x), shock = shocks[i];
        // The body remains rigid; a separate chrome shaft slides into it.
        a.set(wheel.x - side * upperInset, mountY, wheel.z);
        b.set(wheel.x - side * lowerInset, wheel.height + lowerOffset, wheel.z);
        delta.subVectors(a, b); const length = Math.max(.001, delta.length());
        shock.assembly.position.copy(b); shock.assembly.quaternion.setFromUnitVectors(up, delta.normalize());
        shock.body.position.set(0, length - housingLength / 2, 0);
        shock.piston.scale.y = Math.max(.001, length - housingLength);
        shock.piston.position.set(0, shock.piston.scale.y / 2, 0);
        shock.coil.position.y = springCap; shock.coil.scale.y = Math.max(.001, length - 2 * springCap);
        shock.reservoir.position.set(side * .041 * size, length - shock.reservoir.scale.y / 2, 0);
        if (i < 2) {
          const arms = frontArms[i];
          for (let level = 0; level < 2; level++) for (let end = 0; end < 2; end++) {
            a.set(wheel.x * .50, (level ? -.13 : -.06) * chassisScale + armHeightShift, wheel.z + (end ? .115 : -.115) * size);
            b.set(wheel.x - side * lowerInset, wheel.height + (level ? -.02 : .075) * size, wheel.z);
            connect(arms[level * 2 + end], a, b);
          }
          a.set(wheel.x * .40, -.09 * chassisScale + armHeightShift, wheel.z + .10 * size);
          b.set(wheel.x - side * .035 * size, wheel.height + .015 * size, wheel.z + .09 * size);
          connect(arms[4], a, b);
        } else {
          const arms = rearArms[i - 2];
          a.set(wheel.x * .83, -.12 * chassisScale + armHeightShift, wheel.z + .32 * size); b.set(wheel.x * .83, wheel.height, wheel.z);
          connect(arms[0], a, b);
          a.set(wheel.x * .43, -.07 * chassisScale + armHeightShift, wheel.z + .25 * size); b.set(wheel.x * .43, wheel.height + .045 * size, wheel.z);
          connect(arms[1], a, b);
        }
      });
      const left = wheels[2], right = wheels[3];
      if (!left || !right) return;
      a.set(left.x, left.height, left.z); b.set(right.x, right.height, right.z); connect(axle, a, b);
      differential.position.copy(a).add(b).multiplyScalar(.5);
      // The rear cross-link moves with the axle and keeps a fixed chassis end.
      a.set(left.x * .82, -.10 * chassisScale + armHeightShift, left.z - .055 * size);
      b.set(right.x * .72, right.height + .045 * size, right.z - .055 * size);
      connect(panhard, a, b);
    },
  };
}
