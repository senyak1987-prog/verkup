import * as CANNON from 'cannon-es';
import type { RcArenaBounds, RcPhysics } from './physics';

/** Dimensions are arena-local metres; y, when supplied, is the body's centre. */
export interface RcPropSpec {
  id: string;
  kind: 'cone' | 'tire' | 'bollard';
  x: number;
  z: number;
  radius: number;
  height: number;
  mass?: number;
  y?: number;
  yaw?: number;
}

export interface RcPropBody {
  spec: RcPropSpec;
  body: CANNON.Body;
  /** Live references: renderer copies these after each step without allocations. */
  position: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
}

export interface RcPropsPhysicsOptions {
  height: (x: number, z: number) => number;
  bounds: RcArenaBounds;
  barriers?: readonly { minX: number; maxX: number; minZ: number; maxZ: number; height: number }[];
}

const FIXED_STEP = 1 / 120;
const PROP_GROUP = 1;
const FLOOR_GROUP = 2;
const CAR_GROUP = 4;
const CAR_MASS = 9;
const CAR_HALF_WIDTH = .62;
const CAR_HALF_LENGTH = 1.04;
const CAR_CENTRE_OFFSET = .02;
const DEFAULT_MASS = { cone: .55, tire: 1.3, bollard: 1.7 };
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Actual rigid bodies: gravity, angular inertia, prop-to-prop contacts and terrain.
 * A kinematic chassis bridges the existing four-wheel RC solver to Cannon. The
 * equal/opposite solved contact impulse is fed back into the vehicle each tick.
 */
export class RcPropsPhysics {
  readonly bodies: RcPropBody[] = [];
  private world: CANNON.World;
  private carBody: CANNON.Body;
  private initial = new Map<CANNON.Body, { position: CANNON.Vec3; quaternion: CANNON.Quaternion }>();
  private accumulator = 0;
  private disposed = false;

  constructor(specs: readonly RcPropSpec[], options: RcPropsPhysicsOptions) {
    const world = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true });
    world.broadphase = new CANNON.SAPBroadphase(world);
    const solver = new CANNON.GSSolver();
    solver.iterations = 14;
    solver.tolerance = 1e-7;
    world.solver = solver;
    const ground = new CANNON.Material('rc-ground');
    const prop = new CANNON.Material('rc-prop');
    const car = new CANNON.Material('rc-chassis');
    world.defaultContactMaterial.contactEquationStiffness = 1e7;
    world.defaultContactMaterial.contactEquationRelaxation = 4;
    world.addContactMaterial(new CANNON.ContactMaterial(prop, ground, {
      friction: 0, restitution: .07, contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(prop, prop, { friction: 0, restitution: .1 }));
    world.addContactMaterial(new CANNON.ContactMaterial(prop, car, { friction: .42, restitution: .12 }));

    this.addTerrain(options, ground);
    this.addWalls(options.bounds, ground);
    for (const obstacle of options.barriers ?? []) {
      const height = Math.max(.02, finite(obstacle.height));
      const body = new CANNON.Body({ mass: 0, material: ground,
        shape: new CANNON.Box(new CANNON.Vec3((obstacle.maxX - obstacle.minX) / 2, height / 2, (obstacle.maxZ - obstacle.minZ) / 2)),
        position: new CANNON.Vec3((obstacle.minX + obstacle.maxX) / 2, height / 2, (obstacle.minZ + obstacle.maxZ) / 2),
        collisionFilterGroup: FLOOR_GROUP, collisionFilterMask: PROP_GROUP,
      });
      for (const shape of body.shapes) {
        shape.collisionFilterGroup = FLOOR_GROUP;
        shape.collisionFilterMask = PROP_GROUP;
      }
      world.addBody(body);
    }
    this.carBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      mass: 0,
      material: car,
      shape: new CANNON.Box(new CANNON.Vec3(CAR_HALF_WIDTH, .35, CAR_HALF_LENGTH)),
      collisionFilterGroup: CAR_GROUP,
      collisionFilterMask: PROP_GROUP,
    });
    this.carBody.position.set(0, -100, 0);
    for (const shape of this.carBody.shapes) {
      shape.collisionFilterGroup = CAR_GROUP;
      shape.collisionFilterMask = PROP_GROUP;
    }
    world.addBody(this.carBody);

    for (const raw of specs) {
      const spec: RcPropSpec = { ...raw,
        radius: clamp(finite(raw.radius, .25), .055, 2),
        height: clamp(finite(raw.height, .65), .06, 3),
      };
      const body = new CANNON.Body({
        mass: clamp(finite(spec.mass ?? DEFAULT_MASS[spec.kind], DEFAULT_MASS[spec.kind]), .08, 30),
        material: prop,
        linearDamping: .12,
        angularDamping: .16,
        allowSleep: true,
        sleepSpeedLimit: .14,
        sleepTimeLimit: .65,
        collisionFilterGroup: PROP_GROUP,
        collisionFilterMask: PROP_GROUP | FLOOR_GROUP | CAR_GROUP,
      });
      this.addPropShapes(body, spec);
      body.position.set(finite(spec.x), finite(spec.y ?? (options.height(spec.x, spec.z) + spec.height / 2 + .006)), finite(spec.z));
      body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), finite(spec.yaw ?? 0));
      world.addBody(body);
      this.bodies.push({ spec, body, position: body.position, quaternion: body.quaternion });
      this.initial.set(body, { position: body.position.clone(), quaternion: body.quaternion.clone() });
    }
  }

  private addTerrain(options: RcPropsPhysicsOptions, material: CANNON.Material) {
    const { bounds, height } = options;
    // Cannon's field is XY with local Z up. Rotate -90° about X: field Y then
    // points toward world -Z, so reverse the z samples and anchor at maxZ.
    const columns = Math.ceil((bounds.maxX - bounds.minX) / .24);
    const spacing = (bounds.maxX - bounds.minX) / columns;
    const rows = Math.ceil((bounds.maxZ - bounds.minZ) / spacing);
    const data = Array.from({ length: columns + 1 }, (_, i) =>
      Array.from({ length: rows + 1 }, (_, j) => finite(height(bounds.minX + i * spacing, bounds.maxZ - j * spacing))));
    const shape = new CANNON.Heightfield(data, { elementSize: spacing });
    shape.collisionFilterGroup = FLOOR_GROUP;
    shape.collisionFilterMask = PROP_GROUP;
    const body = new CANNON.Body({ mass: 0, shape, material,
      collisionFilterGroup: FLOOR_GROUP, collisionFilterMask: PROP_GROUP,
    });
    body.position.set(bounds.minX, 0, bounds.maxZ);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(body);
  }

  private addWalls(bounds: RcArenaBounds, material: CANNON.Material) {
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreZ = (bounds.minZ + bounds.maxZ) / 2;
    const wall = (x: number, z: number, halfX: number, halfZ: number) => {
      const body = new CANNON.Body({ mass: 0, material,
        shape: new CANNON.Box(new CANNON.Vec3(halfX, 4, halfZ)),
        position: new CANNON.Vec3(x, 3.5, z),
        collisionFilterGroup: FLOOR_GROUP, collisionFilterMask: PROP_GROUP,
      });
      for (const shape of body.shapes) {
        shape.collisionFilterGroup = FLOOR_GROUP;
        shape.collisionFilterMask = PROP_GROUP;
      }
      this.world.addBody(body);
    };
    wall(bounds.minX - .1, centreZ, .1, depth / 2 + .2);
    wall(bounds.maxX + .1, centreZ, .1, depth / 2 + .2);
    wall(centreX, bounds.minZ - .1, width / 2 + .2, .1);
    wall(centreX, bounds.maxZ + .1, width / 2 + .2, .1);
  }

  private addPropShapes(body: CANNON.Body, spec: RcPropSpec) {
    const { radius, height, kind } = spec;
    if (kind === 'cone') {
      const baseHeight = Math.min(.08, height * .2);
      body.addShape(new CANNON.Box(new CANNON.Vec3(radius, baseHeight / 2, radius)),
        new CANNON.Vec3(0, -height / 2 + baseHeight / 2, 0));
      body.addShape(new CANNON.Cylinder(radius * .12, radius * .82, height - baseHeight, 12),
        new CANNON.Vec3(0, baseHeight / 2, 0));
    } else if (kind === 'tire') {
      // An annular compound keeps the tyre's hole open, and tumbles/rolls after
      // impact. The box segments overlap at the seams without a hidden disc.
      const segments = 10;
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const orientation = new CANNON.Quaternion();
        orientation.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -angle);
        body.addShape(new CANNON.Box(new CANNON.Vec3(radius * .27, height / 2, radius * .245)),
          new CANNON.Vec3(Math.cos(angle) * radius * .73, 0, Math.sin(angle) * radius * .73), orientation);
      }
    } else {
      body.addShape(new CANNON.Cylinder(radius, radius, height, 12));
    }
    // Convex contacts use the detailed silhouettes against cars and other props.
    // Rounded ground contacts avoid catching the internal vertical faces of the
    // heightfield's triangular pillars, so loose tyres can actually roll across
    // the shared terrain instead of sticking at every 24 cm grid line.
    for (const shape of body.shapes) {
      shape.collisionFilterGroup = PROP_GROUP;
      shape.collisionFilterMask = PROP_GROUP | CAR_GROUP;
    }
    const groundSphere = (r: number, x: number, y: number, z: number) => {
      const shape = new CANNON.Sphere(r);
      shape.collisionFilterGroup = PROP_GROUP;
      shape.collisionFilterMask = FLOOR_GROUP;
      body.addShape(shape, new CANNON.Vec3(x, y, z));
    };
    if (kind === 'tire') {
      const tubeRadius = Math.min(height / 2, radius * .44);
      for (let i = 0; i < 10; i++) {
        const angle = i / 10 * Math.PI * 2;
        groundSphere(tubeRadius, Math.cos(angle) * (radius - tubeRadius), 0, Math.sin(angle) * (radius - tubeRadius));
      }
    } else if (kind === 'cone') {
      const baseHeight = Math.min(.08, height * .2);
      const baseR = baseHeight / 2;
      for (const x of [-1, 1]) for (const z of [-1, 1]) {
        groundSphere(baseR, x * (radius - baseR), -height / 2 + baseR, z * (radius - baseR));
      }
      const lowerR = Math.min(radius * .7, (height - baseHeight) / 3);
      groundSphere(lowerR, 0, -height / 2 + baseHeight + lowerR, 0);
      groundSphere(lowerR * .66, 0, height * .05, 0);
      groundSphere(radius * .12, 0, height / 2 - radius * .12, 0);
    } else {
      const r = Math.min(radius, height / 2);
      groundSphere(r, 0, -height / 2 + r, 0);
      groundSphere(r, 0, 0, 0);
      groundSphere(r, 0, height / 2 - r, 0);
    }
  }

  step(dt: number, car: RcPhysics) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const duration = Math.min(dt, .25);
    this.accumulator += duration;
    const count = Math.min(30, Math.floor((this.accumulator + 1e-10) / FIXED_STEP));
    // Pose and velocity both matter: zero velocity would teleport an immovable
    // box through the props instead of transferring the car's momentum.
    for (let i = 0; i < count; i++) {
      const state = car.state;
      const timeBeforeEnd = (count - i) * FIXED_STEP;
      this.carBody.position.set(state.x - state.vx * timeBeforeEnd, state.y + CAR_CENTRE_OFFSET, state.z - state.vz * timeBeforeEnd);
      this.carBody.quaternion.setFromEuler(state.pitch, state.yaw, state.roll, 'YXZ');
      this.carBody.velocity.set(state.vx, 0, state.vz);
      this.carBody.angularVelocity.set(0, 0, 0);
      this.carBody.aabbNeedsUpdate = true;
      this.carBody.wakeUp();
      this.world.step(FIXED_STEP);
      this.applyGroundFriction();
      this.applyPropFriction();
      let impulseX = 0, impulseZ = 0;
      for (const contact of this.world.contacts) {
        let sign = 0;
        if (contact.bi === this.carBody) sign = -1;
        else if (contact.bj === this.carBody) sign = 1;
        if (!sign) continue;
        const impulse = Math.max(0, finite(contact.multiplier)) * FIXED_STEP / CAR_MASS;
        impulseX += contact.ni.x * impulse * sign;
        impulseZ += contact.ni.z * impulse * sign;
      }
      const kick = Math.hypot(impulseX, impulseZ);
      if (kick > .0001) car.bump(impulseX, impulseZ, Math.min(kick, 2.5));
      for (const entry of this.bodies) {
        const { body } = entry;
        // A paused-tab catch-up is capped above; velocity caps also guard against
        // a pathological deeply overlapping spawn, without prescribing motion.
        const speed = body.velocity.length();
        if (speed > 15) body.velocity.scale(15 / speed, body.velocity);
        const angular = body.angularVelocity.length();
        if (angular > 22) body.angularVelocity.scale(22 / angular, body.angularVelocity);
      }
      this.accumulator -= FIXED_STEP;
    }
    if (this.accumulator < 1e-10) this.accumulator = 0;
  }

  private applyGroundFriction() {
    // Cannon creates a tangent constraint for each intersected field triangle.
    // A compound tyre can therefore receive 10–30 full friction budgets in one
    // tick. Combine its support contacts into one Coulomb contact: the budget is
    // proportional to the actual total normal impulse, with rotational inertia
    // included, so tyres can slide, tip and transition into rolling naturally.
    for (const { body } of this.bodies) {
      if (body.sleepState === CANNON.Body.SLEEPING) continue;
      const relativePoint = new CANNON.Vec3();
      let contacts = 0, normalImpulse = 0;
      for (const contact of this.world.contacts) {
        let point: CANNON.Vec3 | null = null, up = 0;
        if (contact.bi === body && contact.bj.collisionFilterGroup === FLOOR_GROUP) {
          point = contact.ri; up = -contact.ni.y;
        } else if (contact.bj === body && contact.bi.collisionFilterGroup === FLOOR_GROUP) {
          point = contact.rj; up = contact.ni.y;
        }
        if (!point || up < .6) continue;
        relativePoint.vadd(point, relativePoint);
        normalImpulse += Math.max(0, finite(contact.multiplier)) * FIXED_STEP * up;
        contacts++;
      }
      if (!contacts || normalImpulse <= 0) continue;
      relativePoint.scale(1 / contacts, relativePoint);
      const contactVelocity = new CANNON.Vec3();
      body.angularVelocity.cross(relativePoint, contactVelocity);
      contactVelocity.vadd(body.velocity, contactVelocity);
      contactVelocity.y = 0;
      const speed = contactVelocity.length();
      if (speed < 1e-6) continue;
      const direction = contactVelocity.scale(1 / speed);
      const rotational = new CANNON.Vec3();
      relativePoint.cross(direction, rotational);
      body.invInertiaWorld.vmult(rotational, rotational);
      rotational.cross(relativePoint, rotational);
      const inverseMass = body.invMass + direction.dot(rotational);
      const budget = .65 * Math.min(normalImpulse, body.mass * 9.81 * FIXED_STEP * 4);
      const impulse = Math.min(speed / Math.max(inverseMass, .001), budget);
      body.applyImpulse(direction.scale(-impulse), relativePoint);
    }
  }

  private applyPropFriction() {
    type Pair = { a: CANNON.Body; b: CANNON.Body; ra: CANNON.Vec3; rb: CANNON.Vec3;
      normal: CANNON.Vec3; normalImpulse: number; count: number };
    const pairs = new Map<string, Pair>();
    for (const contact of this.world.contacts) {
      if (contact.bi.collisionFilterGroup !== PROP_GROUP || contact.bj.collisionFilterGroup !== PROP_GROUP) continue;
      const ordered = contact.bi.id < contact.bj.id;
      const a = ordered ? contact.bi : contact.bj;
      const b = ordered ? contact.bj : contact.bi;
      const key = `${a.id}:${b.id}`;
      let pair = pairs.get(key);
      if (!pair) {
        pair = { a, b, ra: new CANNON.Vec3(), rb: new CANNON.Vec3(), normal: new CANNON.Vec3(), normalImpulse: 0, count: 0 };
        pairs.set(key, pair);
      }
      pair.ra.vadd(ordered ? contact.ri : contact.rj, pair.ra);
      pair.rb.vadd(ordered ? contact.rj : contact.ri, pair.rb);
      const impulse = Math.max(0, finite(contact.multiplier)) * FIXED_STEP;
      pair.normal.x += contact.ni.x * impulse * (ordered ? 1 : -1);
      pair.normal.y += contact.ni.y * impulse * (ordered ? 1 : -1);
      pair.normal.z += contact.ni.z * impulse * (ordered ? 1 : -1);
      pair.normalImpulse += impulse;
      pair.count++;
    }
    for (const pair of pairs.values()) {
      const { a, b, ra, rb, normal } = pair;
      if (pair.normalImpulse <= 0 || normal.lengthSquared() < 1e-10) continue;
      ra.scale(1 / pair.count, ra);
      rb.scale(1 / pair.count, rb);
      normal.normalize();
      const va = new CANNON.Vec3(), vb = new CANNON.Vec3();
      a.angularVelocity.cross(ra, va); va.vadd(a.velocity, va);
      b.angularVelocity.cross(rb, vb); vb.vadd(b.velocity, vb);
      const tangent = vb.vsub(va);
      tangent.vsub(normal.scale(tangent.dot(normal)), tangent);
      const speed = tangent.length();
      if (speed < 1e-6) continue;
      const direction = tangent.scale(1 / speed);
      const inverseMassAtContact = (body: CANNON.Body, point: CANNON.Vec3) => {
        const rotational = point.cross(direction);
        body.invInertiaWorld.vmult(rotational, rotational);
        rotational.cross(point, rotational);
        return body.invMass + direction.dot(rotational);
      };
      const inverseMass = inverseMassAtContact(a, ra) + inverseMassAtContact(b, rb);
      const budget = .58 * Math.min(pair.normalImpulse, (a.mass + b.mass) * 9.81 * FIXED_STEP * 4);
      const impulse = Math.min(speed / Math.max(inverseMass, .001), budget);
      a.applyImpulse(direction.scale(impulse), ra);
      b.applyImpulse(direction.scale(-impulse), rb);
    }
  }

  reset() {
    if (this.disposed) return;
    this.accumulator = 0;
    for (const { body } of this.bodies) {
      const initial = this.initial.get(body)!;
      body.position.copy(initial.position);
      body.previousPosition.copy(initial.position);
      body.interpolatedPosition.copy(initial.position);
      body.quaternion.copy(initial.quaternion);
      body.previousQuaternion.copy(initial.quaternion);
      body.interpolatedQuaternion.copy(initial.quaternion);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.force.setZero();
      body.torque.setZero();
      body.aabbNeedsUpdate = true;
      body.wakeUp();
    }
    this.carBody.velocity.setZero();
    this.carBody.position.set(0, -100, 0);
    this.carBody.aabbNeedsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
    this.initial.clear();
  }
}
