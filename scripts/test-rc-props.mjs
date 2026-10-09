import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name) {
  const source = fs.readFileSync(new URL(`../src/rc-game/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const api = {};
  new Function('exports', 'require', compiled)(api, require);
  return api;
}
const { RcPhysics, MAX_SPEED } = load('physics');
const { RcPropsPhysics } = load('propsPhysics');
const bounds = { minX: -10.5, maxX: 10.5, minZ: -10.5, maxZ: 10.5 };
const idle = { target: null, throttle: 0, brake: false, reverse: false };
const drive = { ...idle, throttle: 1, steer: 0 };
const shape = (kind, overrides = {}) => ({ id: kind, kind, x: .08, z: 0,
  radius: kind === 'tire' ? .45 : .25,
  height: kind === 'tire' ? .32 : kind === 'cone' ? .78 : kind === 'ball' ? .5 : 1.05, ...overrides });
function setup(specs, height = () => 0, spawn = { x: 0, z: -3, yaw: 0 }, vehicleDimensions) {
  const car = new RcPhysics(height, { bounds, spawn });
  const props = new RcPropsPhysics(specs, { bounds, height, vehicleDimensions });
  return { car, props };
}
function simulate({ car, props }, seconds, input = idle, dt = 1 / 120, onStep = () => {}) {
  for (let time = 0; time < seconds - 1e-8; time += dt) {
    const step = Math.min(dt, seconds - time);
    car.step(step, input);
    props.step(step, car);
    onStep();
  }
}

test('The collision footprint follows custom chassis dimensions without phantom side impacts', () => {
  const run = vehicleDimensions => {
    const state = setup([shape('bollard', { x: .60, radius: .08 })], () => 0,
      { x: 0, z: -3, yaw: 0 }, vehicleDimensions);
    const prop = state.props.bodies[0];
    simulate(state, .5);
    const original = prop.position.clone();
    let recoil = 0;
    simulate(state, 2.4, drive, 1 / 120, () => { recoil = Math.max(recoil, state.car.state.collision); });
    const travelled = Math.hypot(prop.position.x - original.x, prop.position.z - original.z);
    state.props.dispose();
    return { travelled, recoil };
  };
  const original = run();
  const narrow = run({ halfWidth: .32, halfLength: .99, halfHeight: .30, centerOffset: .02 });
  assert.ok(original.travelled > .4 && original.recoil > .005, 'The default truck must still hit this roadside bollard');
  assert.ok(narrow.travelled < .025 && narrow.recoil < .001,
    `A narrow chassis must pass beside the bollard: moved ${narrow.travelled}, recoil ${narrow.recoil}`);
});

test('Malformed vehicle dimensions remain finite and keep a usable collision box', () => {
  const state = setup([shape('cone', { x: 3, z: 3 })], () => 0, { x: -6, z: -6, yaw: 0 }, {
    halfWidth: Number.NaN, halfLength: -10, halfHeight: Number.POSITIVE_INFINITY, centerOffset: Number.NaN,
  });
  // These are the actual Cannon shape/pose values used by contacts, rather than
  // a second copy of the dimensions normalizer in the test.
  const collision = state.props.carBody;
  const extents = collision.shapes[0].halfExtents;
  assert.equal(extents.x, .62);
  assert.equal(extents.z, .05);
  assert.equal(extents.y, .35);
  simulate(state, .5);
  assert.ok(Number.isFinite(collision.position.y));
  assert.ok(Math.abs(collision.position.y - state.car.state.y - .02) < 1e-8);
  for (const value of Object.values(state.props.bodies[0].position)) assert.ok(Number.isFinite(value));
  state.props.dispose();
});

for (const kind of ['cone', 'tire', 'bollard', 'crate', 'barrel', 'ball']) {
  test(`Moving chassis hits a ${kind}: translation, angular motion and opposite recoil`, () => {
    const state = setup([shape(kind)]);
    const prop = state.props.bodies[0];
    const initial = prop.position.clone();
    let angularPeak = 0, recoil = false;
    simulate(state, 2.4, drive, 1 / 120, () => {
      angularPeak = Math.max(angularPeak, prop.body.angularVelocity.length());
      recoil ||= state.car.state.collision > .005;
      assert.ok(Math.hypot(state.car.state.vx, state.car.state.vz) <= MAX_SPEED + 1e-8);
    });
    const travelled = Math.hypot(prop.position.x - initial.x, prop.position.z - initial.z);
    assert.ok(travelled > .7, `${kind} only moved ${travelled} m`);
    assert.ok(angularPeak > .3, `${kind} did not rotate: ${angularPeak}`);
    assert.ok(recoil, 'Solved prop collision must feed an impulse back into the car');
    state.props.dispose();
  });
}

test('Airborne rigid body falls under gravity and settles above the floor', () => {
  const state = setup([shape('bollard', { x: 3, z: 3, y: 3 })], () => 0, { x: -8, z: -8, yaw: 0 });
  const body = state.props.bodies[0].body;
  simulate(state, .2);
  assert.ok(body.position.y < 2.85 && body.position.y > 2.7);
  assert.ok(body.velocity.y < -1.5);
  simulate(state, 4);
  assert.ok(body.position.y > .22 && body.position.y < .59, `Floor contact lost: ${body.position.y}`);
  assert.ok(body.velocity.length() < .1 && body.angularVelocity.length() < .12);
  state.props.dispose();
});

test('An off-centre impact transfers contacts through a tyre stack and knocks tyres apart', () => {
  const tyreRadius = .45, pileX = .08, chassisHalfWidth = .62;
  // Put the tyre centre beyond the chassis side, while the front corner cuts
  // into the tyre ring. A barely grazing side contact can push a stable stack
  // without tipping it, which would not exercise transfer through the stack.
  const approachX = pileX - chassisHalfWidth - tyreRadius * .25;
  const state = setup([
    shape('tire', { id: 'lower', y: .166 }),
    shape('tire', { id: 'middle', y: .492 }),
    shape('tire', { id: 'upper', y: .818 }),
  ], () => 0, { x: approachX, z: -3, yaw: 0 });
  simulate(state, .5);
  const horizontalSeparation = () => {
    const positions = state.props.bodies.map(({ position }) => position);
    return Math.max(...positions.flatMap((a, i) => positions.slice(i + 1)
      .map(b => Math.hypot(a.x - b.x, a.z - b.z))));
  };
  assert.ok(horizontalSeparation() < .04, 'The undisturbed tyres must first settle into one aligned stack');
  simulate(state, 2.5, drive);
  const maxSeparation = horizontalSeparation();
  assert.ok(maxSeparation > .7, `Tyres moved as one static pile: ${maxSeparation}`);
  for (const { body } of state.props.bodies) assert.ok(body.position.y > -.1, 'Tyre fell through the floor');
  state.props.dispose();
});

test('Shared heightfield maps positive world Z correctly and supports props on a raised stair', () => {
  const height = (x, z) => .03 * x + .055 * z + (x > 1 && z > 1 ? .75 : 0);
  const specs = [shape('cone', { id: 'positive', x: 4, z: 4 }),
    shape('cone', { id: 'negative', x: -4, z: -4 })];
  const state = setup(specs, height, { x: -8, z: -8, yaw: 0 });
  simulate(state, 4);
  for (const { spec, position } of state.props.bodies) {
    const expected = height(position.x, position.z) + spec.height / 2;
    assert.ok(Math.abs(position.y - expected) < .045,
      `${spec.id} settled at ${position.y}, expected ${expected}; check heightfield Z orientation`);
  }
  assert.ok(state.props.bodies[0].position.y > state.props.bodies[1].position.y + 1.25);
  state.props.dispose();
});

test('Reset restores every exact pose and clears all linear and angular momentum', () => {
  const specs = [shape('cone', { yaw: .45 }), shape('tire', { id: 'tire', x: 1.2, y: 1.4 }),
    shape('bollard', { id: 'bollard', x: -1.2 })];
  const state = setup(specs);
  const original = state.props.bodies.map(({ position, quaternion }) => ({ position: position.clone(), quaternion: quaternion.clone() }));
  simulate(state, 2, drive);
  state.props.reset();
  state.props.bodies.forEach(({ body }, i) => {
    assert.deepEqual(body.position, original[i].position);
    assert.deepEqual(body.quaternion, original[i].quaternion);
    assert.equal(body.velocity.length(), 0);
    assert.equal(body.angularVelocity.length(), 0);
    assert.equal(body.force.length(), 0);
    assert.equal(body.torque.length(), 0);
  });
  state.props.dispose();
  assert.doesNotThrow(() => state.props.step(1 / 60, state.car));
  assert.doesNotThrow(() => state.props.dispose());
});

test('Fixed ticks give the same settling at 30, 60 and 144 Hz; stalls and repeated impacts stay finite', () => {
  const frames = [30, 60, 144].map(hz => {
    const state = setup([shape('cone', { x: 3, z: 2, y: 2 })], () => 0, { x: -8, z: -8, yaw: 0 });
    simulate(state, 1.4, idle, 1 / hz);
    const result = state.props.bodies[0].position.clone();
    state.props.dispose();
    return result;
  });
  for (const result of frames.slice(1)) assert.ok(result.distanceTo(frames[0]) < .005);
  const state = setup(['cone', 'tire', 'bollard'].map((kind, i) => shape(kind, { x: i - 1, z: 0 })));
  for (let i = 0; i < 1800; i++) {
    const dt = i % 301 === 0 ? .45 : 1 / 60;
    state.car.step(dt, { ...drive, steer: Math.sin(i * .012) * .7, reverse: i % 420 > 330 });
    state.props.step(dt, state.car);
    for (const { body } of state.props.bodies) {
      for (const vector of [body.position, body.velocity, body.angularVelocity, body.quaternion]) {
        for (const value of Object.values(vector)) assert.ok(Number.isFinite(value));
      }
      assert.ok(Math.abs(body.position.x) < 11 && Math.abs(body.position.z) < 11, 'Prop escaped the boundary');
      assert.ok(body.position.y > -.2, 'Prop penetrated the floor');
    }
  }
  assert.doesNotThrow(() => state.props.step(Number.NaN, state.car));
  assert.doesNotThrow(() => state.props.step(-1, state.car));
  state.props.dispose();
});

test('Custom car bounds and spawn reset correctly; signed impacts are speed-limited', () => {
  const arena = { minX: -19.5, maxX: 19.5, minZ: -16.8, maxZ: 16.8 };
  const car = new RcPhysics(() => .75, { bounds: arena, spawn: { x: -12, z: 8, yaw: 0 } });
  assert.equal(car.state.x, -12);
  assert.equal(car.state.z, 8);
  car.bump(0, 1, -100);
  assert.ok(car.state.vz < 0 && car.state.speed < 0);
  assert.ok(Math.hypot(car.state.vx, car.state.vz) <= MAX_SPEED);
  car.state.x = 18.8;
  car.state.vx = 5;
  car.step(1 / 60, idle);
  assert.ok(car.state.x <= 18.88);
  assert.ok(car.state.vx < 0);
  car.reset();
  assert.equal(car.state.x, -12);
  assert.equal(car.state.z, 8);
  assert.equal(car.state.yaw, 0);
  assert.equal(car.state.speed, 0);
});

test('Bump stops carry the RC chassis up three real risers without burying its wheels', () => {
  const height = (_x, z) => z < -1 ? 0 : z < 0 ? .75 : z < 1 ? 1.5 : 2.25;
  const car = new RcPhysics(height, { bounds, spawn: { x: 0, z: -3, yaw: 0 } });
  for (let i = 0; i < 340; i++) {
    car.step(1 / 120, drive);
    const state = car.state;
    for (const wheel of state.wheels) {
      // Renderer hierarchy is chassis XYZ(pitch, 0, roll), inside vehicle Y(yaw).
      // Large stair articulation needs the complete transform for both height
      // and horizontal contact position; first-order offsets underestimate Y.
      const localX = wheel.x * Math.cos(state.roll) - wheel.height * Math.sin(state.roll);
      const rotatedY = wheel.x * Math.sin(state.roll) + wheel.height * Math.cos(state.roll);
      const localZ = rotatedY * Math.sin(state.pitch) + wheel.z * Math.cos(state.pitch);
      const centreY = state.y + rotatedY * Math.cos(state.pitch) - wheel.z * Math.sin(state.pitch);
      const x = state.x + localX * Math.cos(state.yaw) + localZ * Math.sin(state.yaw);
      const z = state.z - localX * Math.sin(state.yaw) + localZ * Math.cos(state.yaw);
      assert.ok(centreY >= height(x, z) + car.vehicle.wheelRadius - .003, `Wheel entered a stair: ${centreY} at z=${z}`);
    }
  }
  assert.ok(car.state.z > 2 && car.state.y > 2.65, 'Vehicle never reached the raised landing');
});
