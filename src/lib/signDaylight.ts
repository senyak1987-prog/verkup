export const DAYLIGHT_LEVELS = {
  ambient: .14,
  environment: .16,
  fill: .05,
  exposure: .9,
  targetIrradiance: .65,
} as const;

type Point = { x: number; y: number; z: number };
type DaylightBounds = { center: Point; span: number };
export type DaylightMarker = { x: number; y: number };

/** Scene coordinates are millimetres, so inverse-square point intensity scales with mm². */
export function daylightSource(bounds: DaylightBounds, marker: DaylightMarker = { x: .18, y: .2 }) {
  const span = Math.max(100, Number.isFinite(bounds.span) ? bounds.span : 100);
  const x = Math.max(.06, Math.min(.94, Number.isFinite(marker.x) ? marker.x : .18));
  const y = Math.max(.06, Math.min(.94, Number.isFinite(marker.y) ? marker.y : .2));
  const center = {
    x: Number.isFinite(bounds.center.x) ? bounds.center.x : 0,
    y: Number.isFinite(bounds.center.y) ? bounds.center.y : 0,
    z: Number.isFinite(bounds.center.z) ? bounds.center.z : 0,
  };
  const offset = { x: (x - .5) * span * 4, y: (.5 - y) * span * 4, z: span * 2.8 };
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  return {
    position: { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z },
    intensity: distance ** 2 * DAYLIGHT_LEVELS.targetIrradiance,
    shadowNear: Math.max(1, span * .005),
    shadowFar: distance + span * 3,
  };
}
