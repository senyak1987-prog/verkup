import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';

const source = fs.readFileSync(new URL('../src/rc-game/physics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const api = {};
new Function('exports', compiled)(api);
const profileApi = {};
new Function('exports', ts.transpileModule(
  fs.readFileSync(new URL('../src/rc-game/trxAssetProfile.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText)(profileApi);
const { TRX_VEHICLE_PROFILE } = profileApi;
const { RcPhysics, MAX_SPEED, ARENA_LIMIT, BODY_REST_HEIGHT, ANTENNA_BASE,
  WHEEL_BASE, TRACK_WIDTH, WHEEL_RADIUS, SUSPENSION_REBOUND_TRAVEL, SUSPENSION_COMPRESSION_TRAVEL } = api;
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
// The rendering hierarchy applies the chassis X/Z tilt, then its outer Y yaw.
const wheelWorldPosition = (car, wheel) => {
  const s = car.state;
  const localX = wheel.x * Math.cos(s.roll) - wheel.height * Math.sin(s.roll);
  const afterRollY = wheel.x * Math.sin(s.roll) + wheel.height * Math.cos(s.roll);
  const localZ = afterRollY * Math.sin(s.pitch) + wheel.z * Math.cos(s.pitch);
  return {
    x: s.x + localX * Math.cos(s.yaw) + localZ * Math.sin(s.yaw),
    y: s.y + afterRollY * Math.cos(s.pitch) - wheel.z * Math.sin(s.pitch),
    z: s.z - localX * Math.sin(s.yaw) + localZ * Math.cos(s.yaw),
  };
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
  close(car.state.antenna.at(-1).y, ANTENNA_BASE.y + 1.09);
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
    const position = wheelWorldPosition(car, wheel);
    close(position.y, 0.07 * position.x + 0.12 * position.z + WHEEL_RADIUS, 0.005);
    assert.equal(wheel.contact, true);
    assert.ok(wheel.load > 0);
  }
  const bump = new RcPhysics((x, z) => x > 0.1 && z > 3.65 ? 0.15 : 0);
  simulate(bump, 0.15);
  const travel = bump.state.wheels.map(w => w.compression);
  assert.ok(Math.max(...travel) - Math.min(...travel) > 0.08);
});

test('Vehicle profile preserves uniform asset proportions and rejects non-finite dimensions', () => {
  const vehicle = { wheelBase: 1.28, trackWidth: .82, wheelRadius: .16, bodyRestHeight: .39 };
  const car = new RcPhysics(() => 0, { vehicle });
  for (const [key, value] of Object.entries(vehicle)) assert.equal(car.vehicle[key], value);
  assert.equal(car.vehicle.frontTrackWidth, vehicle.trackWidth);
  assert.equal(car.vehicle.rearTrackWidth, vehicle.trackWidth);
  assert.deepEqual(car.vehicle.antennaBase, ANTENNA_BASE);
  assert.ok(Object.isFrozen(car.vehicle));
  close(car.state.y, vehicle.bodyRestHeight);
  for (const wheel of car.state.wheels) {
    close(Math.abs(wheel.x), vehicle.trackWidth / 2);
    close(Math.abs(wheel.z), vehicle.wheelBase / 2);
    close(wheelWorldPosition(car, wheel).y, vehicle.wheelRadius);
  }
  simulate(car, .2, drive);
  const beforeSpin = car.state.wheelSpin;
  const beforeSpeed = car.state.speed;
  car.step(1 / 120, idle);
  close(car.state.wheelSpin - beforeSpin, car.state.speed / vehicle.wheelRadius / 120);
  assert.ok(car.state.speed < beforeSpeed);
  const invalid = new RcPhysics(() => 0, { vehicle: {
    wheelBase: Number.NaN, trackWidth: Infinity, wheelRadius: Number.NaN, bodyRestHeight: Infinity,
  } });
  assert.equal(invalid.vehicle.wheelBase, WHEEL_BASE);
  assert.equal(invalid.vehicle.trackWidth, TRACK_WIDTH);
  assert.equal(invalid.vehicle.frontTrackWidth, TRACK_WIDTH);
  assert.equal(invalid.vehicle.rearTrackWidth, TRACK_WIDTH);
  assert.equal(invalid.vehicle.wheelRadius, WHEEL_RADIUS);
  assert.equal(invalid.vehicle.bodyRestHeight, BODY_REST_HEIGHT);
});

test('The downloaded TRX keeps unequal axle tracks and a flexible antenna anchored to its own roof', () => {
  const vehicle = TRX_VEHICLE_PROFILE;
  const car = new RcPhysics(() => 0, { vehicle });
  const segmentLength = vehicle.antennaLength / 10;
  assert.ok(Object.isFrozen(car.vehicle.antennaBase));
  car.state.wheels.forEach((wheel, index) => {
    close(Math.abs(wheel.x), (index < 2 ? vehicle.frontTrackWidth : vehicle.rearTrackWidth) / 2);
    close(wheelWorldPosition(car, wheel).y, vehicle.wheelRadius);
  });
  assert.ok(Math.abs(car.state.wheels[2].x) > Math.abs(car.state.wheels[0].x));
  assert.deepEqual(car.state.antenna[0], vehicle.antennaBase);
  close(car.state.antenna.at(-1).y, vehicle.antennaBase.y + vehicle.antennaLength);
  simulate(car, .5, drive);
  assert.ok(car.state.antenna.at(-1).z < vehicle.antennaBase.z - .025);
  for (let i = 1; i < car.state.antenna.length; i++) {
    const a = car.state.antenna[i - 1], b = car.state.antenna[i];
    close(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), segmentLength, .007);
  }
  simulate(car, 6, { ...idle, brake: true });
  close(car.state.antenna.at(-1).x, vehicle.antennaBase.x, .008);
  close(car.state.antenna.at(-1).z, vehicle.antennaBase.z, .008);
  close(car.state.antenna.at(-1).y, vehicle.antennaBase.y + vehicle.antennaLength, .008);
  car.reset();
  assert.deepEqual(car.state.antenna[0], vehicle.antennaBase);
  close(car.state.antenna.at(-1).y, vehicle.antennaBase.y + vehicle.antennaLength);
});

test('The faster TRX reaches its increased top speed, brakes, and settles at a mouse target', () => {
  const room={minX:-1000,maxX:1000,minZ:-1000,maxZ:1000};
  const car=new RcPhysics(()=>0,{vehicle:TRX_VEHICLE_PROFILE,bounds:room,spawn:{x:0,z:0,yaw:0}});
  let peak=0;
  for(let i=0;i<1200;i++){car.step(1/120,{...drive,steer:0});peak=Math.max(peak,Math.abs(car.state.speed));}
  assert.ok(peak>MAX_SPEED*2.5,'The upgraded motor must reach more than twice the former speed');
  assert.ok(peak<=MAX_SPEED*3+1e-8,'The forward velocity cap remains bounded');
  // Four-wheel braking is now limited by tyre friction rather than a fixed
  // 39 m/s² velocity clamp. At 16 m/s the stopping time must remain below 2 s.
  simulate(car,2,{...idle,brake:true},1/120);assert.ok(Math.abs(car.state.speed)<.02,'Friction-limited brakes stop the faster car');
  car.reset(); const target={x:8,z:8};
  simulate(car,12,{...drive,target},1/120);
  assert.ok(Math.hypot(car.state.x-target.x,car.state.z-target.z)<.5,'Mouse navigation must still arrive accurately');
  assert.ok(Math.abs(car.state.speed)<.03,'A held mouse target must settle instead of orbiting');
  simulate(car,.5,{...drive,steer:0},1/120);
  assert.ok(car.state.speed>1,'Keyboard driving must release the mouse arrival latch');
  simulate(car,12,{...drive,target},1/120);
  const nextTarget={x:target.x+6,z:target.z+6};
  simulate(car,12,{...drive,target:nextTarget},1/120);
  assert.ok(Math.hypot(car.state.x-nextTarget.x,car.state.z-nextTarget.z)<.5,'A new mouse target must release the previous arrival latch');
});

test('The downloaded body footprint reaches the arena border without legacy width margins', () => {
  for (const yaw of [0, Math.PI / 2]) {
    const bounds = { minX: -3, maxX: 3, minZ: -4, maxZ: 4 };
    const car = new RcPhysics(() => 0, { bounds, vehicle: TRX_VEHICLE_PROFILE, spawn: { x: 0, z: 0, yaw } });
    const extent = yaw === 0 ? TRX_VEHICLE_PROFILE.halfWidth : TRX_VEHICLE_PROFILE.halfLength;
    car.state.x = bounds.maxX - extent + .02;
    car.state.vx = .5;
    car.step(1 / 120, idle);
    const margin = Math.abs(Math.cos(car.state.yaw)) * TRX_VEHICLE_PROFILE.halfWidth
      + Math.abs(Math.sin(car.state.yaw)) * TRX_VEHICLE_PROFILE.halfLength;
    close(car.state.x, bounds.maxX - margin);
    assert.ok(car.state.vx < 0);
  }
});

test('TRX all-wheel drive sends traction through both axles and still pulls with one axle airborne', () => {
  const options={vehicle:TRX_VEHICLE_PROFILE,bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},spawn:{x:0,z:0,yaw:0}};
  const car=new RcPhysics(()=>0,options);
  simulate(car,.5,{...drive,steer:0},1/120);
  assert.ok(car.state.wheels.every(w=>w.driveForce>0),'All four loaded tyres transmit motor force');
  for(const lifted of [[0,1],[2,3]]) {
    car.reset();
    for(const i of lifted){car.state.wheels[i].contact=false;car.state.wheels[i].load=0;}
    car.step(1/120,{...drive,steer:0});
    assert.ok(car.state.speed>0,'The remaining axle must still propel the vehicle');
    for(let i=0;i<4;i++) assert.ok(lifted.includes(i)?car.state.wheels[i].driveForce===0:car.state.wheels[i].driveForce>0);
  }
});

test('TRX keeps momentum through turns; rear handbrake locks its rotors and produces recoverable sideslip', () => {
  const options={vehicle:TRX_VEHICLE_PROFILE,bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},spawn:{x:0,z:0,yaw:0}};
  const normal=new RcPhysics(()=>0,options),drift=new RcPhysics(()=>0,options);
  for(const car of [normal,drift])simulate(car,2,{...drive,steer:0},1/120);
  const entrySpeed=normal.state.speed, rearSpin=drift.state.wheels.slice(2).map(w=>w.spin),frontSpin=drift.state.wheels[0].spin;
  simulate(normal,.65,{...drive,steer:.7},1/120);
  simulate(drift,.65,{...drive,steer:.7,handbrake:true},1/120);
  assert.ok(Math.hypot(normal.state.vx,normal.state.vz)>entrySpeed*.70,'Steering must not apply an artificial speed clamp');
  assert.ok(Math.abs(drift.state.slipAngle)>Math.abs(normal.state.slipAngle)+.04,'Rear lock must loosen the tail');
  drift.state.wheels.slice(2).forEach((wheel,i)=>{assert.equal(wheel.locked,true);close(wheel.spin,rearSpin[i]);});
  assert.ok(drift.state.wheels[0].spin>frontSpin,'Front wheels continue to roll and steer');
  assert.ok(drift.state.wheels.slice(0,2).every(w=>!w.locked));
  const slip=Math.abs(drift.state.slipAngle);
  simulate(drift,2,{...idle,steer:0},1/120);
  assert.ok(drift.state.wheels.every(w=>!w.locked),'Releasing Space restores all tyre contacts');
  assert.ok(Math.abs(drift.state.slipAngle)<slip*.6,'Grip must recover after releasing the handbrake');
});

test('TRX drift and wheel lock remain stable at 30, 60 and 144 Hz', () => {
  const frames=[30,60,144].map(hz=>{
    const car=new RcPhysics(()=>0,{vehicle:TRX_VEHICLE_PROFILE,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},spawn:{x:0,z:0,yaw:0}});
    simulate(car,1.5,{...drive,steer:0},1/hz);
    simulate(car,.6,{...drive,steer:.6,handbrake:true},1/hz);
    simulate(car,1,{...drive,steer:-.2},1/hz);
    return car.state;
  });
  for(const s of frames.slice(1)){close(s.x,frames[0].x,.09);close(s.z,frames[0].z,.09);close(s.yaw,frames[0].yaw,.045);}
});

test('The compact downloaded rig retains grounded contacts when climbing tall steps diagonally', () => {
  const terrain = (_, z) => z < -1 ? 0 : z < 0 ? .75 : z < 1 ? 1.5 : 2.25;
  for (const yaw of [-.7, .7]) {
    const frames = [];
    for (const hz of [30, 60, 120]) {
      const car = new RcPhysics(terrain, { vehicle: TRX_VEHICLE_PROFILE, spawn: { x: 0, z: -3, yaw } });
      for (let tick = 0; tick < 5 * hz; tick++) {
        car.step(1 / hz, { ...drive, steer: 0 });
        for (const wheel of car.state.wheels) {
          const p = wheelWorldPosition(car, wheel);
          assert.ok(p.y >= terrain(p.x, p.z) + car.vehicle.wheelRadius - 1e-6,
            `Downloaded profile yaw=${yaw}, hz=${hz}, tick=${tick}: the final hub cannot penetrate a tread`);
          assert.ok(Number.isFinite(wheel.load));
          assert.ok(wheel.compression >= -SUSPENSION_REBOUND_TRAVEL - 1e-8);
          assert.ok(wheel.compression <= SUSPENSION_COMPRESSION_TRAVEL + 1e-8);
        }
        assert.ok(Number.isFinite(car.state.heave) && Math.abs(car.state.heave) < .75);
      }
      assert.ok(car.state.z > 2);
      frames.push({ x: car.state.x, z: car.state.z, y: car.state.y, roll: car.state.roll });
      simulate(car, 3, { ...idle, brake: true }, 1 / hz);
      close(car.state.y, TRX_VEHICLE_PROFILE.bodyRestHeight + 2.25, .002);
      assert.ok(car.state.wheels.every(wheel => wheel.contact));
    }
    for (const frame of frames.slice(1)) for (const key of Object.keys(frame)) close(frame[key], frames[0][key], 1e-6);
  }
});

test('Acceleration loads the rear axle, braking loads the front, and damping settles the chassis', () => {
  const car = new RcPhysics();
  simulate(car, .2, drive, 1 / 120);
  const axleLoad = () => [car.state.wheels[0].load + car.state.wheels[1].load,
    car.state.wheels[2].load + car.state.wheels[3].load];
  assert.ok(axleLoad()[1] > axleLoad()[0] + .8, 'The rear springs must support acceleration weight transfer');
  assert.ok(car.state.pitch < -.03, 'The nose rises under forward acceleration');
  assert.ok(car.state.wheels[2].compression > car.state.wheels[0].compression);
  simulate(car, .4, drive, 1 / 120);
  simulate(car, .1, { ...idle, brake: true }, 1 / 120);
  assert.ok(axleLoad()[0] > axleLoad()[1] + .8, 'Braking must load the front axle');
  assert.ok(car.state.pitch > .015, 'The nose dives under braking');
  simulate(car, 3, { ...idle, brake: true });
  close(car.state.y, BODY_REST_HEIGHT, .001);
  close(car.state.pitch, 0, .001);
  for (const wheel of car.state.wheels) close(wheel.load, 1, .01);
});

test('An airborne chassis falls under gravity, has no tyre grip, and lands within suspension travel', () => {
  const car = new RcPhysics();
  car.state.y = 1.8;
  // Refresh the contact after moving the test fixture off the ground.
  car.step(1 / 120, idle);
  simulate(car, .2, { ...drive, steer: .8 }, 1 / 120);
  assert.ok(car.state.y > 1.5 && car.state.y < 1.61, 'Flight follows gravity instead of chasing average terrain');
  close(car.state.speed, 0);
  close(car.state.yaw, Math.PI / 2);
  for (const wheel of car.state.wheels) {
    assert.equal(wheel.contact, false);
    close(wheel.load, 0);
    assert.ok(wheel.compression < -.09, 'Airborne springs extend toward their rebound stops');
  }
  let landed = false, peakCompression = 0;
  for (let i = 0; i < 300; i++) {
    car.step(1 / 120, { ...idle, brake: true });
    for (const wheel of car.state.wheels) {
      const position = wheelWorldPosition(car, wheel);
      assert.ok(position.y >= WHEEL_RADIUS - .001, 'A landing must never bury a tyre in the floor');
      assert.ok(wheel.compression >= -SUSPENSION_REBOUND_TRAVEL - 1e-8);
      assert.ok(wheel.compression <= SUSPENSION_COMPRESSION_TRAVEL + 1e-8);
      peakCompression = Math.max(peakCompression, wheel.compression);
      landed ||= !!wheel.contact;
    }
  }
  assert.ok(landed);
  assert.ok(peakCompression > .06, 'Landing energy must compress the springs');
  close(car.state.y, BODY_REST_HEIGHT, .002);
  close(car.state.pitch, 0, .002);
  close(car.state.roll, 0, .002);
  assert.ok(car.state.wheels.every(wheel => wheel.contact));
});

test('Tyres climb a staircase and settle on its landing without tunnelling or launching', () => {
  const stairHeight = (x, z) => z <= 0 ? 0 : Math.min(.4, Math.floor(z / .4) * .08);
  const car = new RcPhysics(stairHeight, { spawn: { x: 0, z: -1, yaw: 0 } });
  let maxHeave = 0;
  for (let i = 0; i < 360; i++) {
    car.step(1 / 120, { ...drive, throttle: .6 });
    maxHeave = Math.max(maxHeave, Math.abs(car.state.heave));
    for (const wheel of car.state.wheels) {
      const position = wheelWorldPosition(car, wheel);
      assert.ok(position.y >= stairHeight(position.x, position.z) + WHEEL_RADIUS - .004,
        'The rendered wheel centre must remain above each step');
      assert.ok(wheel.compression >= -SUSPENSION_REBOUND_TRAVEL - 1e-8);
      assert.ok(wheel.compression <= SUSPENSION_COMPRESSION_TRAVEL + 1e-8);
    }
  }
  assert.ok(car.state.z > 3, 'The truck must reach the upper landing');
  assert.ok(maxHeave < .16, 'Small risers should not launch the whole vehicle');
  simulate(car, 2, { ...idle, brake: true });
  close(car.state.y, BODY_REST_HEIGHT + .4, .002);
  close(car.state.pitch, 0, .002);
});

test('Diagonal tall-stair contacts use the final rendered hub positions at 30, 60 and 120 Hz', () => {
  const terrain = (_, z) => z < -1 ? 0 : z < 0 ? .75 : z < 1 ? 1.5 : 2.25;
  const results = new Map();
  for (const yaw of [0, -.7, .7]) {
    const frames = [];
    for (const hz of [30, 60, 120]) {
      const car = new RcPhysics(terrain, { spawn: { x: 0, z: -3, yaw } });
      let maxHeave = 0;
      for (let tick = 0; tick < 5 * hz; tick++) {
        car.step(1 / hz, { ...drive, steer: 0 });
        const s = car.state;
        maxHeave = Math.max(maxHeave, Math.abs(s.heave));
        for (const value of Object.values(s)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
        for (const [index, wheel] of s.wheels.entries()) {
          // Use the actual renderer transform, independently of the solver's
          // formulas. Pitch/roll and hub travel can move contact across a riser.
          const centre = new THREE.Vector3(wheel.x, wheel.height, wheel.z)
            .applyEuler(new THREE.Euler(s.pitch, 0, s.roll))
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
            .add(new THREE.Vector3(s.x, s.y, s.z));
          const clearance = centre.y - terrain(centre.x, centre.z) - car.vehicle.wheelRadius;
          assert.ok(clearance >= -1e-6,
            `yaw=${yaw}, hz=${hz}, tick=${tick}, wheel=${index}: final clearance ${clearance}`);
          for (const value of Object.values(wheel)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
          assert.ok(wheel.compression >= -SUSPENSION_REBOUND_TRAVEL - 1e-8);
          assert.ok(wheel.compression <= SUSPENSION_COMPRESSION_TRAVEL + 1e-8);
        }
      }
      assert.ok(car.state.z > 2, 'All headings must reach the upper landing');
      assert.ok(maxHeave < .6, 'A tall riser must not inject an unbounded spring stroke or launch energy');
      frames.push({ x: car.state.x, z: car.state.z, y: car.state.y,
        yaw: car.state.yaw, pitch: car.state.pitch, roll: car.state.roll });
      simulate(car, 3, { ...idle, brake: true }, 1 / hz);
      close(car.state.y, BODY_REST_HEIGHT + 2.25, .001);
      close(car.state.pitch, 0, .001);
      close(car.state.roll, 0, .001);
      assert.ok(car.state.wheels.every(wheel => wheel.contact), 'Contacts settle without stair-edge chatter');
      for (const wheel of car.state.wheels) close(wheel.load, 1, .01);
    }
    for (const frame of frames.slice(1)) for (const key of Object.keys(frame)) close(frame[key], frames[0][key], 1e-6);
    results.set(yaw, frames[0]);
  }
  close(results.get(-.7).x, -results.get(.7).x);
  close(results.get(-.7).z, results.get(.7).z);
  close(results.get(-.7).y, results.get(.7).y);
  close(results.get(-.7).roll, -results.get(.7).roll);
});

test('Ackermann steers the inside tyre farther and shares a turning centre in both directions', () => {
  for (const reverse of [false, true]) {
    const car = new RcPhysics();
    simulate(car, .6, { ...drive, steer: .7, reverse });
    const [left, right, rearLeft, rearRight] = car.state.wheels;
    assert.ok(right.steer > left.steer && left.steer > 0);
    close(WHEEL_BASE / Math.tan(left.steer) + left.x,
      WHEEL_BASE / Math.tan(right.steer) + right.x);
    close(rearLeft.steer, 0);
    close(rearRight.steer, 0);
  }
  const leftTurn = new RcPhysics();
  simulate(leftTurn, .6, { ...drive, steer: -.7 });
  assert.ok(leftTurn.state.wheels[0].steer < leftTurn.state.wheels[1].steer);
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
  close(car.state.antenna.at(-1).y, ANTENNA_BASE.y + 1.09, 0.012);
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
