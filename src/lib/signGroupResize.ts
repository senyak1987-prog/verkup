import { createLetterRowsLayout } from './letterRowsLayout';
import type { LetterRowsLayoutConfig } from './letterRowsLayout';
import { layoutObjectBoxes, layoutSelectionBox, layoutSelectionObjects } from './signLayoutAlignment';
import type { LayoutSelection, LayoutOffsetPatch } from './signLayoutAlignment';

export type GroupResizePatch = LayoutOffsetPatch & { letterLineHeights?: number[]; logoSizeMm?: number; letterWidth?: number };

/** Scale from the opposite corner of the drag-start snapshot, never from the previous pointer event. */
export function resizeLetterGroup(config: LetterRowsLayoutConfig, selection: LayoutSelection,
  deltaX: number, deltaY: number, savedHeights: readonly number[] = []): GroupResizePatch {
  const original = createLetterRowsLayout(config), logoEnabled = !!config.logoEnabled;
  const selected = layoutSelectionObjects(original, selection, logoEnabled);
  if (selected.length < 2 || !Number.isFinite(deltaX + deltaY)) return {};
  const bounds = layoutSelectionBox(original, selected, logoEnabled);
  // Project the top-right handle's movement onto the group diagonal. Bottom-left stays anchored.
  const requested = 1 + (deltaX * bounds.width - deltaY * bounds.height) / (bounds.width ** 2 + bounds.height ** 2);
  const heights = Array.from({ length: Math.max(3 + (config.vectorArtwork?.length ?? 0), savedHeights.length) }, (_, index) =>
    index < 3 ? (config.lineSettings.find(row => row.index === index)?.height ?? savedHeights[index] ?? 0)
      : config.vectorArtwork![index - 3].height);
  const logoSize = config.logoSizeMm ?? Math.max(100, Math.min(700, config.height * config.logoScale / 100));
  let minimum = 0, maximum = Infinity;
  for (const id of selected) {
    const index = Number(id.slice(5)), size = id === 'logo' ? logoSize : heights[index];
    minimum = Math.max(minimum, (id !== 'logo' && index >= 3 ? 1 : 100) / size);
    maximum = Math.min(maximum, 700 / size);
  }
  const factor = Math.max(minimum, Math.min(maximum, requested));
  if (Math.abs(factor - 1) < 1e-8) return {};
  const objects = layoutObjectBoxes(original, logoEnabled), anchor = { x: bounds.x, y: bounds.y + bounds.height };
  const attempt = (scale: number) => {
    const nextHeights = heights.map((height, index) => selected.includes(`line-${index}`) ? height * scale : height);
    const nextLogo = selected.includes('logo') ? logoSize * scale : logoSize;
    let nextConfig: LetterRowsLayoutConfig = { ...config, logoSizeMm: nextLogo,
      lineSettings: config.lineSettings.map(row => ({ ...row, height: nextHeights[row.index] })),
      vectorArtwork: config.vectorArtwork?.map((object, index) => ({ ...object, height: nextHeights[index + 3] })) };
    if (config.widthOverride) {
      const natural = createLetterRowsLayout({ ...nextConfig, widthOverride: 0, mountMode: 'frame' });
      nextConfig = { ...nextConfig, widthOverride: (logoEnabled ? nextLogo + config.height * .16 : 0) + natural.naturalTextWidth * original.textStretch };
    }
    const next = createLetterRowsLayout(nextConfig), nextObjects = layoutObjectBoxes(next, logoEnabled);
    const shift = { x: (next.viewWidth - original.viewWidth) / 2, y: (next.viewHeight - original.viewHeight) / 2 };
    const offsets = next.letterLineOffsets.map(offset => ({ ...offset }));
    const patch: GroupResizePatch = { letterLineHeights: nextHeights, letterLineOffsets: offsets,
      ...(logoEnabled ? { logoSizeMm: nextLogo } : {}), ...(config.widthOverride ? { letterWidth: nextConfig.widthOverride } : {}) };
    let valid = true;
    for (const { id, box } of objects) {
      const ratio = selected.includes(id) ? scale : 1;
      const desired = { x: anchor.x + (box.x - anchor.x) * ratio + shift.x,
        y: anchor.y + (box.y - anchor.y) * ratio + shift.y, width: box.width * ratio, height: box.height * ratio };
      const actual = nextObjects.find(object => object.id === id)!.box;
      // Automatic panel fitting must not distort the group or resize an unselected object.
      valid &&= Math.abs(actual.width - desired.width) < .01 && Math.abs(actual.height - desired.height) < .01;
      if (config.mountMode === 'acp') valid &&= desired.x >= next.panelBox.x + 6 - .001 && desired.y >= next.panelBox.y + 6 - .001 &&
        desired.x + desired.width <= next.panelBox.x + next.panelBox.width - 6 + .001 &&
        desired.y + desired.height <= next.panelBox.y + next.panelBox.height - 6 + .001;
      if (id === 'logo') {
        patch.logoOffsetX = desired.x - next.defaultLogoX;
        patch.logoOffsetY = desired.y - next.defaultLogoY;
      } else {
        const row = next.textRows.find(row => row.id === id)!;
        offsets[row.index] = { x: desired.x - row.defaultX - (row.inkBox.x - row.box.x),
          y: desired.y - row.defaultY - (row.inkBox.y - row.box.y) };
      }
    }
    return { patch, valid };
  };
  const result = attempt(factor);
  if (result.valid) return result.patch;
  // Stop the entire group together at the first manufacturing/panel boundary.
  let safe = 1, blocked = factor;
  for (let i = 0; i < 24; i++) { const middle = (safe + blocked) / 2;
    if (attempt(middle).valid) safe = middle; else blocked = middle; }
  return Math.abs(safe - 1) < 1e-6 ? {} : attempt(safe).patch;
}
