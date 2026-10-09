import type { RcVehicleProfile } from './vehicleTypes';

/** Measured from the prepared two-metre asset; the playable truck is twice as large. */
export const TRX_VEHICLE_PROFILE: Readonly<RcVehicleProfile> = Object.freeze({
  modelScale: 2,
  maxSpeed: 5.5 * 3,
  handling: 'rally',
  wheelBase: 1.2428678456967728 * 2,
  trackWidth: .6332226111313857 * 2,
  frontTrackWidth: .6264861862787049 * 2,
  rearTrackWidth: .6399590359840666 * 2,
  wheelRadius: .15251027420163155 * 2,
  bodyRestHeight: .40521918990619943 * 2,
  halfWidth: .42309463024139404 * 2,
  halfLength: 1.0461677312850952 * 2,
  halfHeight: .3347475528717041 * 2,
  centerOffset: -.015077710151672363 * 2,
  antennaBase: Object.freeze({ x: -.14 * 2, y: .2722931427008399 * 2, z: -.25 * 2 }),
  antennaLength: 2.7,
  antennaRadius: .003,
  antennaTipRadius: .035 / 4,
  antennaMountScale: 2 / 3,
  mountY: -.025 * 2,
});
