import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/rc-game/physics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const api = {};
new Function('exports', compiled)(api);
const { RcPhysics, MAX_SPEED, ARENA_LIMIT, BODY_REST_HEIGHT, ANTENNA_BASE } = api;
const idle = { target: null, throttle: 0, brake: false, reverse: false };
const drive = { ...idle, throttle: 1 };
const simulate = (car, seconds, input = idle, dt = 1 / 60) => {
  for (let time = 0; time < seconds - 1e-8; time += dt) car.step(Math.min(dt, seconds - time), input);
};
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const tipFlex = car => {
  const tip = car.state.antenna.at(-1);
  return Math.hypot(tip.x - ANTENNA_BASE.x, tip.z - ANTENNA_BASE.z);
};

test('Reset yields a resting chassis and grounded wheels without stale momentum', () => {
  const car = new RcPhysics();
  simulate(car, 1, drive);
  car.bump(1, 0, 3);
  car.reset();
  assert.equal(car.state.x, 0);
  assert.equal(car.state.z, 3.6);
  assert.equal(car.state.speed, 0);
  assert.equal(car.state.collision, 0);
  close(car.state.y, BODY_REST_HEIGHT);
  close(car.state.yaw, Math.PI / 2);
  for (const wheel of car.state.wheels) close(car.state.y + wheel.height, 0.19);
  close(car.state.antenna.at(-1).y, 1.45);
  simulate(car, 3);
  close(car.state.y, BODY_REST_HEIGHT);
  close(tipFlex(car), 0);
});

test('Motor, coasting and braking have different measurable stopping behaviour', () => {
  const coast = new RcPhysics(), brake = new RcPhysics();
  simulate(coast, 0.8, drive);
  simulate(brake, 0.8, drive);
  const speed = Math.abs(coast.state.speed);
  assert.ok(speed > 3 && speed < MAX_SPEED);
  simulate(coast, 0.35);
  simulate(brake, 0.35, { ...idle, brake: true });
  assert.ok(coast.state.speed > speed * 0.85);
  assert.ok(Math.abs(brake.state.speed) < 0.01);
  assert.ok(brake.state.x < coast.state.x);
});

test('Mouse targets are approached and held; reverse preserves wheel steering semantics', () => {
  const car = new RcPhysics();
  simulate(car, 8, { ...drive, target: { x: 3.8, z: 3.6 } });
  assert.ok(Math.hypot(car.state.x - 3.8, car.state.z - 3.6) < 0.5);
  assert.ok(Math.abs(car.state.speed) < 0.08);
  const forward = new RcPhysics(), reverse = new RcPhysics();
  simulate(forward, 0.5, { ...drive, steer: 0.6 });
  simulate(reverse, 0.5, { ...drive, reverse: true, steer: 0.6 });
  assert.ok(forward.state.yaw > Math.PI / 2);
  assert.ok(reverse.state.yaw < Math.PI / 2);
  assert.ok(reverse.state.speed < 0);
  assert.ok(reverse.state.steer > 0, 'Reverse must not silently invert the wheel angle');
});

test('Substeps keep the same movement and antenna response at 30, 60 and 144 Hz', () => {
  const frames = [30, 60, 144].map(hz => {
    const car = new RcPhysics();
    simulate(car, 1.1, { ...drive, steer: 0.24 }, 1 / hz);
    simulate(car, 0.3, { ...idle, brake: true }, 1 / hz);
    return car.state;
  });
  for (const s of frames.slice(1)) {
    close(s.x, frames[0].x, 0.035);
    close(s.z, frames[0].z, 0.035);
    close(s.yaw, frames[0].yaw, 0.025);
    close(s.y, frames[0].y, 0.01);
    close(s.antenna.at(-1).x, frames[0].antenna.at(-1).x, 0.06);
  }
});

test('Each suspension contact samples its own ground and the chassis follows a bank', () => {
  const car = new RcPhysics((x, z) => 0.07 * x + 0.12 * z);
  simulate(car, 3);
  assert.ok(Math.abs(car.state.pitch) > 0.025);
  assert.ok(Math.abs(car.state.roll) > 0.08);
  for (const wheel of car.state.wheels) {
    const yaw = car.state.yaw;
    const x = car.state.x + wheel.x * Math.cos(yaw) + wheel.z * Math.sin(yaw);
    const z = car.state.z - wheel.x * Math.sin(yaw) + wheel.z * Math.cos(yaw);
    const worldHeight = car.state.y + wheel.height + wheel.x * Math.sin(car.state.roll) - wheel.z * Math.sin(car.state.pitch);
    close(worldHeight, 0.07 * x + 0.12 * z + 0.19, 0.005);
  }
  const bump = new RcPhysics((x, z) => x > 0.1 && z > 3.65 ? 0.15 : 0);
  simulate(bump, 0.15);
  const travel = bump.state.wheels.map(w => w.compression);
  assert.ok(Math.max(...travel) - Math.min(...travel) > 0.08);
});

test('Antenna flexes under acceleration and collision, keeps connected segments, then settles', () => {
  const car = new RcPhysics();
  simulate(car, 0.5, drive);
  assert.ok(tipFlex(car) > 0.04);
  assert.ok(car.state.antenna.at(-1).z < ANTENNA_BASE.z, 'Forward acceleration bends the antenna toward the rear');
  car.bump(0, 1, 3);
  simulate(car, 0.16, { ...idle, brake: true });
  assert.ok(tipFlex(car) > 0.06);
  for (let i = 1; i < car.state.antenna.length; i++) {
    const a = car.state.antenna[i - 1], b = car.state.antenna[i];
    close(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 0.109, 0.012);
  }
  simulate(car, 6, { ...idle, brake: true });
  assert.ok(tipFlex(car) < 0.008);
  close(car.state.antenna.at(-1).y, 1.45, 0.012);
});

test('Walls bounce inward, bound speed and expose a fading collision envelope', () => {
  const car = new RcPhysics();
  car.state.x = ARENA_LIMIT - 0.7;
  car.state.vx = 5;
  car.step(1 / 60, idle);
  assert.ok(car.state.x <= ARENA_LIMIT - 0.62);
  assert.ok(car.state.vx < 0);
  assert.ok(car.state.collision > 0.3);
  assert.ok(Math.hypot(car.state.vx, car.state.vz) <= MAX_SPEED);
  simulate(car, 2, { ...idle, brake: true });
  assert.ok(car.state.collision < 0.001);
});

test('Long mixed-input simulation remains finite over hills, impacts and frame stalls', () => {
  const car = new RcPhysics((x, z) => 0.3 * Math.exp(-((x - 3) ** 2 + (z - 1) ** 2) / 2) + 0.06 * Math.sin(x * 4) * Math.cos(z * 3));
  for (let i = 0; i < 18000; i++) {
    const time = i / 60;
    car.step(i % 911 === 0 ? 0.4 : 1 / 60, {
      target: { x: Math.sin(time * 0.15) * 9.8, z: Math.cos(time * 0.19) * 9.8 },
      throttle: 0.8,
      reverse: i % 900 > 780,
      brake: i % 601 < 35,
    });
    if (i % 710 === 0) car.bump(Math.sin(time), Math.cos(time), 2.5);
    for (const value of Object.values(car.state)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    for (const point of car.state.antenna) for (const value of Object.values(point)) assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(car.state.x) <= ARENA_LIMIT);
    assert.ok(Math.abs(car.state.z) <= ARENA_LIMIT);
    assert.ok(Math.hypot(car.state.vx, car.state.vz) <= MAX_SPEED + 1e-9);
    assert.ok(Math.abs(car.state.heave) < 0.4);
  }
  assert.doesNotThrow(() => car.step(Number.NaN, idle));
  assert.doesNotThrow(() => car.step(-1, idle));
});
