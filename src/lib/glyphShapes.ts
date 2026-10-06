import * as THREE from "three";
import libtess from "libtess";

// Font outlines can overlap or cross themselves (notably Playfair Display М).
// Earcut expects simple boundaries. Resolve the same nonzero fill used by SVG
// before extrusion, so internal strokes cannot create spurious solid triangles.
export function filledGlyphShapes(paths: THREE.ShapePath[]): THREE.Shape[] {
  const tess = new libtess.GluTesselator();
  const loops: number[][][] = [];
  let loop: number[][] = [];
  let failure: number | undefined;
  tess.gluTessNormal(0, 0, 1);
  tess.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_NONZERO);
  tess.gluTessProperty(libtess.gluEnum.GLU_TESS_BOUNDARY_ONLY, true);
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => { loop = []; loops.push(loop); });
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX, (point: number[]) => loop.push(point));
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (point: number[]) => point);
  tess.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (code: number) => { failure = code; });
  try {
    tess.gluTessBeginPolygon(null);
    for (const path of paths) for (const subpath of path.subPaths) {
      const points = subpath.getPoints(24);
      if (points.length < 3) continue;
      tess.gluTessBeginContour();
      for (const point of points) {
        const vertex = [point.x, point.y, 0];
        tess.gluTessVertex(vertex, vertex);
      }
      tess.gluTessEndContour();
    }
    tess.gluTessEndPolygon();
  } finally { tess.gluDeleteTess(); }
  if (failure !== undefined) throw new Error("Не удалось построить поверхность букв. Выберите другой шрифт.");
  const boundary = new THREE.ShapePath();
  for (const points of loops) {
    if (points.length < 3) continue;
    boundary.moveTo(points[0][0], points[0][1]);
    for (const point of points.slice(1)) boundary.lineTo(point[0], point[1]);
    boundary.currentPath!.closePath();
  }
  return boundary.toShapes();
}
