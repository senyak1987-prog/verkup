export type SceneLightingState = { night: number; windows: number };

export const SCENE_LIGHTING_TIMING = {
  sceneMs: 750,
  windowsDelayMs: 950,
  windowsFadeMs: 500,
  windowsOffDelayMs: 1000,
  windowsOffMs: 400,
} as const;

function progress(elapsed: number, duration: number) {
  const t = Math.max(0, Math.min(1, elapsed / duration));
  return t * t * (3 - 2 * t);
}

/** Independent environment and interior light tracks keep interrupted transitions continuous. */
export function sceneLightingAt(from: SceneLightingState, targetNight: boolean, elapsedMs: number, reducedMotion = false): SceneLightingState {
  const target = targetNight ? 1 : 0;
  if (reducedMotion) return { night: target, windows: target };
  const scene = progress(elapsedMs, SCENE_LIGHTING_TIMING.sceneMs);
  const interior = targetNight
    ? progress(elapsedMs - SCENE_LIGHTING_TIMING.windowsDelayMs, SCENE_LIGHTING_TIMING.windowsFadeMs)
    : progress(elapsedMs - SCENE_LIGHTING_TIMING.windowsOffDelayMs, SCENE_LIGHTING_TIMING.windowsOffMs);
  return {
    night: from.night + (target - from.night) * scene,
    windows: from.windows + (target - from.windows) * interior,
  };
}

export function sceneLightingDuration(targetNight: boolean, reducedMotion = false) {
  return reducedMotion ? 0 : targetNight
    ? SCENE_LIGHTING_TIMING.windowsDelayMs + SCENE_LIGHTING_TIMING.windowsFadeMs
    : SCENE_LIGHTING_TIMING.windowsOffDelayMs + SCENE_LIGHTING_TIMING.windowsOffMs;
}
