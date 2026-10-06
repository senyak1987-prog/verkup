/** Millimetres, shared by the elevation drawing and the wall-mounted 3D model. */
export function panelConstruction(size: number, shape: string, wallGap = 120, cornerRadius = 60) {
  const gap = Math.max(60, Math.min(400, wallGap));
  const radius = shape === "rounded" ? Math.max(0, Math.min(size / 2, cornerRadius)) : 0;
  const wallX = -size / 2 - gap;
  const armYs = [-size * 0.24, size * 0.24];
  const half = size / 2, armY = Math.abs(armYs[0]);
  const faceEdgeX = shape === "circle" ? -Math.sqrt(half ** 2 - armY ** 2)
    : radius > 0 && armY > half - radius
      ? -half + radius - Math.sqrt(radius ** 2 - (armY - half + radius) ** 2) : -half;
  return { gap, radius, wallX, armYs, armEndX: faceEdgeX + 20, armStartX: wallX + 5,
    plateThickness: 5, plateHeight: 30, plateWidth: 100, armProfile: 20, rim: 3 };
}

export type PanelMountMode = 'wall' | 'corner';
export type PanelPoint = [number, number, number];
export type PanelMountPlate = { center: PanelPoint; normal: PanelPoint; wall: 'front' | 'side' };
export type PanelMountSegment = { start: PanelPoint; end: PanelPoint };

/** The housing stays in its manufacturing XY plane; this pose places it against real wall planes. */
export function panelMountLayout(size: number, shape: string, wallGap = 120, cornerRadius = 60,
  depth = 100, mode: PanelMountMode = 'wall') {
  // A diagonal housing needs enough clearance for both rear corners, including its thickness.
  const mount = panelConstruction(size, shape, mode === 'corner' ? Math.max(wallGap, depth / 2 + 20) : wallGap, cornerRadius);
  const rotationY = mode === 'corner' ? -Math.PI / 4 : -Math.PI / 2;
  const c = Math.cos(rotationY), s = Math.sin(rotationY);
  const vertex: PanelPoint = [mount.wallX, 0, depth / 2];
  const position = { x: -c * vertex[0] - s * vertex[2], y: 0, z: s * vertex[0] - c * vertex[2] };
  const plates: PanelMountPlate[] = [], arms: PanelMountSegment[] = [], ties: PanelMountSegment[] = [];
  const anchorOffset = 180, diagonal = Math.SQRT1_2;
  for (const y of mount.armYs) {
    if (mode === 'wall') {
      plates.push({ center: [mount.wallX + mount.plateThickness / 2, y, depth / 2], normal: [1, 0, 0], wall: 'front' });
      arms.push({ start: [mount.armStartX, y, depth / 2], end: [mount.armEndX, y, depth / 2] });
    } else {
      const junction: PanelPoint = [mount.wallX + 30, y, depth / 2];
      arms.push({ start: junction, end: [mount.armEndX, y, depth / 2] });
      for (const side of [1, -1]) {
        const normal: PanelPoint = [diagonal, 0, side * diagonal];
        const center: PanelPoint = [mount.wallX - anchorOffset * diagonal + mount.plateThickness / 2 * diagonal,
          y, depth / 2 + side * (anchorOffset + mount.plateThickness / 2) * diagonal];
        plates.push({ center, normal, wall: side === 1 ? 'front' : 'side' });
        const plateFront: PanelPoint = [center[0] + normal[0] * mount.plateThickness / 2, y,
          center[2] + normal[2] * mount.plateThickness / 2];
        // A short welded stand-off leaves room for the full square tube, rather than burying
        // the oblique tie's lower edge in the masonry at its attachment point.
        const standOff: PanelPoint = [plateFront[0] + normal[0] * 25, y, plateFront[2] + normal[2] * 25];
        ties.push({ start: plateFront, end: standOff }, { start: standOff, end: junction });
      }
    }
  }
  const worldPlanes = mode === 'corner'
    ? [{ id: 'front' as const, point: [0, 0, 0] as PanelPoint, normal: [0, 0, 1] as PanelPoint },
      { id: 'side' as const, point: [0, 0, 0] as PanelPoint, normal: [1, 0, 0] as PanelPoint }]
    : [{ id: 'front' as const, point: [0, 0, 0] as PanelPoint, normal: [0, 0, 1] as PanelPoint }];
  return { ...mount, size, shape, cornerRadius: mount.radius, mode, depth, rotationY, position, worldPlanes, plates, arms, ties, anchorOffset };
}

export function panelMountPoint(layout: ReturnType<typeof panelMountLayout>, point: PanelPoint): PanelPoint {
  const c = Math.cos(layout.rotationY), s = Math.sin(layout.rotationY);
  return [c * point[0] + s * point[2] + layout.position.x, point[1] + layout.position.y,
    -s * point[0] + c * point[2] + layout.position.z];
}
