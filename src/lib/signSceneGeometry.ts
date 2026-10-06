import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { loadLetterContours } from "./letterContours";
import { filledGlyphShapes } from "./glyphShapes";
import { createNeonModel } from "./neonScene";
import { panelMountLayout } from "./panelConstruction";
import type { PanelMountMode } from "./panelConstruction";

type SceneColor = { value: string };
export type SignSceneBox = { x: number; y: number; width: number; height: number };
export type SignSceneProject = {
  productId: "panel" | "letters" | "neon";
  neonText?: string; neonFont?: string; neonHeight?: number; neonDiameter?: number; neonColor?: string;
  neonLetterSpacing?: number; neonLineSpacing?: number;
  neonBackerShape?: string; neonBrightness?: number; neonAlign?: string;
  lightsOn?: boolean; facadePalette?: 'stone'|'brick'|'charcoal';
  backdropImage?: string; backdropWidth?: number;
  neonBackerColor?: 'clear'|'white'|'black'; neonInstallMode?: 'standoffs'|'hanging'; neonKeepAspect?:boolean; neonTargetWidth?:number;
  neonLineFonts?: string[]; neonLineColors?:string[]; neonLineScales?:number[]; neonLineOffsets?:{x:number;y:number}[]; neonIcon?:string;
  sceneMode: "day" | "night";
  panelShape: "circle" | "square" | "rounded";
  panelSize: number;
  panelWallGap?: number;
  panelMountMode?: PanelMountMode;
  panelCornerRadius?: number;
  panelImage: string;
  panelImageScale: number;
  panelImageX: number;
  panelImageY: number;
  panelFaceColor: SceneColor;
  panelSideColor: SceneColor;
  lettersText: string;
  letterFont: string;
  letterHeight: number;
  letterDepth: number;
  letterFaceColor: SceneColor;
  letterSideColor: SceneColor;
  glowMode: "face" | "faceSide" | "faceHalo" | "halo";
  logoEnabled?: boolean;
  logoShape: "circle" | "square" | "rounded";
  logoImage: string;
  logoScale: number;
  letterOutlineEnabled: boolean;
  logoOutlineEnabled: boolean;
  outlineColor: SceneColor;
  haloBackerEnabled: boolean;
  haloBackerColor: SceneColor;
  mountMode: "wall" | "frame" | "acp";
  frameProfile: number;
  acpColor: SceneColor;
  acpWidth: number;
  acpHeight: number;
  acpDepth: number;
};
export type SignSceneLayout = {
  viewWidth: number;
  viewHeight: number;
  logoBox: SignSceneBox;
  logoCornerRadius: number;
  textX: number;
  textBaseline: number;
  textWidth?: number;
  textHeight?: number;
  textTop?: number;
  fontSize: number;
  textPathData?: string;
  textNaturalBox?: SignSceneBox;
  signBox: SignSceneBox;
  railX: number;
  railWidth: number;
  railTopY: number;
  railBottomY: number;
  railHeight: number;
  panelBox: SignSceneBox;
  panelCornerRadius: number;
  haloBackerBox: SignSceneBox;
  haloBackerRadius: number;
};

function roundedShape(width: number, height: number, radius = 0, circular = false) {
  const left = -width / 2, right = width / 2, bottom = -height / 2, top = height / 2;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const shape = new THREE.Shape();
  shape.moveTo(left + r, bottom);
  shape.lineTo(right - r, bottom);
  if (circular && r > 0) {
    shape.absarc(right - r, bottom + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(right, top - r);
    shape.absarc(right - r, top - r, r, 0, Math.PI / 2, false);
    shape.lineTo(left + r, top);
    shape.absarc(left + r, top - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(left, bottom + r);
    shape.absarc(left + r, bottom + r, r, Math.PI, Math.PI * 1.5, false);
    return shape;
  }
  shape.quadraticCurveTo(right, bottom, right, bottom + r);
  shape.lineTo(right, top - r);
  shape.quadraticCurveTo(right, top, right - r, top);
  shape.lineTo(left + r, top);
  shape.quadraticCurveTo(left, top, left, top - r);
  shape.lineTo(left, bottom + r);
  shape.quadraticCurveTo(left, bottom, left + r, bottom);
  return shape;
}

function logoShape(shapeName: string, size: number) {
  if (shapeName !== "circle") return roundedShape(size, size, shapeName === "rounded" ? size * 0.16 : 0);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, size / 2, 0, Math.PI * 2, false);
  return shape;
}

function solidMaterial(color: string, night: boolean, emissive = false) {
  const value = new THREE.Color(color);
  if (night && !emissive) value.multiplyScalar(0.55);
  const material = new THREE.MeshStandardMaterial({
    color: value, roughness: emissive ? 0.28 : 0.46, metalness: 0.08,
    emissive: emissive ? new THREE.Color(color) : new THREE.Color(0),
    emissiveIntensity: emissive ? 1.4 : 0,
  });
  material.userData.dayColor = new THREE.Color(color);
  return material;
}

export function panelCurveSegments(size: number, shape: string, radius: number) {
  const r = shape === 'circle' ? size / 2 : radius;
  if (r <= 0) return 14;
  const fullCircleSegments = Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - .025 / r)));
  // THREE samples each elliptical curve with twice curveSegments, including quarter arcs.
  return Math.max(64, Math.min(256, Math.ceil(fullCircleSegments / (shape === 'circle' ? 2 : 8))));
}

/** Smooth only adjacent side faces; cap edges and square corners keep their own normals. */
function smoothExtrudedSides(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const vertices = new Map<string, { indices: number[]; normals: Map<string, THREE.Vector3> }>();
  const coordinate = (value: number) => Math.round(value * 100000);
  for (const group of geometry.groups) if (group.materialIndex === 1) {
    for (let index = group.start; index < group.start + group.count; index++) {
      const key = [positions.getX(index), positions.getY(index), positions.getZ(index)].map(coordinate).join(':');
      let entry = vertices.get(key);
      if (!entry) { entry = { indices: [], normals: new Map() }; vertices.set(key, entry); }
      entry.indices.push(index);
      const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
      entry.normals.set([normal.x, normal.y, normal.z].map(coordinate).join(':'), normal);
    }
  }
  for (const { indices, normals: adjacent } of vertices.values()) for (const index of indices) {
    const original = new THREE.Vector3().fromBufferAttribute(normals, index), sum = new THREE.Vector3();
    for (const normal of adjacent.values()) if (normal.dot(original) > Math.SQRT1_2) sum.add(normal);
    sum.normalize(); normals.setXYZ(index, sum.x, sum.y, sum.z);
  }
  normals.needsUpdate = true;
}

function extrude(shapes: THREE.Shape | THREE.Shape[], depth: number, face: THREE.Material, side: THREE.Material,
  back: THREE.Material = face, surface: { curveSegments?: number; smoothSides?: boolean } = {}) {
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth, bevelEnabled: false, curveSegments: surface.curveSegments ?? 14, steps: 1,
  });
  const groups = geometry.groups.map((group) => ({ ...group }));
  geometry.clearGroups();
  for (const group of groups) {
    if (group.materialIndex === 0) {
      geometry.addGroup(group.start, group.count / 2, 2);
      geometry.addGroup(group.start + group.count / 2, group.count / 2, 0);
    } else geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  if (surface.smoothSides) smoothExtrudedSides(geometry);
  const mesh = new THREE.Mesh(geometry, [face, side, back]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function contour(mesh: THREE.Mesh, color: string) {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 35),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.86 }));
  mesh.add(edges);
}

async function imageTexture(source: string, scale = 100, x = 0, y = 0) {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить изображение.");
  const size = 1024 * scale / 100;
  const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const imageWidth = image.naturalWidth * ratio, imageHeight = image.naturalHeight * ratio;
  context.drawImage(image, (1024 - imageWidth) / 2 + x * 10.24,
    (1024 - imageHeight) / 2 + y * 10.24, imageWidth, imageHeight);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

async function applyArtwork(mesh: THREE.Mesh, shape: THREE.Shape, source: string, size: number,
  depth: number, night: boolean, faceLit: boolean, scale = 100, x = 0, y = 0, bothSides = false, curveSegments = 24) {
  if (!source) return;
  const texture = await imageTexture(source, scale, x, y);
  const geometry = new THREE.ShapeGeometry(shape, curveSegments);
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++)
    uv.setXY(index, positions.getX(index) / size + 0.5, positions.getY(index) / size + 0.5);
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true,
    roughness: 0.38, metalness: 0, color: night && !faceLit ? "#48515e" : "#ffffff",
    emissive: faceLit ? "#ffffff" : "#000000", emissiveMap: faceLit ? texture : null,
    emissiveIntensity: faceLit ? 1.1 : 0, depthWrite: false, polygonOffset: true,
    polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const image = new THREE.Mesh(geometry, material);
  image.position.z = depth + 0.35;
  image.name = "front-artwork";
  mesh.add(image);
  if (bothSides) {
    const back = new THREE.Mesh(geometry, material);
    back.rotation.y = Math.PI;
    back.position.z = -0.35;
    back.name = "back-artwork";
    mesh.add(back);
  }
}

function addDimension(group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3,
  label: string, labelPosition: THREE.Vector3, scale: number, night: boolean) {
  const direction = end.clone().sub(start).normalize();
  const tick = new THREE.Vector3(-direction.y + direction.z * 0.6, direction.x, -direction.x * 0.4)
    .normalize().multiplyScalar(Math.max(8, scale * 0.018));
  const points = [start, end, start.clone().sub(tick), start.clone().add(tick),
    end.clone().sub(tick), end.clone().add(tick)];
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: night ? "#c3d0d9" : "#77838a", transparent: true, opacity: 0.8 }));
  group.add(line);
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.font = "500 42px Arial, sans-serif";
  canvas.width = Math.ceil(context.measureText(label).width + 24);
  context.font = "500 42px Arial, sans-serif";
  context.textAlign = "center"; context.textBaseline = "middle";
  context.fillStyle = night ? "#dce4e7" : "#47535b";
  context.fillText(label, canvas.width / 2, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.position.copy(labelPosition);
  const labelHeight = Math.max(scale * 0.07, 20);
  sprite.userData.labelAspect = canvas.width / canvas.height;
  sprite.userData.labelHeight = labelHeight;
  sprite.scale.set(labelHeight * sprite.userData.labelAspect, labelHeight, 1);
  group.add(sprite);
}

type GlyphData = { pathData: string; box: { x1: number; y1: number; x2: number; y2: number }; shapes: THREE.Shape[] };
const glyphCache = new Map<string, GlyphData>();
async function glyphData(project: SignSceneProject, layout: SignSceneLayout): Promise<GlyphData> {
  const contours = layout.textPathData && layout.textNaturalBox
    ? { pathData: layout.textPathData, mainBox: layout.textNaturalBox }
    : await loadLetterContours(project.letterFont, project.lettersText);
  const box = contours.mainBox;
  const key = contours.pathData + JSON.stringify(box);
  const cached = glyphCache.get(key); if (cached) return cached;
  const data = new SVGLoader().parse('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="' + contours.pathData + '" /></svg>');
  const result = { pathData: contours.pathData, box: { x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y + box.height },
    shapes: filledGlyphShapes(data.paths) };
  if (glyphCache.size >= 24) glyphCache.delete(glyphCache.keys().next().value!);
  glyphCache.set(key, result);
  return result;
}

function lightProjection(project: SignSceneProject, layout: SignSceneLayout,
  glyph: GlyphData, textWidth: number, textHeight: number, textTop: number, color: string, blur: number) {
  const padding = project.letterHeight * 0.25;
  const worldWidth = layout.signBox.width + padding * 2;
  const worldHeight = layout.signBox.height + padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.max(128, Math.min(1024, Math.round(1024 * worldHeight / worldWidth)));
  const context = canvas.getContext("2d")!;
  const xScale = canvas.width / worldWidth, yScale = canvas.height / worldHeight;
  const box = glyph.box;
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = blur * Math.min(xScale, yScale);
  context.save();
  context.translate((layout.textX - layout.signBox.x + padding) * xScale,
    (textTop - layout.signBox.y + padding) * yScale);
  context.scale(textWidth / Math.max(1, box.x2 - box.x1) * xScale,
    textHeight / Math.max(1, box.y2 - box.y1) * yScale);
  context.translate(-box.x1, -box.y1);
  context.fill(new Path2D(glyph.pathData));
  context.restore();
  if (project.logoEnabled !== false && layout.logoBox.width > 0) {
    const logo = layout.logoBox;
    const x = (logo.x - layout.signBox.x + padding) * xScale;
    const y = (logo.y - layout.signBox.y + padding) * yScale;
    context.beginPath();
    if (project.logoShape === "circle") context.ellipse(x + logo.width * xScale / 2,
      y + logo.height * yScale / 2, logo.width * xScale / 2, logo.height * yScale / 2, 0, 0, Math.PI * 2);
    else context.roundRect(x, y, logo.width * xScale, logo.height * yScale,
      project.logoShape === "rounded" ? layout.logoCornerRadius * Math.min(xScale, yScale) : 0);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldWidth, worldHeight),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  mesh.renderOrder = 2;
  return mesh;
}

export async function buildSignModel(project: SignSceneProject, layout: SignSceneLayout,
  width: number, height: number, depth: number, showDimensions: boolean) {
  const group = new THREE.Group();
  group.userData.productId = project.productId;
  const night = project.sceneMode === "night";
  const modelDepth = Math.max(1, project.productId === "letters" ? project.letterDepth : depth);
  const faceLit = night && (project.productId === "panel" || project.glowMode !== "halo");
  const sideLit = night && project.productId === "letters" && project.glowMode === "faceSide";
  const haloLit = night && (project.glowMode === "faceHalo" || project.glowMode === "halo");
  const faceColor = project.productId === "panel" ? project.panelFaceColor.value : project.letterFaceColor.value;
  const sideColor = project.productId === "panel" ? project.panelSideColor.value : project.letterSideColor.value;
  const face = solidMaterial(faceColor, night, faceLit);
  const side = solidMaterial(sideColor, night, sideLit);
  if (sideLit) {
    side.emissive.set(sideColor).lerp(new THREE.Color(faceColor), 0.78);
    side.emissiveIntensity = 3.4;
    side.metalness = 0.02;
  }
  const dimensionGroup = new THREE.Group();
  dimensionGroup.name = "dimensions";
  const dimensionScale = Math.max(150, height);
  try {
    if (project.productId === "neon") {
      const neon = createNeonModel(project, width, height); group.add(neon);
      if (showDimensions) {
        const offset = Math.max(55, height * .2), z = 35;
        addDimension(dimensionGroup, new THREE.Vector3(-width/2,-height/2-offset,z), new THREE.Vector3(width/2,-height/2-offset,z), Math.round(width)+" мм", new THREE.Vector3(0,-height/2-offset*1.5,z), dimensionScale,night);
        addDimension(dimensionGroup, new THREE.Vector3(-width/2-offset,-height/2,z), new THREE.Vector3(-width/2-offset,height/2,z), Math.round(height)+" мм", new THREE.Vector3(-width/2-offset*1.8,0,z),dimensionScale*.85,night);
      }
      face.dispose(); side.dispose();
    } else if (project.productId === "panel") {
      const size = project.panelSize;
      const mount = panelMountLayout(size, project.panelShape, project.panelWallGap, project.panelCornerRadius,
        modelDepth, project.panelMountMode ?? 'wall');
      group.userData.panelMount = mount;
      const curveSegments = panelCurveSegments(size, project.panelShape, mount.radius);
      const panelSurface = { curveSegments, smoothSides: true };
      face.roughness = .26; face.metalness = .02; face.envMapIntensity = .5;
      side.roughness = .36; side.metalness = .22; side.envMapIntensity = .7;
      const shape = project.panelShape === "circle" ? logoShape("circle", size) : roundedShape(size, size, mount.radius, true);
      const panel = extrude(shape, modelDepth, face, side, face, panelSurface);
      panel.name = "panel-body";
      group.add(panel);
      await applyArtwork(panel, shape, project.panelImage, size, modelDepth, night, faceLit,
        project.panelImageScale, project.panelImageX, project.panelImageY, true, curveSegments);
      const inner = project.panelShape === "circle" ? logoShape("circle", size - mount.rim * 2)
        : roundedShape(size - mount.rim * 2, size - mount.rim * 2, Math.max(0, mount.radius - mount.rim), true);
      const ring = shape.clone();
      ring.holes.push(new THREE.Path(inner.getPoints(curveSegments)));
      for (const z of [-0.6, modelDepth - 1]) {
        const rim = extrude(ring, 1.6, side, side, side, panelSurface);
        rim.position.z = z; rim.name = "panel-rim"; group.add(rim);
      }
      const steel = new THREE.MeshStandardMaterial({ color: night ? "#35414a" : "#34414a", metalness: 0.65, roughness: 0.4 });
      const addBar = (start: number[], end: number[], name: string) => {
        const from = new THREE.Vector3().fromArray(start), to = new THREE.Vector3().fromArray(end), direction = to.clone().sub(from);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(direction.length(), mount.armProfile, mount.armProfile), steel);
        bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
        bar.position.copy(from.add(to).multiplyScalar(.5));
        bar.name = name; bar.castShadow = true; group.add(bar);
      };
      for (const arm of mount.arms) addBar(arm.start, arm.end, 'bracket-arm');
      for (const tie of mount.ties) addBar(tie.start, tie.end, 'corner-bracket-tie');
      for (const mountingPlate of mount.plates) {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(mount.plateThickness, mount.plateHeight, mount.plateWidth), steel);
        const normal = new THREE.Vector3(...mountingPlate.normal);
        plate.rotation.y = Math.atan2(-normal.z, normal.x);
        plate.position.set(...mountingPlate.center);
        plate.name = "wall-mount-plate"; plate.userData.mountWall = mountingPlate.wall;
        plate.castShadow = true; group.add(plate);
        const across = new THREE.Vector3(-normal.z, 0, normal.x);
        for (const offset of [-34, 34]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 6), steel);
          bolt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
          bolt.position.copy(plate.position).addScaledVector(normal, mount.plateThickness / 2 + 1.5).addScaledVector(across, offset);
          bolt.name = "wall-anchor"; group.add(bolt);
        }
      }
      if (showDimensions) {
        const y = -size / 2 - size * 0.15;
        addDimension(dimensionGroup, new THREE.Vector3(-size / 2, y, modelDepth + 3),
          new THREE.Vector3(size / 2, y, modelDepth + 3), size + " мм",
          new THREE.Vector3(0, y - size * 0.055, modelDepth + 3), size, night);
        addDimension(dimensionGroup, new THREE.Vector3(size / 2 + size * 0.12, -size / 2, modelDepth + 3),
          new THREE.Vector3(size / 2 + size * 0.12, size / 2, modelDepth + 3), size + " мм",
          new THREE.Vector3(size / 2 + size * 0.18, 0, modelDepth + 3), size * 0.8, night);
        addDimension(dimensionGroup, new THREE.Vector3(size / 2 + size * 0.16, size / 2, 0),
          new THREE.Vector3(size / 2 + size * 0.16, size / 2, modelDepth), Math.round(modelDepth) + " мм",
          new THREE.Vector3(size / 2 + size * 0.28, size / 2, modelDepth / 2), size * 0.65, night);
        addDimension(dimensionGroup, new THREE.Vector3(mount.wallX, size / 2 + 35, modelDepth / 2),
          new THREE.Vector3(-size / 2, size / 2 + 35, modelDepth / 2), mount.gap + (mount.mode === 'corner' ? " мм до угла" : " мм до стены"),
          new THREE.Vector3(mount.wallX + mount.gap / 2, size / 2 + 65, modelDepth / 2), size * 0.7, night);
      }
    } else {
      const glyph = await glyphData(project, layout);
      const referenceBox = project.mountMode === "acp" ? layout.panelBox : layout.signBox;
      const centerX = referenceBox.x + referenceBox.width / 2;
      const centerY = referenceBox.y + referenceBox.height / 2;
      const toX = (x: number) => x - centerX;
      const toY = (y: number) => centerY - y;
      const textWidth = layout.textWidth ?? Math.max(1, layout.signBox.x + layout.signBox.width - layout.textX);
      const textHeight = layout.textHeight ?? height;
      const textTop = layout.textTop ?? layout.textBaseline - textHeight;
      const haloMode = project.glowMode === "faceHalo" || project.glowMode === "halo";
      const rear = project.mountMode === "frame" ? 15 : haloMode ? 30 : 0;
      const backMaterial = solidMaterial(haloLit ? faceColor : sideColor, night, haloLit);
      let text: THREE.Mesh | undefined;
      const box = glyph.box;
      if (glyph.shapes.length) {
        text = extrude(glyph.shapes, modelDepth, face, side, backMaterial);
        text.geometry.scale(textWidth / Math.max(1, box.x2 - box.x1), -textHeight / Math.max(1, box.y2 - box.y1), 1);
        // Reflecting Y changes winding; restore each face before culling and lighting.
        const vertexCount = text.geometry.getAttribute("position").count;
        const reversed = new Array<number>(vertexCount);
        for (let index = 0; index < vertexCount; index += 3) {
          reversed[index] = index;
          reversed[index + 1] = index + 2;
          reversed[index + 2] = index + 1;
        }
        text.geometry.setIndex(reversed);
        text.geometry.computeVertexNormals();
        text.geometry.computeBoundingBox();
        text.position.set(toX(layout.textX) - box.x1 * textWidth / Math.max(1, box.x2 - box.x1), toY(layout.textBaseline), rear);
        text.name = "extruded-letter-contours";
        if (project.letterOutlineEnabled) contour(text, project.outlineColor.value);
        group.add(text);
      }
      if (project.logoEnabled !== false && layout.logoBox.width > 0) {
        const shape = logoShape(project.logoShape, layout.logoBox.width);
        // An even sample count also includes the circle's four cardinal points exactly.
        const curveSegments = Math.ceil(panelCurveSegments(layout.logoBox.width, project.logoShape, layout.logoCornerRadius) / 2) * 2;
        const logo = extrude(shape, modelDepth, face, side, backMaterial, { curveSegments, smoothSides: true });
        logo.position.set(toX(layout.logoBox.x + layout.logoBox.width / 2),
          toY(layout.logoBox.y + layout.logoBox.height / 2), rear);
        logo.name = "extruded-logo";
        if (project.logoOutlineEnabled) contour(logo, project.outlineColor.value);
        group.add(logo);
        await applyArtwork(logo, shape, project.logoImage, layout.logoBox.width, modelDepth, night, faceLit,
          100, 0, 0, false, curveSegments);
      }
      if (project.mountMode === "frame") {
        const steel = new THREE.MeshStandardMaterial({ color: night ? "#919da5" : "#727e85",
          metalness: night ? 0.32 : 0.7, roughness: night ? 0.55 : 0.4 });
        for (const y of [layout.railTopY, layout.railBottomY]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(layout.railWidth, 15, 15), steel);
          rail.position.set(toX(layout.railX + layout.railWidth / 2), toY(y), 7.5);
          rail.castShadow = true; rail.receiveShadow = true;
          rail.name = "frame-15x15mm"; group.add(rail);
        }
      } else if (project.mountMode === "acp") {
        const panelShape = roundedShape(layout.panelBox.width, layout.panelBox.height, layout.panelCornerRadius);
        const backer = extrude(panelShape, project.acpDepth, solidMaterial(project.acpColor.value, night), solidMaterial(project.acpColor.value, night));
        backer.position.set(toX(layout.panelBox.x + layout.panelBox.width / 2),
          toY(layout.panelBox.y + layout.panelBox.height / 2), -project.acpDepth);
        backer.name = "acp-box"; group.add(backer);
      }
      if (project.haloBackerEnabled && project.mountMode === "wall" &&
        (project.glowMode === "faceHalo" || project.glowMode === "halo")) {
        const backerShape = roundedShape(layout.haloBackerBox.width, layout.haloBackerBox.height, layout.haloBackerRadius);
        const material = solidMaterial(project.haloBackerColor.value, night);
        const backer = extrude(backerShape, 3, material, material);
        backer.position.set(toX(layout.haloBackerBox.x + layout.haloBackerBox.width / 2),
          toY(layout.haloBackerBox.y + layout.haloBackerBox.height / 2), 0.2);
        group.add(backer);
      }
      if (haloLit) {
        const halo = lightProjection(project, layout, glyph, textWidth, textHeight, textTop, faceColor, height * 0.10);
        halo.position.x = toX(layout.signBox.x + layout.signBox.width / 2); halo.position.y = toY(layout.signBox.y + layout.signBox.height / 2);
        halo.position.z = project.haloBackerEnabled && project.mountMode === "wall" ? 3.8 : 0.4;
        (halo.material as THREE.MeshBasicMaterial).opacity = 1;
        halo.name = "rear-halo-projection"; group.add(halo);
      }
      if (faceLit) {
        const aura = lightProjection(project, layout, glyph, textWidth, textHeight, textTop, faceColor, height * 0.02);
        aura.position.x = toX(layout.signBox.x + layout.signBox.width / 2); aura.position.y = toY(layout.signBox.y + layout.signBox.height / 2);
        aura.position.z = rear + modelDepth + 0.75;
        (aura.material as THREE.MeshBasicMaterial).opacity = 0.22;
        aura.name = "face-light-aura"; group.add(aura);
      }
      if (showDimensions) {
        const halfWidth = width / 2, halfHeight = height / 2;
        const offset = Math.max(55, height * 0.2);
        const z = rear + modelDepth + 2;
        addDimension(dimensionGroup, new THREE.Vector3(-halfWidth, -halfHeight - offset, z),
          new THREE.Vector3(halfWidth, -halfHeight - offset, z), Math.round(width) + " мм",
          new THREE.Vector3(0, -halfHeight - offset * 1.35, z), dimensionScale, night);
        addDimension(dimensionGroup, new THREE.Vector3(-halfWidth - offset, -halfHeight, z),
          new THREE.Vector3(-halfWidth - offset, halfHeight, z), Math.round(height) + " мм",
          new THREE.Vector3(-halfWidth - offset * 1.8, 0, z), dimensionScale * 0.85, night);
        const constructionBack = rear;
        const constructionFront = rear + modelDepth;
        addDimension(dimensionGroup, new THREE.Vector3(halfWidth + offset, halfHeight, constructionBack),
          new THREE.Vector3(halfWidth + offset, halfHeight, constructionFront), Math.round(constructionFront - constructionBack) + " мм",
          new THREE.Vector3(halfWidth + offset * 1.65, halfHeight, (constructionBack + constructionFront) / 2), dimensionScale * 0.65, night);
      }
    }
    if (showDimensions) group.add(dimensionGroup);
    group.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.material) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const lit = material as THREE.MeshStandardMaterial;
        if (lit.emissive) { material.userData.maxEmission = lit.emissiveIntensity; material.userData.dayColor ??= lit.color.clone(); }
        if (child.name === 'rear-halo-projection' || child.name === 'face-light-aura') material.userData.lightOpacity = material.opacity;
      }
    });
    return group;
  } catch (error) {
    disposeSignObject(group);
    face.dispose(); side.dispose();
    disposeSignObject(dimensionGroup);
    throw error;
  }
}

export function disposeSignObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const drawable = child as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  object.clear();
}

export function applySignLighting(group: THREE.Object3D, night: number, lightsOn = true, windowLight = night) {
  const on = lightsOn ? 1 : 0;
  group.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const lit = material as THREE.MeshStandardMaterial;
      if (lit.emissive) {
        const delay = Math.min(material.userData.windowIndex ?? 0, 7) * .035;
        const localWindowLight = Math.max(0, Math.min(1, (windowLight - delay) / (1 - delay)));
        lit.emissiveIntensity = material.userData.windowLight
          ? (material.userData.maxWindowEmission ?? material.userData.maxEmission ?? 0) * localWindowLight
          : material.userData.facadeEmission
          ? (material.userData.maxEmission ?? 0) * night
          : material.userData.neonEmission !== undefined
            ? material.userData.neonEmission * (.35 + .65 * night) * on
            : (material.userData.maxEmission ?? 0) * (.02 + .98 * night) * on;
      }
      if (material.userData.dayColor && lit.color) {
        lit.color.copy(material.userData.dayColor);
        if (material.userData.windowLight && material.userData.nightColor) lit.color.lerp(material.userData.nightColor, night);
        else lit.color.multiplyScalar(1 - night * (material.userData.photoBackdrop ? .7 : .28));
      }
      if (material.userData.windowLight) {
        const day = material.userData.dayEnvIntensity ?? 1, dark = material.userData.nightEnvIntensity ?? .3;
        lit.envMapIntensity = day + (dark - day) * night;
      }
      if (material.userData.lightOpacity !== undefined) material.opacity = material.userData.lightOpacity * night * on;
      if (material.userData.neonCore) material.opacity = on * (.25 + night * .55) * (material.userData.neonBrightness??1);
      if (material.userData.neonAura) material.opacity = night * .055 * on;
      if (child instanceof THREE.Sprite) (material as THREE.SpriteMaterial).color.set('#45515e').lerp(new THREE.Color('#ffffff'), night);
    }
  });
}
