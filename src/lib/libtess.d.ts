declare module "libtess" {
  class GluTesselator {
    gluTessNormal(x: number, y: number, z: number): void;
    gluTessProperty(property: number, value: number | boolean): void;
    gluTessCallback(event: number, callback: (...args: any[]) => any): void;
    gluTessBeginPolygon(data: unknown): void;
    gluTessBeginContour(): void;
    gluTessVertex(coordinates: number[], data: number[]): void;
    gluTessEndContour(): void;
    gluTessEndPolygon(): void;
    gluDeleteTess(): void;
  }
  const libtess: {
    GluTesselator: typeof GluTesselator;
    gluEnum: Record<string, number>;
    windingRule: Record<string, number>;
  };
  export default libtess;
}
