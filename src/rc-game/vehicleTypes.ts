import type * as THREE from 'three';

/** Arena-local metres, after the downloaded mesh's uniform normalization. */
export interface RcVehiclePhysicsProfile {
  wheelBase: number;
  maxSpeed?: number;
  handling?: 'rally';
  trackWidth: number;
  frontTrackWidth?: number;
  rearTrackWidth?: number;
  wheelRadius: number;
  bodyRestHeight: number;
  halfWidth?: number;
  halfLength?: number;
  antennaBase?: { x: number; y: number; z: number };
  antennaLength?: number;
  /** Upper damper mount relative to the sprung chassis. */
  mountY?: number;
}

export interface RcVehicleProfile extends RcVehiclePhysicsProfile {
  /** Uniform scale from the prepared asset to arena-local metres. */
  modelScale?: number;
  antennaRadius?: number;
  antennaTipRadius?: number;
  antennaMountScale?: number;
  halfWidth: number;
  halfLength: number;
  halfHeight: number;
  centerOffset: number;
}

/** Rotor order follows runtime coordinates, independently of source-side names. */
export interface RcVehicleRig {
  body: THREE.Group;
  rotors: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  setColor(hex: string): void;
  dispose(): void;
}
