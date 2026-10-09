/** Small, renderer-independent RC vehicle simulation. Distances are metres. */
import type { RcVehiclePhysicsProfile } from './vehicleTypes';

export interface Vec2 { x: number; z: number }

export interface RcArenaBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface RcPhysicsOptions {
  bounds?: RcArenaBounds;
  spawn?: { x: number; z: number; yaw: number };
  vehicle?: Partial<RcVehiclePhysicsProfile>;
  traction?: (x: number, z: number) => number;
}

export interface CarInput {
  target: Vec2 | null;
  throttle: number;
  brake: boolean;
  /** Locks only the rear axle; front tyres keep steering and driving. */
  handbrake?: boolean;
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
  /** Tyre touches the surface; a wheel at full droop may be airborne. */
  contact?: boolean;
  /** Normal load relative to one quarter of the vehicle's resting weight. */
  load?: number;
  /** Individual front-wheel angle with Ackermann steering; zero at the rear. */
  steer?: number;
  spin?: number;
  locked?: boolean;
  slip?: number;
  driveForce?: number;
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
  /** Signed body sideslip, and angular velocity, used for skid feedback. */
  slipAngle?: number;
  yawRate?: number;
}

export const ARENA_LIMIT = 10.5;
export const WHEEL_BASE = 0.88;
export const TRACK_WIDTH = 1.16;
export const WHEEL_RADIUS = 0.19;
export const BODY_REST_HEIGHT = 0.48;
export const MAX_SPEED = 5.5;
export const ANTENNA_BASE = { x: -.17, y: .64, z: -.20 };
export const ANTENNA_LENGTH = 1.09;
export const SUSPENSION_REBOUND_TRAVEL = .12;
export const SUSPENSION_COMPRESSION_TRAVEL = .14;

const MAX_STEER = 0.56;
const MAX_STEP = 1 / 120;
// Accelerations are divided by sprung mass. Each preloaded spring supports a
// quarter of the static weight; suspension never attracts the car to terrain.
const GRAVITY = 9.81;
const SPRING_RATE = 32;
const COMPRESSION_DAMPING = 2.8;
const REBOUND_DAMPING = 1.9;
const CENTRE_OF_MASS_HEIGHT = .31;
const TYRE_SAMPLE_FRACTIONS = [-.95, -.72, -.42, 0, .42, .72, .95];
const ANTENNA_SEGMENTS = 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const angleDelta = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const finite = (value: number | undefined, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Forward is local +Z: world forward = (sin(yaw), cos(yaw)).
 * Internal substeps keep tyres, damped suspension and the antenna stable at 30–144 Hz.
 * `step` caps a paused-tab frame at 250 ms so resuming never launches the car.
 */
export class RcPhysics {
  readonly state: RcState;
  readonly bounds: RcArenaBounds;
  readonly vehicle: Readonly<{
    wheelBase: number; trackWidth: number; frontTrackWidth: number; rearTrackWidth: number;
    wheelRadius: number; bodyRestHeight: number; maxSpeed: number;
    antennaBase: Readonly<{ x: number; y: number; z: number }>; antennaLength: number;
    halfWidth: number; halfLength: number; mountY: number;
  }>;
  private readonly antennaSegmentLength: number;
  private readonly restWheelHeight: number;
  private readonly minWheelHeight: number;
  private readonly maxWheelHeight: number;
  private readonly pitchInertia: number;
  private readonly rollInertia: number;
  private readonly tyreSamples: Array<{ offset: number; rise: number }>;
  private terrain: (x: number, z: number) => number;
  private spawn: { x: number; z: number; yaw: number };
  private yawVelocity = 0;
  private readonly rallyHandling: boolean;
  private readonly traction: (x: number, z: number) => number;
  private arrivedTarget: Vec2 | null = null;
  private terrainSlowTime = 0;
  private verticalVelocity = 0;
  private pitchVelocity = 0;
  private rollVelocity = 0;
  private wheelVelocities = [0, 0, 0, 0];
  private previousGrounds = [0, 0, 0, 0];
  private antennaVelocities = Array.from({ length: ANTENNA_SEGMENTS + 1 }, () => ({ x: 0, y: 0, z: 0 }));

  constructor(terrain: (x: number, z: number) => number = () => 0, options: RcPhysicsOptions = {}) {
    this.terrain = terrain;
    const profile = options.vehicle;
    this.rallyHandling = profile?.handling === 'rally';
    this.traction = options.traction ?? (() => 1.2);
    const wheelBase = clamp(finite(profile?.wheelBase, WHEEL_BASE), .25, 3);
    const trackWidth = clamp(finite(profile?.trackWidth, TRACK_WIDTH), .25, 3);
    const frontTrackWidth = clamp(finite(profile?.frontTrackWidth, trackWidth), .25, 3);
    const rearTrackWidth = clamp(finite(profile?.rearTrackWidth, trackWidth), .25, 3);
    const wheelRadius = clamp(finite(profile?.wheelRadius, WHEEL_RADIUS), .07, .7);
    this.vehicle = Object.freeze({
      wheelBase, trackWidth, frontTrackWidth, rearTrackWidth, wheelRadius,
      maxSpeed: clamp(finite(profile?.maxSpeed, MAX_SPEED), .5, 30),
      bodyRestHeight: clamp(finite(profile?.bodyRestHeight, BODY_REST_HEIGHT), .2, 1.5),
      halfWidth: clamp(finite(profile?.halfWidth, Math.max(.71, Math.max(frontTrackWidth, rearTrackWidth) / 2
        + wheelRadius * .68)), .15, 3),
      halfLength: clamp(finite(profile?.halfLength, Math.max(1.04, wheelBase / 2 + wheelRadius)), .3, 4),
      mountY: finite(profile?.mountY, -.035),
      antennaBase: Object.freeze({
        x: finite(profile?.antennaBase?.x, ANTENNA_BASE.x),
        y: finite(profile?.antennaBase?.y, ANTENNA_BASE.y),
        z: finite(profile?.antennaBase?.z, ANTENNA_BASE.z),
      }),
      antennaLength: clamp(finite(profile?.antennaLength, ANTENNA_LENGTH), .12, 6),
    });
    this.antennaSegmentLength = this.vehicle.antennaLength / ANTENNA_SEGMENTS;
    this.restWheelHeight = this.vehicle.wheelRadius - this.vehicle.bodyRestHeight;
    this.minWheelHeight = this.restWheelHeight - SUSPENSION_REBOUND_TRAVEL;
    this.maxWheelHeight = this.restWheelHeight + SUSPENSION_COMPRESSION_TRAVEL;
    this.pitchInertia = Math.max(.1, .25 * (this.vehicle.wheelBase / WHEEL_BASE) ** 2);
    this.rollInertia = Math.max(.1, .35 * (this.vehicle.trackWidth / TRACK_WIDTH) ** 2);
    this.tyreSamples = TYRE_SAMPLE_FRACTIONS.map(fraction => ({
      offset: fraction * this.vehicle.wheelRadius,
      rise: Math.sqrt(1 - fraction * fraction) * this.vehicle.wheelRadius,
    }));
    const defaults = { minX: -ARENA_LIMIT, maxX: ARENA_LIMIT, minZ: -ARENA_LIMIT, maxZ: ARENA_LIMIT };
    const requested = options.bounds ?? defaults;
    this.bounds = Object.values(requested).every(Number.isFinite)
      && requested.maxX - requested.minX > 1.5 && requested.maxZ - requested.minZ > 1.5
      ? { ...requested } : defaults;
    this.spawn = {
      x: clamp(finite(options.spawn?.x, 0), this.bounds.minX + .62, this.bounds.maxX - .62),
      z: clamp(finite(options.spawn?.z, 3.6), this.bounds.minZ + .62, this.bounds.maxZ - .62),
      yaw: finite(options.spawn?.yaw, Math.PI / 2),
    };
    this.state = {
      x: 0, z: 3.6, y: this.vehicle.bodyRestHeight, yaw: Math.PI / 2,
      vx: 0, vz: 0, speed: 0, steer: 0, pitch: 0, roll: 0,
      heave: 0, wheelSpin: 0, collision: 0,
      wheels: [
        { x: -this.vehicle.frontTrackWidth / 2, z: this.vehicle.wheelBase / 2, height: this.restWheelHeight, compression: 0 },
        { x: this.vehicle.frontTrackWidth / 2, z: this.vehicle.wheelBase / 2, height: this.restWheelHeight, compression: 0 },
        { x: -this.vehicle.rearTrackWidth / 2, z: -this.vehicle.wheelBase / 2, height: this.restWheelHeight, compression: 0 },
        { x: this.vehicle.rearTrackWidth / 2, z: -this.vehicle.wheelBase / 2, height: this.restWheelHeight, compression: 0 },
      ],
      antenna: Array.from({ length: ANTENNA_SEGMENTS + 1 }, (_, i) => ({
        x: this.vehicle.antennaBase.x,
        y: this.vehicle.antennaBase.y + i * this.antennaSegmentLength,
        z: this.vehicle.antennaBase.z,
      })),
    };
    this.reset();
  }

  private ground(x: number, z: number) {
    return finite(this.terrain(x, z));
  }

  reset() {
    const s = this.state;
    s.x = this.spawn.x;
    s.z = this.spawn.z;
    s.yaw = this.spawn.yaw;
    s.vx = s.vz = s.speed = s.steer = s.pitch = s.roll = s.heave = s.wheelSpin = s.collision = 0;
    this.yawVelocity = this.verticalVelocity = this.pitchVelocity = this.rollVelocity = 0;
    this.arrivedTarget=null;
    this.terrainSlowTime = 0;
    s.slipAngle = s.yawRate = 0;
    this.wheelVelocities.fill(0);
    this.updateWheelSteering();
    const grounds = this.sampleWheels();
    s.y = grounds.reduce((sum, height) => sum + height, 0) / 4 + this.vehicle.bodyRestHeight;
    s.y = Math.max(s.y, ...grounds.map(ground => ground + this.vehicle.wheelRadius - this.maxWheelHeight));
    this.previousGrounds = [...grounds];
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      wheel.height = clamp(grounds[i] + this.vehicle.wheelRadius - s.y, this.minWheelHeight, this.maxWheelHeight);
      wheel.compression = wheel.height - this.restWheelHeight;
      wheel.contact = grounds[i] + this.vehicle.wheelRadius - s.y >= this.minWheelHeight - .001;
      wheel.load = wheel.contact ? Math.max(0, 1 + wheel.compression * SPRING_RATE / (GRAVITY / 4)) : 0;
      wheel.steer = 0;
      wheel.spin = wheel.slip = wheel.driveForce = 0; wheel.locked = false;
    }
    for (let i = 0; i <= ANTENNA_SEGMENTS; i++) {
      Object.assign(s.antenna[i], { x: this.vehicle.antennaBase.x,
        y: this.vehicle.antennaBase.y + i * this.antennaSegmentLength, z: this.vehicle.antennaBase.z });
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

  /** Apply a contact normal and a signed velocity impulse, in metres/second. */
  bump(nx: number, nz: number, impulse: number) {
    const length = Math.hypot(nx, nz);
    if (!Number.isFinite(length) || length < 1e-6) return;
    const signedKick = clamp(finite(impulse), -12, 12);
    const kick = Math.abs(signedKick);
    const direction = Math.sign(signedKick);
    nx = nx / length * direction;
    nz = nz / length * direction;
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
    return s.wheels.map(w => {
      const localX = w.x * Math.cos(s.roll) - w.height * Math.sin(s.roll);
      const localZ = (w.x * Math.sin(s.roll) + w.height * Math.cos(s.roll)) * Math.sin(s.pitch)
        + w.z * Math.cos(s.pitch);
      const x = s.x + localX * cos + localZ * sin, z = s.z - localX * sin + localZ * cos;
      const heading = s.yaw + (w.steer ?? 0);
      const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
      // A circular tyre meets a stair edge before the axle reaches the riser.
      // Its support envelope preserves flat ground and rounds a small step.
      let centre = -Infinity;
      for (const sample of this.tyreSamples) centre = Math.max(centre,
        this.ground(x + forwardX * sample.offset, z + forwardZ * sample.offset) + sample.rise);
      return centre - this.vehicle.wheelRadius;
    });
  }

  private updateWheelSteering() {
    const s = this.state;
    const radius = Math.abs(s.steer) < 1e-5 ? Infinity : this.vehicle.wheelBase / Math.tan(s.steer);
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      wheel.steer = i < 2 ? Math.atan(this.vehicle.wheelBase / (radius - wheel.x)) : 0;
    }
  }

  private resolveSuspensionContacts(dt: number) {
    const s = this.state;
    const frameUp = Math.cos(s.roll) * Math.cos(s.pitch);
    const offsets = s.wheels.map(wheel => wheel.x * Math.sin(s.roll) * Math.cos(s.pitch)
      - wheel.z * Math.sin(s.pitch));
    const oldHeights = s.wheels.map(wheel => wheel.height);
    // An unloaded spring is advanced once per substep, never once per solver
    // iteration. Iterating a time integration would change damping with terrain.
    const freeVelocities = s.wheels.map((wheel, i) => this.wheelVelocities[i]
      + ((this.minWheelHeight - wheel.height) * 180 - this.wheelVelocities[i] * 19) * dt);
    const freeHeights = oldHeights.map((height, i) => clamp(height + freeVelocities[i] * dt,
      this.minWheelHeight, this.maxWheelHeight));
    let supports = this.sampleWheels();
    for (let pass = 0; pass < 12; pass++) {
      const freshSupports = this.sampleWheels();
      // A changed hub height moves its world X/Z on a tilted chassis. Within a
      // substep, retain the highest encountered support to avoid alternating
      // branches at a discontinuous stair edge; next substep starts afresh.
      supports = supports.map((support, i) => Math.max(support, freshSupports[i]));
      const minimumY = Math.max(...supports.map((support, i) => support + this.vehicle.wheelRadius
        - this.maxWheelHeight * frameUp - offsets[i]));
      s.y = Math.max(s.y, minimumY);
      let change = 0;
      for (let i = 0; i < s.wheels.length; i++) {
        const wheel = s.wheels[i];
        const requiredHeight = (supports[i] + this.vehicle.wheelRadius - s.y - offsets[i]) / frameUp;
        const height = requiredHeight >= this.minWheelHeight - .001
          ? clamp(requiredHeight, this.minWheelHeight, this.maxWheelHeight) : freeHeights[i];
        change = Math.max(change, Math.abs(height - wheel.height));
        wheel.height = height;
      }
      const finalSupports = this.sampleWheels();
      const newSupport = Math.max(...finalSupports.map((support, i) => support - supports[i]));
      if (change < 1e-6 && newSupport < 1e-6) break;
    }
    const grounds = this.sampleWheels();
    // A bounded solver must still obey contact on an arbitrary discontinuous
    // height field. A residual moves the chassis upward with hubs held fixed;
    // this does not alter their world X/Z and therefore cannot change branches.
    const residual = Math.max(0, ...grounds.map((ground, i) => ground + this.vehicle.wheelRadius
      - s.y - offsets[i] - s.wheels[i].height * frameUp));
    s.y += residual;
    const groundRates = grounds.map((ground, i) => clamp((ground - this.previousGrounds[i]) / dt, -4, 4));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < s.wheels.length; i++) {
        const wheel = s.wheels[i];
        const requiredHeight = (grounds[i] + this.vehicle.wheelRadius - s.y - offsets[i]) / frameUp;
        if (wheel.height < this.maxWheelHeight - .002 || requiredHeight < this.maxWheelHeight - .002) continue;
        const armRoll = (wheel.x * Math.cos(s.roll) - wheel.height * Math.sin(s.roll)) * Math.cos(s.pitch);
        const armPitch = -(wheel.x * Math.sin(s.roll) + wheel.height * Math.cos(s.roll)) * Math.sin(s.pitch)
          - wheel.z * Math.cos(s.pitch);
        const normalVelocity = this.verticalVelocity + armRoll * this.rollVelocity + armPitch * this.pitchVelocity;
        const surfaceVelocity = Math.max(0, Math.min(2, groundRates[i]));
        if (normalVelocity >= surfaceVelocity) continue;
        const impulse = (surfaceVelocity - normalVelocity)
          / (1 + armRoll * armRoll / this.rollInertia + armPitch * armPitch / this.pitchInertia);
        this.verticalVelocity += impulse;
        this.rollVelocity += impulse * armRoll / this.rollInertia;
        this.pitchVelocity += impulse * armPitch / this.pitchInertia;
      }
    }
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      const requiredHeight = (grounds[i] + this.vehicle.wheelRadius - s.y - offsets[i]) / frameUp;
      wheel.contact = requiredHeight >= this.minWheelHeight - .001 && Math.abs(requiredHeight - wheel.height) < .002;
      this.wheelVelocities[i] = wheel.contact ? (wheel.height - oldHeights[i]) / dt : freeVelocities[i];
      if (!wheel.contact) wheel.load = 0;
      if (wheel.height <= this.minWheelHeight && this.wheelVelocities[i] < 0
        || wheel.height >= this.maxWheelHeight && this.wheelVelocities[i] > 0) this.wheelVelocities[i] = 0;
      wheel.compression = wheel.height - this.restWheelHeight;
    }
    return grounds;
  }

  private limitVelocity() {
    const s = this.state;
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > this.vehicle.maxSpeed) {
      s.vx *= this.vehicle.maxSpeed / speed;
      s.vz *= this.vehicle.maxSpeed / speed;
    }
  }

  /** Four tyre contact forces, 40:60 torque split and a finite friction ellipse.
   * Yaw comes from tyre moments, so lateral velocity survives a turn or rear lock.
   */
  private integrateRallyDrive(dt: number, throttle: number, direction: number, braking: boolean,
    handbrake: boolean, maximum: number, lowGear: boolean) {
    const s = this.state, sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const forward = s.vx * sin + s.vz * cos, sideways = s.vx * cos - s.vz * sin;
    const motor = direction * throttle * (lowGear ? 8 : 8 * this.vehicle.maxSpeed / MAX_SPEED)
      * clamp(1 - direction * forward / maximum, 0, 1.65);
    const mu = clamp(finite(this.traction(s.x, s.z), 1.2), .35, 1.8);
    let ax = 0, az = 0, moment = 0;
    s.wheels.forEach((wheel, index) => {
      const front = index < 2, locked = handbrake && !front;
      const angle = front ? (wheel.steer ?? s.steer) : 0;
      const c = Math.cos(angle), sn = Math.sin(angle);
      const longitudinal = forward - this.yawVelocity * wheel.x;
      const lateral = sideways + this.yawVelocity * wheel.z;
      const rolling = longitudinal * c + lateral * sn;
      const slip = lateral * c - longitudinal * sn;
      const load = wheel.contact ? clamp(wheel.load ?? 1, 0, 2.2) : 0;
      const grip = GRAVITY * .25 * mu * load;
      let drive = braking || locked ? 0 : motor * (front ? .20 : .30);
      if (braking || locked) drive = -Math.sign(rolling) * Math.min(Math.abs(rolling) / (4 * dt), grip * (locked ? .78 : 1));
      if (lowGear && direction * forward > maximum) drive -= direction * 4.5;
      drive = clamp(drive, -grip, grip);
      // A sliding rear tyre loses most cornering authority. Power also loosens
      // the rear pair at large slip, allowing recoverable throttle oversteer.
      const sliding = locked ? .13 : (!front && Math.abs(slip) > 1 ? .80 : 1);
      const lateralLimit = grip * sliding * Math.sqrt(Math.max(.12, 1 - (drive / Math.max(grip, .001)) ** 2 * .65));
      const corner = clamp(-slip * (front ? 3.8 : 3.5), -lateralLimit, lateralLimit);
      const fx = corner * c + drive * sn, fz = drive * c - corner * sn;
      ax += fx; az += fz; moment += wheel.z * fx - wheel.x * fz;
      wheel.driveForce = drive; wheel.slip = Math.abs(slip); wheel.locked = locked;
      if (!locked) wheel.spin = (wheel.spin ?? 0) + rolling / this.vehicle.wheelRadius * dt;
    });
    if (Math.abs(forward) > .005) az -= Math.sign(forward) * (.10 + forward * forward * .004);
    // Airborne drift retains momentum; loaded tyres provide rolling resistance.
    const grip = clamp(s.wheels.reduce((sum, w) => sum + (w.contact ? 1 : 0), 0) / 4, 0, 1);
    az *= grip;
    s.vx += (sin * az + cos * ax) * dt;
    s.vz += (cos * az - sin * ax) * dt;
    const inertia = (this.vehicle.wheelBase ** 2 + this.vehicle.trackWidth ** 2) / 12 * 1.8;
    this.yawVelocity += moment / inertia * dt;
    this.yawVelocity *= Math.exp(-dt * (.28 + (Math.abs(forward) < .4 ? 4 * grip : 0)));
    this.yawVelocity = clamp(this.yawVelocity, -3.5, 3.5);
    s.yaw += this.yawVelocity * dt;
    s.yawRate = this.yawVelocity;
    s.slipAngle = Math.atan2(sideways, Math.max(.1, Math.abs(forward)));
  }

  private integrate(dt: number, input: CarInput) {
    const s = this.state;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const beforeVx = s.vx, beforeVz = s.vz;
    const longitudinal = s.vx * sin + s.vz * cos;
    const lateral = s.vx * cos - s.vz * sin;
    const direction = input.reverse ? -1 : 1;
    const speedScale=this.vehicle.maxSpeed/MAX_SPEED;
    let throttle = clamp(finite(input.throttle), 0, 1);
    let steering = clamp(finite(input.steer ?? 0), -1, 1) * MAX_STEER;
    let arriving = false;
    let targetSpeed:number|null=null;
    if (input.target && input.steer === undefined && Number.isFinite(input.target.x) && Number.isFinite(input.target.z)) {
      const dx = input.target.x - s.x, dz = input.target.z - s.z;
      const distance = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(dx, dz) + (input.reverse ? Math.PI : 0);
      const turn = angleDelta(desiredYaw - s.yaw);
      steering = clamp(turn * 1.5, -MAX_STEER, MAX_STEER);
      throttle *= clamp((distance - 0.22) / 1.4, 0, 1) * (1 - 0.4 * Math.min(1, Math.abs(turn) / Math.PI));
      const arrivalSpeed = Math.sqrt(2 * 5.5 * Math.max(0, distance - 0.25));
      arriving = distance < 2.8 && Math.abs(longitudinal) > arrivalSpeed;
      if(speedScale>1) {
        const turningSpeed=this.rallyHandling ? this.vehicle.maxSpeed * clamp(distance / 5, .08, 1)
          : this.vehicle.maxSpeed/(1+Math.abs(turn)*5);
        const stoppingAcceleration=this.rallyHandling ? 5.5 : 7.5*speedScale;
        const stoppingSpeed=Math.sqrt(2*stoppingAcceleration*Math.max(0,distance-.28));
        targetSpeed=Math.min(turningSpeed,stoppingSpeed);
        arriving=Math.abs(longitudinal)>targetSpeed+.10;
        if(this.arrivedTarget&&Math.hypot(this.arrivedTarget.x-input.target.x,this.arrivedTarget.z-input.target.z)>.20)this.arrivedTarget=null;
        if(distance<.45 && (!this.rallyHandling || Math.hypot(s.vx,s.vz)<.7))this.arrivedTarget={x:input.target.x,z:input.target.z};
        if(this.arrivedTarget){throttle=0;steering=0;arriving=true;}
      }
      if (distance < 0.25) steering = 0;
    } else this.arrivedTarget = null;
    if (this.rallyHandling) steering /= 1 + longitudinal * longitudinal * .003;
    s.steer += (steering - s.steer) * (1 - Math.exp(-11 * dt));
    this.updateWheelSteering();
    const grip = clamp(s.wheels.reduce((sum, wheel) => sum + (wheel.load ?? 1), 0) / 4, 0, 1);
    const frontGrip = clamp(((s.wheels[0].load ?? 1) + (s.wheels[1].load ?? 1)) / 2, 0, 1);
    let maximum = input.reverse ? 2.8 * speedScale : this.vehicle.maxSpeed;
    if(targetSpeed!==null)maximum=Math.max(.10,Math.min(maximum,targetSpeed));
    // The truck keeps its full speed on flat ground; tall risers are climbed in
    // low gear so suspension contacts cannot inject a high-speed launch impulse.
    const ahead=this.vehicle.wheelBase/2+this.vehicle.wheelRadius+longitudinal*longitudinal/(2*18);
    const rise=this.ground(s.x+sin*ahead*direction,s.z+cos*ahead*direction)-this.ground(s.x,s.z);
    this.terrainSlowTime = Math.max(0, this.terrainSlowTime - dt);
    if (rise > .12 || Math.max(...this.previousGrounds) - Math.min(...this.previousGrounds) > .18) this.terrainSlowTime = .8;
    const lowGear=speedScale>1&&(this.rallyHandling ? this.terrainSlowTime > 0
      : rise>.12||Math.abs(s.pitch)>.09||Math.abs(s.roll)>.12);
    if(lowGear)maximum=Math.min(maximum,4.5);
    let driveAcceleration = direction * throttle * 8 * (lowGear?1:speedScale) * clamp(1 - direction * longitudinal / maximum, 0, 1.65);
    if(lowGear&&direction*longitudinal>maximum)driveAcceleration-=direction*18;
    driveAcceleration -= longitudinal * 0.14;
    if (Math.abs(longitudinal) > 0.005) driveAcceleration -= Math.sign(longitudinal) * 0.22;
    const braking = input.brake || arriving;
    if (braking) {
      driveAcceleration = -Math.sign(longitudinal) * Math.min(Math.abs(longitudinal) / dt, (input.brake ? 13 : 7.5)*speedScale);
    }
    // Side slip survives briefly in a sharp turn; tyres have finite grip.
    driveAcceleration *= grip;
    const lateralAcceleration = clamp(-lateral * (braking ? 18 : 12), -10.5, 10.5) * grip;
    if (this.rallyHandling) {
      this.integrateRallyDrive(dt, throttle, direction, braking, !!input.handbrake, maximum, lowGear);
    } else {
      s.vx += (sin * driveAcceleration + cos * lateralAcceleration) * dt;
      s.vz += (cos * driveAcceleration - sin * lateralAcceleration) * dt;
    }
    this.limitVelocity();
    if (throttle < 0.001 && Math.hypot(s.vx, s.vz) < 0.008) s.vx = s.vz = 0;
    const desiredYawVelocity = longitudinal / this.vehicle.wheelBase * Math.tan(s.steer) / (1 + Math.abs(longitudinal) * 0.16);
    if (!this.rallyHandling) {
      this.yawVelocity += (desiredYawVelocity - this.yawVelocity) * (1 - Math.exp(-12 * frontGrip * dt));
      this.yawVelocity *= Math.exp(-.12 * (1 - frontGrip) * dt);
      s.yaw += this.yawVelocity * dt;
    }
    s.yaw = angleDelta(s.yaw);
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    // A conservative footprint keeps the body and wheels inside the arena walls.
    const bounds = this.bounds;
    const { halfWidth, halfLength } = this.vehicle;
    const marginX = Math.abs(Math.cos(s.yaw)) * halfWidth + Math.abs(Math.sin(s.yaw)) * halfLength;
    const marginZ = Math.abs(Math.sin(s.yaw)) * halfWidth + Math.abs(Math.cos(s.yaw)) * halfLength;
    if (s.x > bounds.maxX - marginX) { s.x = bounds.maxX - marginX; if (s.vx > 0) this.bump(-1, 0, s.vx * 1.24); }
    if (s.x < bounds.minX + marginX) { s.x = bounds.minX + marginX; if (s.vx < 0) this.bump(1, 0, -s.vx * 1.24); }
    if (s.z > bounds.maxZ - marginZ) { s.z = bounds.maxZ - marginZ; if (s.vz > 0) this.bump(0, -1, s.vz * 1.24); }
    if (s.z < bounds.minZ + marginZ) { s.z = bounds.minZ + marginZ; if (s.vz < 0) this.bump(0, 1, -s.vz * 1.24); }
    s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
    s.wheelSpin += s.speed / this.vehicle.wheelRadius * dt;
    if (!this.rallyHandling) s.wheels.forEach(wheel => { wheel.spin = s.wheelSpin; });
    s.collision *= Math.exp(-5 * dt);

    const worldAx = (s.vx - beforeVx) / dt, worldAz = (s.vz - beforeVz) / dt;
    const localAx = clamp(worldAx * cos - worldAz * sin, -25, 25);
    const localAz = clamp(worldAx * sin + worldAz * cos, -25, 25);
    const grounds = this.sampleWheels();
    const groundRates = grounds.map((ground, i) => clamp((ground - this.previousGrounds[i]) / dt, -4, 4));
    let verticalAcceleration = -GRAVITY;
    let pitchAcceleration = -localAz * CENTRE_OF_MASS_HEIGHT / this.pitchInertia * grip - this.pitchVelocity * .6;
    let rollAcceleration = localAx * CENTRE_OF_MASS_HEIGHT / this.rollInertia * grip - this.rollVelocity * .7;
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i];
      const frameUp = Math.cos(s.roll) * Math.cos(s.pitch);
      const offset = wheel.x * Math.sin(s.roll) * Math.cos(s.pitch) - wheel.z * Math.sin(s.pitch);
      const requiredHeight = (grounds[i] + this.vehicle.wheelRadius - s.y - offset) / frameUp;
      // A riser taller than the travel is a hard contact, not extra spring
      // stroke. Feeding penetration into the progressive spring injects energy.
      const compression = clamp(requiredHeight - this.restWheelHeight,
        -SUSPENSION_REBOUND_TRAVEL, SUSPENSION_COMPRESSION_TRAVEL);
      const armRoll = (wheel.x * Math.cos(s.roll) - wheel.height * Math.sin(s.roll)) * Math.cos(s.pitch);
      const armPitch = -(wheel.x * Math.sin(s.roll) + wheel.height * Math.cos(s.roll)) * Math.sin(s.pitch)
        - wheel.z * Math.cos(s.pitch);
      const pointVelocity = this.verticalVelocity + armRoll * this.rollVelocity + armPitch * this.pitchVelocity;
      const compressionVelocity = (groundRates[i] - pointVelocity) / frameUp;
      wheel.contact = requiredHeight >= this.minWheelHeight - .001;
      const damping = compressionVelocity >= 0 ? COMPRESSION_DAMPING : REBOUND_DAMPING;
      // Progressive jounce rubber engages over the final 35 mm of compression.
      const bumpStop = Math.max(0, compression - (SUSPENSION_COMPRESSION_TRAVEL - .035));
      const force = wheel.contact ? Math.max(0, GRAVITY / 4 + SPRING_RATE * compression
        + damping * compressionVelocity + 1900 * bumpStop * bumpStop) : 0;
      wheel.load = force / (GRAVITY / 4);
      verticalAcceleration += force;
      pitchAcceleration += force * armPitch / this.pitchInertia;
      rollAcceleration += force * armRoll / this.rollInertia;
    }
    this.pitchVelocity += pitchAcceleration * dt;
    this.rollVelocity += rollAcceleration * dt;
    this.verticalVelocity += verticalAcceleration * dt;
    s.pitch += this.pitchVelocity * dt;
    s.roll += this.rollVelocity * dt;
    s.y += this.verticalVelocity * dt;
    s.pitch = clamp(s.pitch, -.55, .55);
    s.roll = clamp(s.roll, -.6, .6);
    if (Math.abs(s.pitch) >= .55 && s.pitch * this.pitchVelocity > 0) this.pitchVelocity = 0;
    if (Math.abs(s.roll) >= .6 && s.roll * this.rollVelocity > 0) this.rollVelocity = 0;
    const resolvedGrounds = this.resolveSuspensionContacts(dt);
    const averageGround = resolvedGrounds.reduce((sum, ground) => sum + ground, 0) / 4;
    s.heave = s.y - averageGround - this.vehicle.bodyRestHeight;
    this.previousGrounds = resolvedGrounds;
    this.integrateAntenna(dt, localAx, localAz, verticalAcceleration, pitchAcceleration, rollAcceleration);
  }

  private integrateAntenna(dt: number, ax: number, az: number, ay: number, pitchAcceleration: number, rollAcceleration: number) {
    const points = this.state.antenna;
    const base = this.vehicle.antennaBase;
    const oldPoints = points.map(p => ({ ...p }));
    Object.assign(points[0], base);
    for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
      const p = points[i], velocity = this.antennaVelocities[i];
      const t = i / ANTENNA_SEGMENTS;
      const height = t * this.vehicle.antennaLength;
      const restoring = 35 + 85 * (1 - t) ** 2;
      // The chassis frame accelerates beneath an elastic upright rod.
      velocity.x += (-(p.x - base.x) * restoring - velocity.x * 4.4 - ax * t * 1.35 + clamp(rollAcceleration, -35, 35) * height * 0.35) * dt;
      velocity.z += (-(p.z - base.z) * restoring - velocity.z * 4.4 - az * t * 1.35 - clamp(pitchAcceleration, -35, 35) * height * 0.35) * dt;
      velocity.y += ((base.y + height - p.y) * 45 - velocity.y * 5.5 - clamp(ay, -25, 25) * t * 0.25) * dt;
      p.x += velocity.x * dt;
      p.y += velocity.y * dt;
      p.z += velocity.z * dt;
    }
    // Position constraints make a connected rod, rather than independent wobbling dots.
    for (let pass = 0; pass < 7; pass++) {
      for (let i = 1; i <= ANTENNA_SEGMENTS; i++) {
        const a = points[i - 1], b = points[i];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const distance = Math.hypot(dx, dy, dz) || this.antennaSegmentLength;
        const correction = (distance - this.antennaSegmentLength) / distance;
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
