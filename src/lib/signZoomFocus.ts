/** Close facade framing requested for the sign preview; 100% remains the whole-model fit. */
export const FACADE_PREVIEW_ZOOM = 190;

/** Preserve the context target at 100%; then bring the sign progressively toward the centre. */
export function zoomFocusWeight(zoom: number) {
  const value = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  return 1 - 1 / (value * value);
}

/** Pixel translation applied after scaling around the viewport centre. The anchor is measured at 100%. */
export function signZoomTranslation(anchor: { x: number; y: number }, viewport: { width: number; height: number }, zoom: number) {
  const scale = Number.isFinite(zoom) ? Math.max(0, zoom) : 1;
  const weight = zoomFocusWeight(scale);
  if (!weight) return { x: 0, y: 0 };
  return { x: (viewport.width / 2 - anchor.x) * scale * weight,
    y: (viewport.height / 2 - anchor.y) * scale * weight };
}
