/** Small, renderer-independent RC vehicle simulation. Distances are metres. */
export interface Vec2 { x: number; z: number }

export interface CarInput {
  target: Vec2 | null;
  throttle: number;
  brake: boolean;
  reverse: boolean;
  /** Positive turns the front wheels right, including when reversing. */
  steer?: number;
}

export interface WheelState {
  /** Chassis-local wheel anchors. */
  x: number;
  z: number;
  /** Wheel centre relative to the chassis; positive compression is upward travel. */
  height: number;
  compression: number;
}

export interface RcState {
  x: number;
  z: number;
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  /** Signed speed along the vehicle's +Z axis. */
  speed: number;
  /** Front-wheel steering angle, in radians. */
  steer: number;
  pitch: number;
  roll: number;
  heave: number;
  wheelSpin: number;
  wheels: WheelState[];
  /** Chassis-local flexible antenna points, base first. */
  antenna: Array<{ x: number; y: number; z: number }>;
  /** Impact envelope: rises on contact and decays toward zero. */
  collision: number;
}

export const ARENA_LIMIT = 10.5;
export const WHEEL_BASE = 0.88;
export const TRACK_WIDTH = 1.16;
export const WHEEL_RADIUS = 0.19;
export const BODY_REST_HEIGHT = 0.48;
export const MAX_SPEED = 5.5;
export const ANTENNA_BASE = { x: -0.12, y: 0.36, z: -0.40 };

const MAX_STEER = 0.56;
const MAX_STEP = 1 / 120;
const REST_WHEEL_HEIGHT = WHEEL_RADIUS - BODY_REST_HEIGHT;
const ANTENNA_SEGMENTS = 10;
const ANTENNA_LENGTH = 1.09;
const ANTENNA_SEGMENT_LENGTH = ANTENNA_LENGTH / ANTENNA_SEGMENTS;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const angleDelta = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

/**
 * Forward is local +Z: world forward = (sin(yaw), cos(yaw)).
 * Internal substeps keep tyres, damped suspension and the antenna stable at 30–144 Hz.
 * `step` caps a paused-tab frame at 250 ms so resuming never launches the car.
 */
export class RcPhysics {
  readonly state: RcState;
  private terrain: (x: number, z: number) => number;
  private yawVelocity = 0;
  private verticalVelocity = 0;
  private pitchVelocity = 0;
  private rollVelocity = 0;
  private wheelVelocities = [0, 0, 0, 0];
  private antennaVelocities = Array.from({ length: ANTENNA_SEGMENTS + 1 }, () => ({ x: 0, y: 0, z: 0 }));

  constructor(terrain: (x: number, z: number) => number = () => 0) {
    this.terrain = terrain;
    this.state = {
      x: 0, z: 3.6, y: BODY_REST_HEIGHT, yaw: Math.PI / 2,
      vx: 0, vz: 0, speed: 0, steer: 0, pitch: 0, roll: 0,
      heave: 0, wheelSpin: 0, collision: 0,
      wheels: [
        { x: -TRACK_WIDTH / 2, z: WHEEL_BASE / 2, height: REST_WHEEL_HEIGHT, compression: 0 },
        { x: TRACK_WIDTH / 2, z: WHEEL_BASE / 2, height: REST_WHEEL_HEIGHT, compression: 0 },
        { x: -TRACK_WIDTH / 2, z: -WHEEL_BASE / 2, height: REST_WHEEL_HEIGHT, compression: 0 },
        { x: TRACK_WIDTH / 2, z: -WHEEL_BASE / 2, height: REST_WHEEL_HEIGHT, compression: 0 },
      ],
      antenna: Array.from({ length: ANTENNA_SEGMENTS + 1 }, (_, i) => ({
        x: ANTENNA_BASE.x, y: ANTENNA_BASE.y + i * ANTENNA_SEGMENT_LENGTH, z: ANTENNA_BASE.z,
      })),
    };
    this.reset();
  }

  private ground(x: number, z: number) {
    return finite(this.terrain(x, z));
  }

  reset() {
    const s = this.state;
    s.x = 0;
    s.z = 3.6;
    s.yaw = Math.PI / 2;
    s.vx = s.vz = s.speed = s.steer = s.pitch = s.roll = s.heave = s.wheelSpin = s.collision = 0;
    this.yawVelocity = this.verticalVelocity = this.pitchVelocity = this.rollVelocity = 0;
    this.wheelVelocities.fill(0);
    const grounds = this.sampleWheels();
    s.y = grounds.reduce((sum, height) => sum + height, 0) / 4 + BODY_REST_HEIGHT;
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      wheel.height = clamp(grounds[i] + WHEEL_RADIUS - s.y, REST_WHEEL_HEIGHT - 0.12, REST_WHEEL_HEIGHT + 0.14);
      wheel.compression = wheel.height - REST_WHEEL_HEIGHT;
    }
    for (let i = 0; i <= ANTENNA_SEGMENTS; i++) {
      Object.assign(s.antenna[i], { x: ANTENNA_BASE.x, y: ANTENNA_BASE.y + i * ANTENNA_SEGMENT_LENGTH, z: ANTENNA_BASE.z });
      Object.assign(this.antennaVelocities[i], { x: 0, y: 0, z: 0 });
    }
  }

  step(dt: number, input: CarInput) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const duration = Math.min(dt, 0.25);
    const steps = Math.ceil(duration / MAX_STEP);
    const h = duration / steps;
    for (let i = 0; i < steps; i++) this.integrate(h, input);
  }

  /** Apply an outward contact normal and a velocity impulse, in metres/second. */
  bump(nx: number, nz: number, impulse: number) {
    const length = Math.hypot(nx, nz);
    if (!Number.isFinite(length) || length < 1e-6) return;
    const kick = clamp(finite(impulse), 0, 12);
    nx /= length;
    nz /= length;
    const s = this.state;
    s.vx += nx * kick;
    s.vz += nz * kick;
    this.verticalVelocity += kick * 0.075;
    const localX = nx * Math.cos(s.yaw) - nz * Math.sin(s.yaw);
    const localZ = nx * Math.sin(s.yaw) + nz * Math.cos(s.yaw);
    this.rollVelocity += localX * kick * 0.3;
    this.pitchVelocity -= localZ * kick * 0.3;
    for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
      const fraction = i / ANTENNA_SEGMENTS;
      this.antennaVelocities[i].x -= localX * kick * fraction * 0.8;
      this.antennaVelocities[i].z -= localZ * kick * fraction * 0.8;
    }
    s.collision = Math.max(s.collision, Math.min(1, kick / 3));
    this.limitVelocity();
    s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
  }

  private sampleWheels() {
    const s = this.state;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    return s.wheels.map(w => this.ground(s.x + w.x * cos + w.z * sin, s.z - w.x * sin + w.z * cos));
  }

  private limitVelocity() {
    const s = this.state;
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > MAX_SPEED) {
      s.vx *= MAX_SPEED / speed;
      s.vz *= MAX_SPEED / speed;
    }
  }

  private integrate(dt: number, input: CarInput) {
    const s = this.state;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const beforeVx = s.vx, beforeVz = s.vz;
    const longitudinal = s.vx * sin + s.vz * cos;
    const lateral = s.vx * cos - s.vz * sin;
    const direction = input.reverse ? -1 : 1;
    let throttle = clamp(finite(input.throttle), 0, 1);
    let steering = clamp(finite(input.steer ?? 0), -1, 1) * MAX_STEER;
    let arriving = false;
    if (input.target && input.steer === undefined && Number.isFinite(input.target.x) && Number.isFinite(input.target.z)) {
      const dx = input.target.x - s.x, dz = input.target.z - s.z;
      const distance = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(dx, dz) + (input.reverse ? Math.PI : 0);
      const turn = angleDelta(desiredYaw - s.yaw);
      steering = clamp(turn * 1.5, -MAX_STEER, MAX_STEER);
      throttle *= clamp((distance - 0.22) / 1.4, 0, 1) * (1 - 0.4 * Math.min(1, Math.abs(turn) / Math.PI));
      const arrivalSpeed = Math.sqrt(2 * 5.5 * Math.max(0, distance - 0.25));
      arriving = distance < 2.8 && Math.abs(longitudinal) > arrivalSpeed;
      if (distance < 0.25) steering = 0;
    }
    s.steer += (steering - s.steer) * (1 - Math.exp(-11 * dt));
    const maximum = input.reverse ? 2.8 : MAX_SPEED;
    let driveAcceleration = direction * throttle * 8 * clamp(1 - direction * longitudinal / maximum, 0, 1.65);
    driveAcceleration -= longitudinal * 0.14;
    if (Math.abs(longitudinal) > 0.005) driveAcceleration -= Math.sign(longitudinal) * 0.22;
    const braking = input.brake || arriving;
    if (braking) {
      driveAcceleration = -Math.sign(longitudinal) * Math.min(Math.abs(longitudinal) / dt, input.brake ? 13 : 7.5);
    }
    // Side slip survives briefly in a sharp turn; tyres have finite grip.
    const lateralAcceleration = clamp(-lateral * (braking ? 18 : 12), -10.5, 10.5);
    s.vx += (sin * driveAcceleration + cos * lateralAcceleration) * dt;
    s.vz += (cos * driveAcceleration - sin * lateralAcceleration) * dt;
    this.limitVelocity();
    if (throttle < 0.001 && Math.hypot(s.vx, s.vz) < 0.008) s.vx = s.vz = 0;
    const desiredYawVelocity = longitudinal / WHEEL_BASE * Math.tan(s.steer) / (1 + Math.abs(longitudinal) * 0.16);
    this.yawVelocity += (desiredYawVelocity - this.yawVelocity) * (1 - Math.exp(-12 * dt));
    s.yaw = angleDelta(s.yaw + this.yawVelocity * dt);
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    // A conservative footprint keeps the body and wheels inside the arena walls.
    const wall = ARENA_LIMIT - 0.62;
    if (s.x > wall) { s.x = wall; if (s.vx > 0) this.bump(-1, 0, s.vx * 1.24); }
    if (s.x < -wall) { s.x = -wall; if (s.vx < 0) this.bump(1, 0, -s.vx * 1.24); }
    if (s.z > wall) { s.z = wall; if (s.vz > 0) this.bump(0, -1, s.vz * 1.24); }
    if (s.z < -wall) { s.z = -wall; if (s.vz < 0) this.bump(0, 1, -s.vz * 1.24); }
    s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
    s.wheelSpin += s.speed / WHEEL_RADIUS * dt;
    s.collision *= Math.exp(-5 * dt);

    const worldAx = (s.vx - beforeVx) / dt, worldAz = (s.vz - beforeVz) / dt;
    const localAx = clamp(worldAx * cos - worldAz * sin, -25, 25);
    const localAz = clamp(worldAx * sin + worldAz * cos, -25, 25);
    const grounds = this.sampleWheels();
    const averageGround = grounds.reduce((sum, ground) => sum + ground, 0) / 4;
    const frontGround = (grounds[0] + grounds[1]) / 2;
    const rearGround = (grounds[2] + grounds[3]) / 2;
    const leftGround = (grounds[0] + grounds[2]) / 2;
    const rightGround = (grounds[1] + grounds[3]) / 2;
    const targetPitch = clamp(-Math.atan2(frontGround - rearGround, WHEEL_BASE) - localAz * 0.012, -0.3, 0.3);
    const targetRoll = clamp(Math.atan2(rightGround - leftGround, TRACK_WIDTH) + localAx * 0.018, -0.32, 0.32);
    const pitchAcceleration = (targetPitch - s.pitch) * 95 - this.pitchVelocity * 11;
    const rollAcceleration = (targetRoll - s.roll) * 110 - this.rollVelocity * 12;
    const verticalAcceleration = (averageGround + BODY_REST_HEIGHT - s.y) * 115 - this.verticalVelocity * 8.5;
    this.pitchVelocity += pitchAcceleration * dt;
    this.rollVelocity += rollAcceleration * dt;
    this.verticalVelocity += verticalAcceleration * dt;
    s.pitch += this.pitchVelocity * dt;
    s.roll += this.rollVelocity * dt;
    s.y += this.verticalVelocity * dt;
    s.heave = s.y - averageGround - BODY_REST_HEIGHT;
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      const restHeight = grounds[i] + WHEEL_RADIUS - s.y - wheel.x * Math.sin(s.roll) + wheel.z * Math.sin(s.pitch);
      const targetHeight = clamp(restHeight, REST_WHEEL_HEIGHT - 0.12, REST_WHEEL_HEIGHT + 0.14);
      this.wheelVelocities[i] += ((targetHeight - wheel.height) * 520 - this.wheelVelocities[i] * 31) * dt;
      wheel.height += this.wheelVelocities[i] * dt;
      wheel.height = clamp(wheel.height, REST_WHEEL_HEIGHT - 0.125, REST_WHEEL_HEIGHT + 0.145);
      wheel.compression = wheel.height - REST_WHEEL_HEIGHT;
    }
    this.integrateAntenna(dt, localAx, localAz, verticalAcceleration, pitchAcceleration, rollAcceleration);
  }

  private integrateAntenna(dt: number, ax: number, az: number, ay: number, pitchAcceleration: number, rollAcceleration: number) {
    const points = this.state.antenna;
    const oldPoints = points.map(p => ({ ...p }));
    Object.assign(points[0], ANTENNA_BASE);
    for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
      const p = points[i], velocity = this.antennaVelocities[i];
      const t = i / ANTENNA_SEGMENTS;
      const height = t * ANTENNA_LENGTH;
      const restoring = 35 + 85 * (1 - t) ** 2;
      // The chassis frame accelerates beneath an elastic upright rod.
      velocity.x += (-(p.x - ANTENNA_BASE.x) * restoring - velocity.x * 4.4 - ax * t * 1.35 + clamp(rollAcceleration, -35, 35) * height * 0.35) * dt;
      velocity.z += (-(p.z - ANTENNA_BASE.z) * restoring - velocity.z * 4.4 - az * t * 1.35 - clamp(pitchAcceleration, -35, 35) * height * 0.35) * dt;
      velocity.y += ((ANTENNA_BASE.y + height - p.y) * 45 - velocity.y * 5.5 - clamp(ay, -25, 25) * t * 0.25) * dt;
      p.x += velocity.x * dt;
      p.y += velocity.y * dt;
      p.z += velocity.z * dt;
    }
    // Position constraints make a connected rod, rather than independent wobbling dots.
    for (let pass = 0; pass < 7; pass++) {
      for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
        const a = points[i - 1], b = points[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const distance = Math.hypot(dx, dy, dz) || ANTENNA_SEGMENT_LENGTH;
        const correction = (distance - ANTENNA_SEGMENT_LENGTH) / distance;
        const weight = i === 1 ? 1 : 0.5;
        b.x -= dx * correction * weight;
        b.y -= dy * correction * weight;
        b.z -= dz * correction * weight;
        if (i > 1) {
          a.x += dx * correction * 0.5;
          a.y += dy * correction * 0.5;
          a.z += dz * correction * 0.5;
        }
      }
    }
    for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
      const p = points[i], old = oldPoints[i], v = this.antennaVelocities[i];
      v.x = (p.x - old.x) / dt;
      v.y = (p.y - old.y) / dt;
      v.z = (p.z - old.z) / dt;
    }
  }
}
