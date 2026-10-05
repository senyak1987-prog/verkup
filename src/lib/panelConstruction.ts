/** Millimetres, shared by the elevation drawing and the wall-mounted 3D model. */
export function panelConstruction(size: number, shape: string, wallGap = 120, cornerRadius = 60) {
  const gap = Math.max(60, Math.min(400, wallGap));
  const radius = shape === "rounded" ? Math.max(0, Math.min(size / 2, cornerRadius)) : 0;
  const wallX = -size / 2 - gap;
  const armYs = [-size * 0.24, size * 0.24];
  const faceEdgeX = shape === "circle" ? -Math.sqrt((size / 2) ** 2 - armYs[0] ** 2) : -size / 2;
  return { gap, radius, wallX, armYs, armEndX: faceEdgeX + 20, armStartX: wallX + 5,
    plateThickness: 5, plateHeight: 30, plateWidth: 100, armProfile: 20, rim: 3 };
}
