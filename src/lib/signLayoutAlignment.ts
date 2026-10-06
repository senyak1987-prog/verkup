export type LayoutObject = "text" | "logo" | "composition";
export type AlignmentAxis = "x" | "y";
export type AlignmentBox = { x: number; y: number; width: number; height: number };
export type AlignmentLayout = {
  viewWidth: number; viewHeight: number;
  panelBox: AlignmentBox; logoBox: AlignmentBox; textInkBox?: AlignmentBox;
  textX: number; textTop: number; textWidth: number; textHeight: number;
  defaultTextX: number; defaultTextY: number; defaultLogoX: number; defaultLogoY: number;
};
export type LayoutOffsetPatch = Partial<{
  logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number;
}>;
type MoveOptions = { constrainToPanel?: boolean; snapTolerance?: number };

export function layoutReferenceBox(layout: AlignmentLayout, constrainToPanel = false): AlignmentBox {
  return constrainToPanel ? layout.panelBox : { x: 0, y: 0, width: layout.viewWidth, height: layout.viewHeight };
}

/** Use the full visible ink, including tails and accents, rather than a font's cap-height box. */
export function layoutSelectionBox(layout: AlignmentLayout, selected: LayoutObject, logoEnabled: boolean): AlignmentBox {
  const text = layout.textInkBox ?? { x: layout.textX, y: layout.textTop, width: layout.textWidth, height: layout.textHeight };
  if (selected === "logo" && logoEnabled) return layout.logoBox;
  if (selected !== "composition" || !logoEnabled) return text;
  const x = Math.min(text.x, layout.logoBox.x), y = Math.min(text.y, layout.logoBox.y);
  return { x, y, width: Math.max(text.x + text.width, layout.logoBox.x + layout.logoBox.width) - x,
    height: Math.max(text.y + text.height, layout.logoBox.y + layout.logoBox.height) - y };
}

/** Translate displayed positions, not possibly saturated saved offsets. Group movement keeps every gap intact. */
export function moveLayoutSelection(layout: AlignmentLayout, selected: LayoutObject, logoEnabled: boolean,
  deltaX: number, deltaY: number, options: MoveOptions = {}) {
  const box = layoutSelectionBox(layout, selected, logoEnabled);
  const reference = layoutReferenceBox(layout, options.constrainToPanel);
  const centerX = reference.x + reference.width / 2, centerY = reference.y + reference.height / 2;
  const tolerance = Math.max(0, options.snapTolerance ?? 0);
  let dx = Number.isFinite(deltaX) ? deltaX : 0, dy = Number.isFinite(deltaY) ? deltaY : 0;
  const snapX = tolerance > 0 && Math.abs(box.x + box.width / 2 + dx - centerX) <= tolerance;
  const snapY = tolerance > 0 && Math.abs(box.y + box.height / 2 + dy - centerY) <= tolerance;
  if (snapX) dx = centerX - box.x - box.width / 2;
  if (snapY) dy = centerY - box.y - box.height / 2;
  if (options.constrainToPanel) {
    const minX = reference.x + 6 - box.x, maxX = reference.x + reference.width - 6 - box.x - box.width;
    const minY = reference.y + 6 - box.y, maxY = reference.y + reference.height - 6 - box.y - box.height;
    dx = Math.max(minX, Math.min(maxX, dx)); dy = Math.max(minY, Math.min(maxY, dy));
  }
  const mm = (value: number) => Math.round(value * 1000) / 1000;
  const patch: LayoutOffsetPatch = {};
  if (selected !== "logo" || !logoEnabled) {
    patch.textOffsetX = mm(layout.textX + dx - layout.defaultTextX);
    patch.textOffsetY = mm(layout.textTop + dy - layout.defaultTextY);
  }
  if (logoEnabled && selected !== "text") {
    patch.logoOffsetX = mm(layout.logoBox.x + dx - layout.defaultLogoX);
    patch.logoOffsetY = mm(layout.logoBox.y + dy - layout.defaultLogoY);
  }
  return { patch, snappedX: snapX && Math.abs(box.x + box.width / 2 + dx - centerX) < .01,
    snappedY: snapY && Math.abs(box.y + box.height / 2 + dy - centerY) < .01 };
}

export function centerLayoutSelection(layout: AlignmentLayout, selected: LayoutObject, logoEnabled: boolean,
  axis: AlignmentAxis, constrainToPanel = false): LayoutOffsetPatch {
  const box = layoutSelectionBox(layout, selected, logoEnabled), reference = layoutReferenceBox(layout, constrainToPanel);
  return moveLayoutSelection(layout, selected, logoEnabled,
    axis === "x" ? reference.x + reference.width / 2 - box.x - box.width / 2 : 0,
    axis === "y" ? reference.y + reference.height / 2 - box.y - box.height / 2 : 0,
    { constrainToPanel }).patch;
}

/** Restore the construction's ordinary logo/text gap, then center the actual ink and logo on both axes. */
export function packLayoutComposition(layout: AlignmentLayout, logoEnabled: boolean, constrainToPanel = false): LayoutOffsetPatch {
  const text = layoutSelectionBox(layout, "text", logoEnabled), reference = layoutReferenceBox(layout, constrainToPanel);
  const centerX = reference.x + reference.width / 2, centerY = reference.y + reference.height / 2;
  const gap = logoEnabled ? Math.max(0, layout.defaultTextX - layout.defaultLogoX - layout.logoBox.width) : 0;
  const logoWidth = logoEnabled ? layout.logoBox.width : 0;
  const left = centerX - (logoWidth + gap + text.width) / 2;
  const mm = (value: number) => Math.round(value * 1000) / 1000;
  const patch: LayoutOffsetPatch = {
    textOffsetX: mm(left + logoWidth + gap - (text.x - layout.textX) - layout.defaultTextX),
    textOffsetY: mm(centerY - text.height / 2 - (text.y - layout.textTop) - layout.defaultTextY),
  };
  if (logoEnabled) {
    patch.logoOffsetX = mm(left - layout.defaultLogoX);
    patch.logoOffsetY = mm(centerY - layout.logoBox.height / 2 - layout.defaultLogoY);
  }
  return patch;
}
