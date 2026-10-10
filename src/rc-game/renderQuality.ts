import * as THREE from 'three';

export type RenderTier = 'high' | 'balanced' | 'low';
export const QUALITY = {
  high: { dpr: 1.75, shadow: 2048, cube: 2048 },
  balanced: { dpr: 1.25, shadow: 1024, cube: 1024 },
  low: { dpr: 1, shadow: 1024, cube: 512 },
} as const;

export function initialRenderTier(device: { coarse: boolean; cores?: number; memory?: number }): RenderTier {
  if ((device.cores && device.cores <= 4) || (device.memory && device.memory <= 4)) return 'low';
  return device.coarse ? 'balanced' : 'high';
}
export function deviceRenderTier(): RenderTier {
  return initialRenderTier({ coarse: matchMedia('(pointer: coarse)').matches,
    cores: navigator.hardwareConcurrency, memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory });
}

/** Use sustained active-game frame intervals; ignore pauses, loading and hidden tabs.
 * Only downgrade during a session, avoiding visible quality oscillation. Physics stays at 120 Hz.
 */
export function createQualityGovernor(initial: RenderTier) {
  let tier = initial, elapsed = 0, frames = 0, warmup = 1500;
  return {
    get tier() { return tier; },
    sample(ms: number): boolean {
      if (!Number.isFinite(ms) || ms <= 0 || ms > 150) { elapsed = frames = 0; return false; }
      if (warmup > 0) { warmup -= ms; return false; }
      elapsed += ms; frames++;
      if (elapsed < 3000) return false;
      const average = elapsed / frames; elapsed = frames = 0;
      if (average > 24 && tier !== 'low') { tier = tier === 'high' ? 'balanced' : 'low'; warmup = 1500; return true; }
      return false;
    },
    reset() { elapsed = frames = 0; warmup = 1500; },
  };
}

export function resizeShadow(light: THREE.DirectionalLight | THREE.PointLight, size: number) {
  if (light.shadow.mapSize.x === size) return;
  light.shadow.map?.dispose(); light.shadow.map = null;
  light.shadow.mapPass?.dispose(); light.shadow.mapPass = null;
  light.shadow.mapSize.set(size, size); light.shadow.needsUpdate = true;
}

export function applyRenderQuality(renderer: THREE.WebGLRenderer, tier: RenderTier, host: HTMLElement) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[tier].dpr));
  host.dataset.renderQuality = tier;
  host.dataset.renderPixelRatio = renderer.getPixelRatio().toFixed(2);
}
