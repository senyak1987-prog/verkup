export type LayoutObject = "text" | "logo" | "composition" | `line-${number}`;
export type LayoutSelection = LayoutObject | readonly LayoutObject[];
export type AlignmentAxis = "x" | "y";
export type AlignmentBox = { x: number; y: number; width: number; height: number };
export type AlignmentTextRow = {
  id: string; index: number; text: string; font: string;
  box: AlignmentBox; inkBox: AlignmentBox; pathBox: AlignmentBox;
  defaultX: number; defaultY: number;
  kind?: 'vector'; color?: string; name?: string;
};
export type AlignmentLayout = {
  viewWidth: number; viewHeight: number;
  panelBox: AlignmentBox; logoBox: AlignmentBox; textInkBox?: AlignmentBox;
  textX: number; textTop: number; textWidth: number; textHeight: number;
  defaultTextX: number; defaultTextY: number; defaultLogoX: number; defaultLogoY: number;
  textRows?: AlignmentTextRow[];
  letterLineOffsets?: { x: number; y: number }[];
};
export type LayoutOffsetPatch = Partial<{
  logoOffsetX: number; logoOffsetY: number; textOffsetX: number; textOffsetY: number;
  letterLineOffsets: { x: number; y: number }[];
}>;
type MoveOptions = { constrainToPanel?: boolean; snapTolerance?: number };

export function layoutObjectBoxes(layout: AlignmentLayout, logoEnabled: boolean): { id: LayoutObject; box: AlignmentBox }[] {
  const text = layout.textInkBox ?? { x: layout.textX, y: layout.textTop, width: layout.textWidth, height: layout.textHeight };
  const rows: { id: LayoutObject; box: AlignmentBox }[] = layout.textRows
    ? layout.textRows.map(row => ({ id: `line-${row.index}`, box: row.inkBox })) : [{ id: "text", box: text }];
  return [...rows, ...(logoEnabled ? [{ id: "logo" as const, box: layout.logoBox }] : [])]
    .filter(({ box }) => box.width > 0 && box.height > 0);
}

export function layoutSelectionObjects(layout: AlignmentLayout, selected: LayoutSelection, logoEnabled: boolean): LayoutObject[] {
  const ids = typeof selected === "string" ? [selected] : selected;
  return layoutObjectBoxes(layout, logoEnabled).filter(({ id }) => ids.includes(id) || ids.includes("composition") ||
    (id !== "logo" && ids.includes("text"))).map(({ id }) => id);
}

export function marqueeBox(start: { x: number; y: number }, end: { x: number; y: number }): AlignmentBox {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

/** Crossing an object's visible bounds is enough, in either drag direction. */
export function marqueeLayoutSelection(layout: AlignmentLayout, logoEnabled: boolean, area: AlignmentBox): LayoutObject[] {
  if (area.width <= 0 || area.height <= 0) return [];
  return layoutObjectBoxes(layout, logoEnabled).filter(({ box }) => box.x < area.x + area.width && box.x + box.width > area.x &&
    box.y < area.y + area.height && box.y + box.height > area.y).map(({ id }) => id);
}

export function layoutReferenceBox(layout: AlignmentLayout, constrainToPanel = false): AlignmentBox {
  return constrainToPanel ? layout.panelBox : { x: 0, y: 0, width: layout.viewWidth, height: layout.viewHeight };
}

export function selectedLayoutLine(layout: AlignmentLayout, selected: LayoutObject): AlignmentTextRow | undefined {
  if (!selected.startsWith("line-")) return;
  const index = Number(selected.slice(5));
  return layout.textRows?.find(row => row.index === index);
}

/** A corner handle scales a row uniformly; its font's width/height ratio stays intact. */
export function resizeLayoutLine(layout: AlignmentLayout, selected: LayoutObject, baseHeight: number,
  lineHeights: readonly number[] = [], deltaX = 0, deltaY = 0): { letterLineHeights: number[] } | undefined {
  const row = selectedLayoutLine(layout, selected); if (!row) return;
  const horizontal = Number.isFinite(deltaX) ? deltaX / Math.max(1, row.box.width) : 0;
  const vertical = Number.isFinite(deltaY) ? deltaY / Math.max(1, row.box.height) : 0;
  const ratio = 1 + (Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical);
  const previous = lineHeights[row.index] || baseHeight;
  const height = Math.max(row.kind === 'vector' ? 1 : 100, Math.min(700, Math.round(previous * ratio)));
  const length = Math.max(lineHeights.length, row.index + 1);
  const heights = Array.from({ length }, (_, index) => lineHeights[index] ?? baseHeight);
  heights[row.index] = height;
  return { letterLineHeights: heights };
}

/** Use the full visible ink, including tails and accents, rather than a font's cap-height box. */
export function layoutSelectionBox(layout: AlignmentLayout, selected: LayoutSelection, logoEnabled: boolean): AlignmentBox {
  if (typeof selected !== "string") {
    const ids = layoutSelectionObjects(layout, selected, logoEnabled);
    const boxes = layoutObjectBoxes(layout, logoEnabled).filter(({ id }) => ids.includes(id)).map(({ box }) => box);
    if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
  }
  const row = selectedLayoutLine(layout, selected); if (row) return row.inkBox;
  const text = layout.textInkBox ?? { x: layout.textX, y: layout.textTop, width: layout.textWidth, height: layout.textHeight };
  if (selected === "logo" && logoEnabled) return layout.logoBox;
  if (selected !== "composition" || !logoEnabled) return text;
  const x = Math.min(text.x, layout.logoBox.x), y = Math.min(text.y, layout.logoBox.y);
  return { x, y, width: Math.max(text.x + text.width, layout.logoBox.x + layout.logoBox.width) - x,
    height: Math.max(text.y + text.height, layout.logoBox.y + layout.logoBox.height) - y };
}

/** Translate displayed positions, not possibly saturated saved offsets. Group movement keeps every gap intact. */
export function moveLayoutSelection(layout: AlignmentLayout, selected: LayoutSelection, logoEnabled: boolean,
  deltaX: number, deltaY: number, options: MoveOptions = {}) {
  const objects = layoutSelectionObjects(layout, selected, logoEnabled);
  if (typeof selected !== "string" && !objects.length) return { patch: {} as LayoutOffsetPatch, snappedX: false, snappedY: false };
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
  if (typeof selected !== "string" || selected.startsWith("line-")) {
    const rows = (layout.textRows ?? []).filter(row => objects.includes(`line-${row.index}`));
    if (rows.length) {
      const length = Math.max(layout.letterLineOffsets?.length ?? 0,
        ...(layout.textRows ?? []).map(item => item.index + 1));
      const offsets = Array.from({ length }, (_, index) => {
        const other = layout.textRows?.find(item => item.index === index);
        return { ...(layout.letterLineOffsets?.[index] ?? (other
          ? { x: mm(other.box.x - other.defaultX), y: mm(other.box.y - other.defaultY) } : { x: 0, y: 0 })) };
      });
      // Defaults include the group translation but exclude this row's own offset.
      for (const row of rows) offsets[row.index] = { x: mm(row.box.x + dx - row.defaultX), y: mm(row.box.y + dy - row.defaultY) };
      patch.letterLineOffsets = offsets;
    }
    if (objects.includes("text")) {
      patch.textOffsetX = mm(layout.textX + dx - layout.defaultTextX);
      patch.textOffsetY = mm(layout.textTop + dy - layout.defaultTextY);
    }
    if (objects.includes("logo")) {
      patch.logoOffsetX = mm(layout.logoBox.x + dx - layout.defaultLogoX);
      patch.logoOffsetY = mm(layout.logoBox.y + dy - layout.defaultLogoY);
    }
    return { patch, snappedX: objects.length > 0 && snapX && Math.abs(box.x + box.width / 2 + dx - centerX) < .01,
      snappedY: objects.length > 0 && snapY && Math.abs(box.y + box.height / 2 + dy - centerY) < .01 };
  }
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

export function centerLayoutSelection(layout: AlignmentLayout, selected: LayoutSelection, logoEnabled: boolean,
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
