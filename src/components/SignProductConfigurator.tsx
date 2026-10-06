import { ArrowUpRight, Check, ChevronRight, Download, FolderOpen, ImagePlus, Lightbulb, Maximize, Minus, Moon, Plus, Power, RotateCcw, Save, Settings2, ShoppingCart, Sun, Type, Upload, X } from "lucide-react";
import { Component, createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { createPanelSvgMarkup, panelSvgFaceBox } from "../lib/signPanelExport";
import { panelMountLayout, isPanelCornerMount } from "../lib/panelConstruction";
import type { PanelMountMode } from "../lib/panelConstruction";
import { calculateLetterPrice, hasUnpricedSymbols, requiresFrameApproval, useSignCart } from "../lib/signCommerce";
import { systemFontAvailable } from "../lib/systemFontContours";
import { SIGN_FONTS, loadLetterContours, resolveSignFont } from "../lib/letterContours";
import type { LetterContours } from "../lib/letterContours";
import { allowedLetterDepths, normalizeLetterDepth, frameRailCenters } from "../lib/letterConstruction";
import { constrainBacker, containBox, backerLimits } from "../lib/backerConstraints";
import { createNeonDesign, neonSvg, neonRequiredBacker, neonUnsupportedCharacters } from "../lib/neonConstruction";
import { fitNeonToWidth } from "../lib/neonSizing";
import { NeonControls } from "./NeonControls";
import { NeonStudioEditor } from "./NeonStudioEditor";
import { SignLayoutEditor } from "./SignLayoutEditor";
import { SignPlacements } from "./SignPlacements";
import { SignPhotoPreview } from "./SignPhotoPreview";
import { createFacadeSvg, SIGN_PLACEMENTS } from "../lib/signFacade";
import type { FacadeSignBox, SignPlacement } from "../lib/signFacade";
import { loadNeonFont } from "../lib/neonFonts";
import { NEON_FONTS } from "../lib/neonConstruction";
import { SCENE_LIGHTING_TIMING } from "../lib/sceneLighting";
import { SignCart } from "./SignCart";

const SignScene3D = lazy(() => import("./SignScene3D"));

type ProductId = "panel" | "letters" | "neon";
type SceneMode = "day" | "night";
type PanelShape = "circle" | "square" | "rounded";
type LogoShape = "circle" | "square" | "rounded";
type GlowMode = "face" | "faceSide" | "faceHalo" | "halo";
type MountMode = "wall" | "frame" | "acp";
type FrameProfile = 15 | 20;

type ColorOption = {
  code: string;
  name: string;
  value: string;
};

type FontOption = {
  label: string;
  value: string;
};

type AcpLayout = {
  faceWidth: number;
  faceHeight: number;
  depth: number;
  secondReturn: number;
  unfoldedWidth: number;
  unfoldedHeight: number;
  sheetsX: number;
  sheetsY: number;
  sheetCount: number;
};

type SvgBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LettersSvgLayout = {
  defaultTextX: number; defaultTextY: number; defaultLogoX: number; defaultLogoY: number;
  viewWidth: number;
  viewHeight: number;
  logoBox: SvgBox;
  logoCornerRadius: number;
  textX: number;
  textBaseline: number;
  fontSize: number;
  textWidth: number;
  textHeight: number;
  textTop: number;
  textNaturalBox: SvgBox;
  textPathData?: string;
  signBox: SvgBox;
  railX: number;
  railWidth: number;
  railTopY: number;
  railBottomY: number;
  railHeight: number;
  panelBox: SvgBox;
  panelCornerRadius: number;
  haloBackerBox: SvgBox;
  haloBackerRadius: number;
  seamXs: number[];
  seamYs: number[];
};

type LettersSvgLayoutConfig = {
  acpLayout: AcpLayout;
  estimatedWidth: number;
  frameBottomPosition: number;
  frameEdgeInset: number;
  frameProfile: FrameProfile;
  frameTopPosition: number;
  height: number;
  letterOutlineEnabled: boolean;
  logoScale: number;
  logoShape: LogoShape;
  mountMode: MountMode;
  text: string;
  textBox: SvgBox | null;
  contours?: LetterContours | null;
  logoOffsetX?: number; logoOffsetY?: number; textOffsetX?: number; textOffsetY?: number;
  widthOverride?: number;
  logoEnabled?: boolean;
};

type LettersSvgMarkupConfig = LettersSvgLayoutConfig & {
  lightsOn?: boolean;
  showDimensions?: boolean;
  acpColor: string;
  depth: number;
  faceColor: string;
  font: string;
  glowMode: GlowMode;
  haloBackerColor: string;
  haloBackerEnabled: boolean;
  layout: LettersSvgLayout;
  logoImage: string;
  logoOutlineEnabled: boolean;
  logoShape: LogoShape;
  outlineColor: string;
  sideColor: string;
};

const PANEL_SIZES = Array.from({ length: 7 }, (_, index) => 400 + index * 50);
const ACP_SHEET_WIDTH_MM = 4000;
const ACP_SHEET_HEIGHT_MM = 1500;
const ACP_SECOND_RETURN_MM = 25;

const PRODUCTS: Array<{ id: ProductId; title: string; note: string }> = [
  { id: "neon", title: "Неоновая вывеска", note: "Неон 6 / 8 мм на акриловой подложке" },
  {
    id: "panel",
    title: "Панель-кронштейн",
    note: "Круг, квадрат или квадрат со скруглением",
  },
  {
    id: "letters",
    title: "Объемные световые буквы",
    note: "Текст, логотип, лицо, борта, свечение и монтаж",
  },
];

const PANEL_SHAPES: Array<{ id: PanelShape; label: string }> = [
  { id: "circle", label: "Круг" },
  { id: "square", label: "Квадрат" },
  { id: "rounded", label: "Скругленный квадрат" },
];

const LOGO_SHAPES: Array<{ id: LogoShape; label: string }> = [
  { id: "circle", label: "Круг" },
  { id: "square", label: "Квадрат" },
  { id: "rounded", label: "Скругление" },
];

const GLOW_MODES: Array<{ id: GlowMode; label: string; note: string }> = [
  { id: "face", label: "Лицевое", note: "светится только лицо" },
  { id: "faceSide", label: "Лицевое/торцевое", note: "лицо и борт" },
  { id: "faceHalo", label: "Лицевое/контражурное", note: "лицо и ореол назад" },
  { id: "halo", label: "Контражурное", note: "ореол на стену или подложку" },
];

const MOUNT_MODES: Array<{ id: MountMode; label: string; note: string }> = [
  { id: "wall", label: "На стене", note: "без общей основы" },
  { id: "frame", label: "На раме", note: "две трубы за буквами" },
  { id: "acp", label: "На подложке АКП", note: "основа под ваш макет" },
];

const LOGO_WIDTH_FACTOR = 0.72;
const LETTER_GAP_FACTOR = 0.16;
const LETTER_TEXT_WIDTH_FACTOR = 0.64;

const LETTER_FONTS = SIGN_FONTS;

const ORACAL_8500_COLORS: ColorOption[] = [
  { code: "010", name: "Белый", value: "#f8f8f2" },
  { code: "025", name: "Серно-желтый", value: "#f2d336" },
  { code: "020", name: "Золотисто-желтый", value: "#f4b326" },
  { code: "034", name: "Оранжевый", value: "#f47a2a" },
  { code: "032", name: "Светло-красный", value: "#e73432" },
  { code: "031", name: "Красный", value: "#d8242a" },
  { code: "030", name: "Темно-красный", value: "#9f1f2d" },
  { code: "041", name: "Розовый", value: "#e86a9a" },
  { code: "404", name: "Фиолетовый", value: "#65428c" },
  { code: "052", name: "Лазурный", value: "#0068b5" },
  { code: "049", name: "Королевский синий", value: "#004f9e" },
  { code: "086", name: "Ярко-синий", value: "#007ac3" },
  { code: "053", name: "Светло-синий", value: "#5ca8d7" },
  { code: "054", name: "Бирюзовый", value: "#009ba5" },
  { code: "063", name: "Лайм", value: "#85bc43" },
  { code: "061", name: "Зеленый", value: "#008647" },
  { code: "060", name: "Темно-зеленый", value: "#006246" },
  { code: "082", name: "Бежевый", value: "#d2bd95" },
  { code: "081", name: "Светло-коричневый", value: "#a6774a" },
  { code: "070", name: "Черный", value: "#111318" },
  { code: "090", name: "Серебро", value: "#b9c1cc" },
];

const ORACAL_641_COLORS: ColorOption[] = [
  { code: "010", name: "Белый", value: "#ffffff" },
  { code: "070", name: "Черный", value: "#101318" },
  { code: "031", name: "Красный", value: "#d92227" },
  { code: "312", name: "Бургунди", value: "#7f1f31" },
  { code: "021", name: "Желтый", value: "#f5cf25" },
  { code: "020", name: "Золотистый", value: "#edae21" },
  { code: "034", name: "Оранжевый", value: "#ee6b26" },
  { code: "049", name: "Синий", value: "#004f9f" },
  { code: "056", name: "Ледяной синий", value: "#68a9d0" },
  { code: "040", name: "Фиолетовый", value: "#5b3c8c" },
  { code: "063", name: "Лайм", value: "#78b943" },
  { code: "061", name: "Зеленый", value: "#008342" },
  { code: "080", name: "Коричневый", value: "#734c35" },
  { code: "072", name: "Светло-серый", value: "#c8cdd2" },
  { code: "090", name: "Серебро", value: "#b7bec8" },
  { code: "091", name: "Золото", value: "#b99a51" },
];

const ACP_COLORS: ColorOption[] = [
  { code: "ACP-W", name: "Белый АКП", value: "#f8fafc" },
  { code: "ACP-B", name: "Черный АКП", value: "#151922" },
  { code: "ACP-S", name: "Серебро АКП", value: "#c8ced8" },
  { code: "ACP-G", name: "Графит АКП", value: "#4b5563" },
  { code: "ACP-DG", name: "Зеленый АКП", value: "#173f38" },
  { code: "ACP-R", name: "Красный АКП", value: "#c9282d" },
  { code: "ACP-L", name: "Молочный АКП", value: "#efe9dc" },
];


type StudioSection = "design" | "colors" | "light" | "mount" | "logo";
const SectionContext = createContext<StudioSection>("design");
const PROJECT_STORAGE_KEY = "gorod-svet-sign-studio-v1";
const DEFAULT_PROJECT = {
  productId: "letters" as ProductId,
  sceneMode: "day" as SceneMode,
  lightsOn: true,
  facadePalette: "stone" as "stone" | "brick" | "charcoal",
  panelShape: "circle" as PanelShape,
  panelSize: 500,
  panelDepth: 60,
  panelWallGap: 120,
  panelMountMode: "wall" as PanelMountMode,
  panelCornerRadius: 60,
  panelImage: "",
  panelImageScale: 82,
  panelImageX: 0,
  panelImageY: 0,
  panelFaceColor: ORACAL_8500_COLORS[1] as ColorOption,
  panelSideColor: ORACAL_641_COLORS[1] as ColorOption,
  lettersText: "ЦВЕТЫ",
  secondLineText: "",
  logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0,
  neonText: "ГОРОД СВЕТ", neonFont: "rounded", neonHeight: 200, neonDiameter: 6, neonColor: "#ffa658", neonBackerWidth: 1900, neonBackerHeight: 350, neonBackerShape: "rectangle", neonBrightness: 85, neonAlign: "center",
  neonLineFonts: [] as string[], neonLineColors: [] as string[], neonLineScales: [] as number[], neonLineOffsets: [] as {x:number;y:number}[],
  neonIcon: "none", neonBackerColor: "clear" as "clear" | "white" | "black", neonInstallMode: "standoffs" as "standoffs" | "hanging", neonUse: "indoor" as "indoor" | "outdoor", neonTargetWidth: 0, neonKeepAspect: true, neonLetterSpacing: 0, neonLineSpacing: 0, neonReferenceImage: "",
  backdropImage: "", backdropWidth: 4000,
  letterFont: LETTER_FONTS[0].value as string,
  letterHeight: 410,
  letterWidth: 0,
  letterDepth: 60,
  letterFaceColor: ORACAL_8500_COLORS[4] as ColorOption,
  letterSideColor: ORACAL_641_COLORS[1] as ColorOption,
  glowMode: "faceHalo" as GlowMode,
  logoShape: "circle" as LogoShape,
  logoImage: "",
  logoEnabled: false,
  logoScale: 86,
  letterOutlineEnabled: false,
  logoOutlineEnabled: false,
  outlineColor: ORACAL_641_COLORS[1] as ColorOption,
  haloBackerEnabled: true,
  haloBackerColor: ACP_COLORS[0] as ColorOption,
  mountMode: "frame" as MountMode,
  frameProfile: 15 as FrameProfile,
  frameEdgeInset: 0,
  frameTopPosition: 15,
  frameBottomPosition: 15,
  acpColor: ACP_COLORS[0] as ColorOption,
  acpWidth: 2500,
  acpHeight: 830,
  acpDepth: 50
};
type ProjectState = typeof DEFAULT_PROJECT;
const SECTION_ITEMS = [
  { id: "design" as const, label: "Надпись", icon: Type },
  { id: "colors" as const, label: "Цвета", icon: Settings2 },
  { id: "light" as const, label: "Свет", icon: Lightbulb },
  { id: "mount" as const, label: "Монтаж", icon: Maximize },
  { id: "logo" as const, label: "Логотип", icon: ImagePlus },
];
const SECTION_GROUPS: Record<string, StudioSection> = {
  "Надпись": "design", "Форма": "design", "Размер": "design",
  "Лицо Oracal 8500": "colors", "Борт Oracal 641": "colors", "Кантик": "colors",
  "Свечение": "light", "Контражурная подложка": "light",
  "Размещение": "mount", "Рама": "mount", "Подложка АКП": "mount", "Крепление к стене": "mount",
  "Логотип": "logo", "Изображение": "logo",
};
const PROJECT_ENUMS: Record<string, readonly unknown[]> = {
  facadePalette: ["stone","brick","charcoal"], neonIcon: ["none","heart","star","bolt","cup","music","infinity"], neonBackerColor:["clear","white","black"], neonInstallMode:["standoffs","hanging"], neonUse:["indoor","outdoor"],
  productId: ["panel", "letters", "neon"], neonFont: NEON_FONTS.map(font=>font.id), neonDiameter: [6, 8], neonBackerShape: ["rectangle","rounded","contour"], neonAlign: ["left","center","right"], sceneMode: ["day", "night"],
  panelShape: ["circle", "square", "rounded"], panelMountMode: ["wall", "corner", "corner-front", "corner-side"], logoShape: ["circle", "square", "rounded"],
  glowMode: ["face", "faceSide", "faceHalo", "halo"], mountMode: ["wall", "frame", "acp"],
  frameProfile: [15, 20], letterFont: LETTER_FONTS.map(item => item.value),
};
const PROJECT_RANGES: Record<string, [number, number]> = {
  panelImageScale: [45, 130], panelImageX: [-40, 40], panelImageY: [-40, 40],
  logoOffsetX: [-20000, 20000], logoOffsetY: [-10000, 10000], textOffsetX: [-20000, 20000], textOffsetY: [-10000, 10000],
  neonHeight: [40, 800], neonBrightness: [10, 100], neonBackerWidth: [150, 3950], neonBackerHeight: [150, 1450],
  neonLetterSpacing: [0, 100], neonLineSpacing: [0, 300], neonTargetWidth: [0, 3800], backdropWidth:[500,20000],
  letterHeight: [40, 1200], letterDepth: [40, 60], logoScale: [45, 130],
  letterWidth: [0, 20000],
  panelSize: [200, 2000], panelDepth: [30, 160],
  panelWallGap: [60, 400], panelCornerRadius: [0, 300],
  frameEdgeInset: [0, 120], frameTopPosition: [10, 20], frameBottomPosition: [10, 20],
  acpWidth: [400, 20000], acpHeight: [250, 10000], acpDepth: [30, 100],
};
function validateProject(raw: unknown): ProjectState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Файл не содержит проект вывески.");
  const envelope = raw as Record<string, unknown>;
  if (envelope.version !== 1 || !envelope.project || typeof envelope.project !== "object" || Array.isArray(envelope.project)) throw new Error("Выберите файл проекта, сохраненный в этой студии.");
  const input = envelope.project as Record<string, unknown>;
  const result = { ...DEFAULT_PROJECT };
  const output = result as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_PROJECT)) {
    const value = input[key];
    const initial = output[key];
    if (value === undefined) continue;
    if (Array.isArray(initial)) {
      if (!Array.isArray(value) || value.length > 3) throw new Error("Некорректные настройки строк неона.");
      output[key] = value.map(item => {
        if (key === "neonLineFonts" && typeof item === "string" && NEON_FONTS.some(font=>font.id===item)) return item;
        if (key === "neonLineColors" && typeof item === "string" && /^#[0-9a-f]{6}$/i.test(item)) return item;
        if (key === "neonLineScales" && typeof item === "number" && Number.isFinite(item)) return Math.max(.5,Math.min(2,item));
        if (key === "neonLineOffsets" && item && typeof item === "object" && typeof item.x === "number" && typeof item.y === "number" && Number.isFinite(item.x) && Number.isFinite(item.y)) return {x:Math.max(-1800,Math.min(1800,item.x)),y:Math.max(-700,Math.min(700,item.y))};
        throw new Error("Проверьте шрифт, цвет и положение строк неона.");
      });
    } else if (PROJECT_ENUMS[key]) {
      if (key === "letterFont" && typeof value === "string") { output[key] = resolveSignFont(value).value; continue; }
      if (!PROJECT_ENUMS[key].includes(value)) throw new Error("В проекте есть неподдерживаемые настройки.");
      output[key] = value;
    } else if (typeof initial === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Проверьте числовые параметры проекта.");
      const limits = PROJECT_RANGES[key];
      output[key] = limits ? Math.round(Math.min(limits[1], Math.max(limits[0], value))) : value;
    } else if (typeof initial === "boolean") {
      if (typeof value !== "boolean") throw new Error("Некорректная настройка проекта.");
      output[key] = value;
    } else if (typeof initial === "string") {
      if (typeof value !== "string") throw new Error("Некорректный текст в проекте.");
      if (key === "neonColor") { if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Некорректный цвет неона."); output[key] = value; }
      else if (key === "panelImage" || key === "logoImage" || key === "backdropImage" || key === "neonReferenceImage") {
        if (value && (!/^data:image\/(png|jpeg|webp);base64,/.test(value) || value.length > 3_000_000)) throw new Error("Изображение в проекте не поддерживается.");
        output[key] = value;
      } else output[key] = value.slice(0, 60);
    } else {
      const palette = key.includes("Face") ? ORACAL_8500_COLORS : key === "acpColor" || key === "haloBackerColor" ? ACP_COLORS : ORACAL_641_COLORS;
      const match = palette.find(color => color.code === (value as ColorOption)?.code);
      if (!match) throw new Error("Цвет в проекте отсутствует в палитре.");
      output[key] = match;
    }
  }
  result.frameProfile = 15;
  if(result.panelMountMode==='corner') result.panelWallGap=Math.max(result.panelWallGap,result.panelDepth/2+20);
  result.letterDepth = normalizeLetterDepth(result.letterHeight, result.letterDepth);
  if (Number(input.frameTopPosition) > 20) result.frameTopPosition = 15;
  if (Number(input.frameBottomPosition) > 20) result.frameBottomPosition = 15;
  if (input.logoEnabled === undefined) result.logoEnabled = Boolean(result.logoImage);
  const bounded = constrainBacker(result.acpWidth,result.acpHeight,result.acpDepth); result.acpWidth=bounded.width; result.acpHeight=bounded.height;
  result.neonText=result.neonText.split("\n").slice(0,3).join("\n");
  return result;
}
function loadSavedProject(): ProjectState {
  try {
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY) ?? localStorage.getItem("verkup-sign-studio-v1");
    return saved ? validateProject(JSON.parse(saved)) : { ...DEFAULT_PROJECT };
  } catch { return { ...DEFAULT_PROJECT }; }
}

export function SignProductConfigurator() {
  const [project, setProject] = useState<ProjectState>(loadSavedProject);
  const undoHistory = useRef<ProjectState[]>([]);
  const lastUndoEdit = useRef(0);
  const [canUndo,setCanUndo] = useState(false);
  const [selectedNeonLine,setSelectedNeonLine] = useState(0);
  useEffect(() => { setSelectedNeonLine(index => Math.min(index, project.neonText.split('\n').length - 1)); }, [project.neonText]);
  const [editing, setEditing] = useState(false);
  const combinedText = project.lettersText + (project.secondLineText.trim() ? "\n" + project.secondLineText : "");
  const patchProject = (patch: Partial<ProjectState>, remember = true) => {
    if (remember && project.productId === 'neon' && Object.keys(patch).some(key=>key.startsWith('neon'))) {
      if (Date.now()-lastUndoEdit.current > 800 || !undoHistory.current.length) {
        undoHistory.current.push(project); if (undoHistory.current.length>30) undoHistory.current.shift(); setCanUndo(true);
      }
      lastUndoEdit.current = Date.now();
    }
    setProject(previous => {
    const next = { ...previous, ...patch };
    if (patch.neonTargetWidth && next.neonKeepAspect) {
      try {
        const fitted = fitNeonToWidth(next.neonText,patch.neonTargetWidth,next.neonDiameter,next.neonFont,next.neonAlign,{lineFonts:next.neonLineFonts,lineScales:next.neonLineScales,lineOffsets:next.neonLineOffsets,icon:next.neonIcon,letterSpacing:next.neonLetterSpacing,lineSpacing:next.neonLineSpacing});
        next.neonHeight=fitted.height;
      } catch (error) { setNotice(error instanceof Error ? error.message : "Увеличьте ширину надписи."); return previous; }
    }
    if (patch.neonTargetWidth) {
      try {
        const design=createNeonDesign(next.neonText,next.neonHeight,next.neonDiameter,next.neonFont,next.neonAlign,{lineFonts:next.neonLineFonts,lineScales:next.neonLineScales,lineOffsets:next.neonLineOffsets,icon:next.neonIcon,letterSpacing:next.neonLetterSpacing,lineSpacing:next.neonLineSpacing,targetWidth:next.neonKeepAspect?undefined:patch.neonTargetWidth});
        const minimum=neonRequiredBacker(design);
        next.neonBackerWidth=Math.max(150,Math.ceil(minimum.width));next.neonBackerHeight=Math.max(150,Math.ceil(minimum.height));
        if(next.neonKeepAspect) next.neonTargetWidth=Math.round(design.width);
      } catch { /* Preserve the current backer until a valid centerline can be made. */ }
    }
    if (next.neonKeepAspect && (patch.neonHeight!==undefined || patch.neonText!==undefined || patch.neonIcon!==undefined || patch.neonLineFonts || patch.neonLineScales || patch.neonLineOffsets || patch.neonAlign!==undefined || patch.neonLetterSpacing!==undefined || patch.neonLineSpacing!==undefined)) next.neonTargetWidth=0;
    const backer = constrainBacker(next.acpWidth, next.acpHeight, next.acpDepth);
    next.acpWidth = backer.width; next.acpHeight = backer.height;
    next.letterDepth = normalizeLetterDepth(next.letterHeight, next.letterDepth);
    return next;
    });
  };
  const undoNeon = () => { const previous=undoHistory.current.pop(); if(previous) setProject(previous); lastUndoEdit.current=0; setCanUndo(undoHistory.current.length>0); };
  useEffect(() => { const bounded = constrainBacker(project.acpWidth, project.acpHeight, project.acpDepth);
    if (bounded.width !== project.acpWidth || bounded.height !== project.acpHeight) patchProject({ acpWidth: bounded.width, acpHeight: bounded.height });
  }, [project.acpWidth, project.acpHeight, project.acpDepth]);
  const { productId, sceneMode, panelShape, panelSize, panelImage, panelImageScale, panelImageX, panelImageY, panelFaceColor, panelSideColor, lettersText, letterFont, letterHeight, letterWidth, letterDepth, letterFaceColor, letterSideColor, glowMode, logoShape, logoImage, logoEnabled, logoScale, letterOutlineEnabled, logoOutlineEnabled, outlineColor, haloBackerEnabled, haloBackerColor, mountMode, frameProfile, frameEdgeInset, frameTopPosition, frameBottomPosition, acpColor, acpWidth, acpHeight, acpDepth } = project;
  const setProductId = (value: ProjectState["productId"]) => setProject(previous => ({ ...previous, productId: value }));
  const setSceneMode = (value: ProjectState["sceneMode"]) => setProject(previous => ({ ...previous, sceneMode: value }));
  const setPanelShape = (value: ProjectState["panelShape"]) => setProject(previous => ({ ...previous, panelShape: value }));
  const setPanelSize = (value: ProjectState["panelSize"]) => setProject(previous => ({ ...previous, panelSize: value }));
  const setPanelDepth = (value: number) => setProject(previous => ({ ...previous, panelDepth: value, panelWallGap:previous.panelMountMode==='corner'?Math.max(previous.panelWallGap,value/2+20):previous.panelWallGap }));
  const setPanelImage = (value: ProjectState["panelImage"]) => setProject(previous => ({ ...previous, panelImage: value }));
  const setPanelImageScale = (value: ProjectState["panelImageScale"]) => setProject(previous => ({ ...previous, panelImageScale: value }));
  const setPanelImageX = (value: ProjectState["panelImageX"]) => setProject(previous => ({ ...previous, panelImageX: value }));
  const setPanelImageY = (value: ProjectState["panelImageY"]) => setProject(previous => ({ ...previous, panelImageY: value }));
  const setPanelFaceColor = (value: ProjectState["panelFaceColor"]) => setProject(previous => ({ ...previous, panelFaceColor: value }));
  const setPanelSideColor = (value: ProjectState["panelSideColor"]) => setProject(previous => ({ ...previous, panelSideColor: value }));
  const setLettersText = (value: ProjectState["lettersText"]) => setProject(previous => ({ ...previous, lettersText: value }));
  const setLetterFont = (value: ProjectState["letterFont"]) => setProject(previous => ({ ...previous, letterFont: value }));
  const setLetterHeight = (value: ProjectState["letterHeight"]) => setProject(previous => ({ ...previous, letterHeight: value, letterDepth: normalizeLetterDepth(value, previous.letterDepth) }));
  const setLetterWidth = (value: number) => setProject(previous => ({ ...previous, letterWidth: value }));
  const setLetterDepth = (value: ProjectState["letterDepth"]) => setProject(previous => ({ ...previous, letterDepth: normalizeLetterDepth(previous.letterHeight, value) }));
  const setLetterFaceColor = (value: ProjectState["letterFaceColor"]) => setProject(previous => ({ ...previous, letterFaceColor: value }));
  const setLetterSideColor = (value: ProjectState["letterSideColor"]) => setProject(previous => ({ ...previous, letterSideColor: value }));
  const setGlowMode = (value: ProjectState["glowMode"]) => setProject(previous => ({ ...previous, glowMode: value }));
  const setLogoShape = (value: ProjectState["logoShape"]) => setProject(previous => ({ ...previous, logoShape: value }));
  const setLogoImage = (value: ProjectState["logoImage"]) => setProject(previous => ({ ...previous, logoImage: value }));
  const setLogoEnabled = (value: boolean) => setProject(previous => ({ ...previous, logoEnabled: value }));
  const setLogoScale = (value: ProjectState["logoScale"]) => setProject(previous => ({ ...previous, logoScale: value }));
  const setLetterOutlineEnabled = (value: ProjectState["letterOutlineEnabled"]) => setProject(previous => ({ ...previous, letterOutlineEnabled: value }));
  const setLogoOutlineEnabled = (value: ProjectState["logoOutlineEnabled"]) => setProject(previous => ({ ...previous, logoOutlineEnabled: value }));
  const setOutlineColor = (value: ProjectState["outlineColor"]) => setProject(previous => ({ ...previous, outlineColor: value }));
  const setHaloBackerEnabled = (value: ProjectState["haloBackerEnabled"]) => setProject(previous => ({ ...previous, haloBackerEnabled: value }));
  const setHaloBackerColor = (value: ProjectState["haloBackerColor"]) => setProject(previous => ({ ...previous, haloBackerColor: value }));
  const setMountMode = (value: ProjectState["mountMode"]) => setProject(previous => ({ ...previous, mountMode: value }));
  const setFrameEdgeInset = (value: ProjectState["frameEdgeInset"]) => setProject(previous => ({ ...previous, frameEdgeInset: value }));
  const setFrameTopPosition = (value: ProjectState["frameTopPosition"]) => setProject(previous => ({ ...previous, frameTopPosition: value }));
  const setFrameBottomPosition = (value: ProjectState["frameBottomPosition"]) => setProject(previous => ({ ...previous, frameBottomPosition: value }));
  const setAcpColor = (value: ProjectState["acpColor"]) => setProject(previous => ({ ...previous, acpColor: value }));
  const setAcpWidth = (value: ProjectState["acpWidth"]) => setProject(previous => ({ ...previous, acpWidth: value }));
  const setAcpHeight = (value: ProjectState["acpHeight"]) => setProject(previous => ({ ...previous, acpHeight: value }));
  const setAcpDepth = (value: ProjectState["acpDepth"]) => setProject(previous => ({ ...previous, acpDepth: value }));
  const [activeSection, setActiveSection] = useState<StudioSection>("design");
  const [zoom, setZoom] = useState(100);
  const [placement,setPlacement] = useState<SignPlacement>("none");
  const [neonFontReady,setNeonFontReady] = useState("rounded");
  const [neonFontError,setNeonFontError] = useState("");
  const neonFontKey=JSON.stringify([project.neonFont,...project.neonLineFonts]);
  useEffect(()=>{let active=true;setNeonFontError("");void Promise.all([...new Set([project.neonFont,...project.neonLineFonts])].map(id=>loadNeonFont(id))).then(()=>{if(active)setNeonFontReady(neonFontKey);}).catch(error=>{if(active)setNeonFontError(error.message);});return()=>{active=false;};},[neonFontKey]);
  const [fitSignal, setFitSignal] = useState(0);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [showDimensions, setShowDimensions] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useSignCart<ProjectState>();
  const latestProject = useRef(project);
  latestProject.current = project;
  const [notice, setNotice] = useState("");
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(()=>{const host=workspaceRef.current;if(!host||viewMode!=="2d")return;const wheel=(event:WheelEvent)=>{if(!(event.target as Element).closest(".builder-preview"))return;event.preventDefault();setZoom(value=>Math.max(25,Math.min(400,Math.round(value*Math.exp(-event.deltaY*.0015)))));};host.addEventListener("wheel",wheel,{passive:false});return()=>host.removeEventListener("wheel",wheel);},[viewMode]);
  const [previewHeight, setPreviewHeight] = useState(() => Math.max(220, Math.min(620, window.innerHeight - 340)));
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!workspaceRef.current || window.matchMedia("(max-width: 767px)").matches) return;
        const top = workspaceRef.current.getBoundingClientRect().top;
        setPreviewHeight(Math.max(220, Math.min(620, Math.floor(window.innerHeight - Math.max(12, top) - 12))));
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [notice]);
  const [saveStatus, setSaveStatus] = useState("Сохранено на устройстве");
  const projectFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const flush = () => { try { localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ version: 1, project: latestProject.current })); } catch { /* The visible autosave status explains storage failures. */ } };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onVisibility); flush(); };
  }, []);
  useEffect(() => {
    setSaveStatus("Сохраняем…");
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify({ version: 1, project }));
        setSaveStatus("Сохранено на устройстве");
      } catch { setSaveStatus("Нет места для автосохранения. Скачайте проект."); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [project]);
  const [letterContours, setLetterContours] = useState<LetterContours | null>(null);
  const lastValidFont = useRef(LETTER_FONTS[0].value as string);
  const [fontPending, setFontPending] = useState(false);
  useEffect(() => {
    let active = true;
    setFontPending(true);
    void loadLetterContours(letterFont, combinedText).then(contours => {
      if (active) { lastValidFont.current = letterFont; setLetterContours(contours); setFontPending(false); }
    }).catch(error => { if (active) { setFontPending(false); setLetterFont(lastValidFont.current); setNotice(error.message); } });
    return () => { active = false; };
  }, [letterFont, combinedText]);
  const letterTextBox = letterContours?.mainBox ?? null;

  const activeProduct = PRODUCTS.find((product) => product.id === productId) || PRODUCTS[0];
  const currentFaceColor = productId === "panel" ? panelFaceColor : letterFaceColor;
  const currentSideColor = productId === "panel" ? panelSideColor : letterSideColor;
  const panelAreaM2 =
    panelShape === "circle"
      ? (Math.PI * (panelSize / 2) ** 2) / 1_000_000
      : (panelSize * panelSize) / 1_000_000;
  const lettersWidth = useMemo(() => {
    const textWidth = Math.max(letterHeight * 0.9, lettersText.trim().length * letterHeight * LETTER_TEXT_WIDTH_FACTOR);
    const logoWidth = letterHeight * LOGO_WIDTH_FACTOR;
    const constructionGap = letterHeight * LETTER_GAP_FACTOR;

    return Math.max(900, textWidth + logoWidth + constructionGap);
  }, [letterHeight, lettersText]);
  const acpLayout = useMemo(() => createAcpLayout(acpWidth, acpHeight, acpDepth), [
    acpDepth,
    acpHeight,
    acpWidth,
  ]);
  const lettersLayout = useMemo(() => createLettersSvgLayout({
    acpLayout,
    estimatedWidth: lettersWidth,
    frameBottomPosition,
    frameEdgeInset,
    frameProfile,
    frameTopPosition,
    height: letterHeight,
    letterOutlineEnabled,
    logoScale,
    logoShape,
    mountMode,
    text: lettersText,
    textBox: letterTextBox,
    contours: letterContours,
    widthOverride: letterWidth,
    logoEnabled,
    logoOffsetX: project.logoOffsetX, logoOffsetY: project.logoOffsetY, textOffsetX: project.textOffsetX, textOffsetY: project.textOffsetY,
  }), [
    acpLayout,
    frameBottomPosition,
    frameEdgeInset,
    frameProfile,
    frameTopPosition,
    letterHeight,
    letterOutlineEnabled,
    lettersText,
    lettersWidth,
    letterTextBox,
    letterContours,
    logoScale,
    logoShape,
    mountMode,
    letterWidth,
    logoEnabled, project.logoOffsetX, project.logoOffsetY, project.textOffsetX, project.textOffsetY,
  ]);
  useEffect(() => {
    if (project.mountMode !== 'acp' || !letterContours || fontPending) return;
    const actualHeight = lettersLayout.textHeight / (letterContours.lineFactor ?? 1);
    const expectedHeight = letterHeight - (letterOutlineEnabled ? Math.max(4, letterHeight * .035) * 2 : 0);
    if (actualHeight < expectedHeight - 1) {
      const nextHeight = Math.max(40, Math.floor(letterHeight * actualHeight / expectedHeight));
      patchProject({ letterHeight: nextHeight, letterWidth: letterWidth ? Math.floor(lettersLayout.signBox.width) : 0 });
    }
  }, [lettersLayout, letterContours, fontPending, project.mountMode, letterHeight, letterOutlineEnabled, letterWidth]);
  const measuredLettersWidth = Math.max(1, Math.round(lettersLayout.signBox.width));
  const frameEdgeInsetSafe = Math.max(0, Math.min(120, frameEdgeInset));
  const frameEdgeInsetPercent = Math.min(12, (frameEdgeInsetSafe / Math.max(1, measuredLettersWidth)) * 100);
  const lettersAreaM2 = (measuredLettersWidth * lettersLayout.signBox.height) / 1_000_000;
  const glowHasHalo = hasHaloGlow(glowMode);
  const glowLabel = GLOW_MODES.find((item) => item.id === glowMode)?.label || "";
  const mountLabel = MOUNT_MODES.find((item) => item.id === mountMode)?.label || "";
  const letterPrice = calculateLetterPrice(combinedText, lettersLayout.textHeight / (letterContours?.lineFactor ?? 1) + (letterOutlineEnabled ? Math.max(4, letterHeight * .035) * 2 : 0));
  const frameNeedsApproval = mountMode === "frame" && requiresFrameApproval(letterHeight);
  const priceNotes = productId === "neon" ? ["Неоновая вывеска — по согласованию."] : productId === "panel" ? ["Панель-кронштейн — по согласованию."] : [
    ...(logoEnabled ? ["Логотип — по согласованию."] : []),
    ...(hasUnpricedSymbols(combinedText) ? ["Специальные символы — по согласованию."] : []),
    ...(letterHeight > 550 ? ["Глубина букв выше 55 см — по согласованию."] : []),
    ...(frameNeedsApproval ? ["Рама для букв выше 55 см — по согласованию."] : []),
  ];
  const neonResult = useMemo(() => {
    if(neonFontReady!==neonFontKey) return {design:null,error:neonFontError};
    try { return { design: createNeonDesign(project.neonText, project.neonHeight, project.neonDiameter, project.neonFont, project.neonAlign, {lineFonts:project.neonLineFonts,lineColors:project.neonLineColors,lineScales:project.neonLineScales,lineOffsets:project.neonLineOffsets,icon:project.neonIcon,letterSpacing:project.neonLetterSpacing,lineSpacing:project.neonLineSpacing,targetWidth:project.neonKeepAspect?undefined:project.neonTargetWidth||undefined}), error: "" }; }
    catch(error) { return { design: null, error: error instanceof Error ? error.message : "Проверьте неоновую надпись." }; }
  }, [project.neonText, project.neonHeight, project.neonDiameter, project.neonFont, project.neonAlign, project.neonLineFonts,project.neonLineColors,project.neonLineScales,project.neonLineOffsets,project.neonIcon,project.neonLetterSpacing,project.neonLineSpacing,project.neonTargetWidth,project.neonKeepAspect,neonFontReady, neonFontKey,neonFontError]);
  const requiredNeonBacker=neonResult.design?neonRequiredBacker(neonResult.design):{width:150,height:150};
  const neonWidth = Math.max(project.neonBackerWidth, requiredNeonBacker.width);
  const neonHeight = Math.max(project.neonBackerHeight, requiredNeonBacker.height);
  const neonFits = neonWidth <= 3950 && neonHeight <= 1450;
  useEffect(() => {
    if (neonFits && productId === 'neon' && (project.neonBackerWidth < neonWidth || project.neonBackerHeight < neonHeight))
      patchProject({neonBackerWidth:Math.ceil(neonWidth),neonBackerHeight:Math.ceil(neonHeight)},false);
  }, [neonWidth,neonHeight,neonFits,project.neonBackerWidth,project.neonBackerHeight,productId]);
  const signWidth = productId === "neon" ? Math.round(neonWidth) : productId === "panel" ? panelSize : mountMode === "acp" ? acpWidth : measuredLettersWidth;
  const signHeight = productId === "neon" ? Math.round(neonHeight) : productId === "panel" ? panelSize : mountMode === "acp" ? acpHeight : Math.round(lettersLayout.signBox.height);
  const neonSvgPad = Math.max(80, neonHeight * .2);
  const facadeSignBox: FacadeSignBox = productId === "neon"
    ? { x: neonSvgPad, y: neonSvgPad, width: neonWidth, height: neonHeight }
    : productId === "panel" ? panelSvgFaceBox(panelSize,clamp(project.panelWallGap,60,400),project.panelMountMode)
    : mountMode === "acp" ? lettersLayout.panelBox : lettersLayout.signBox;
  const signDepth = productId === "neon" ? (project.neonInstallMode==='hanging'?3:23) + project.neonDiameter : productId === "panel" ? project.panelDepth : letterDepth;
  const panelMount=productId==='panel'?panelMountLayout(panelSize,panelShape,project.panelWallGap,project.panelCornerRadius,project.panelDepth,project.panelMountMode):undefined;
  const cartQuantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  function handleAddToCart() {
    const added = cart.addItem({
      project, label: productId === "neon" ? "Неон · " + project.neonText : productId === "letters" ? lettersText.trim() || "Объемные буквы" : "Панель-кронштейн",
      widthMm: signWidth, heightMm: signHeight, depthMm: signDepth,
      price: productId === "letters" && letterPrice.letterCount > 0 ? letterPrice.total : null,
      requiresApproval: priceNotes.length > 0 || productId === "letters" && letterPrice.letterCount === 0,
      approvalNote: priceNotes.join(" "),
      thumbnailSvg: createCurrentSvg(false),
    });
    if (added) { setCartOpen(true); setNotice("Вывеска добавлена в корзину. Ее параметры сохранены отдельно."); }
  }

  const visualStyle = {
    "--face-color": currentFaceColor.value,
    "--side-color": currentSideColor.value,
    "--outline-color": outlineColor.value,
    "--glow-color": currentFaceColor.value,
    "--letter-font": letterFont,
    "--letter-outline-width": letterOutlineEnabled ? "0.045em" : "0px",
    "--letter-side-shift": `${Math.max(5, Math.min(14, letterDepth / 4.5))}px`,
    "--letter-side-step": `${Math.max(1, Math.min(3, letterDepth / 32))}px`,
    "--logo-outline-width": logoOutlineEnabled ? "7px" : "0px",
    "--frame-profile-size": `${frameProfile === 15 ? 6 : 8}px`,
    "--frame-edge-inset": `${frameEdgeInsetPercent}%`,
    "--frame-rail-top": `${frameTopPosition}%`,
    "--frame-rail-bottom": `${frameBottomPosition}%`,
    "--halo-backer-color": haloBackerColor.value,
    "--acp-color": acpColor.value,
    "--panel-image-scale": panelImageScale / 100,
    "--panel-image-x": `${panelImageX}%`,
    "--panel-image-y": `${panelImageY}%`,
    "--logo-scale": logoScale / 100,
  } as CSSProperties;

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>, onReady: (dataUrl: string) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Выберите PNG, JPG или WebP.");
      if (file.size > 2_000_000) throw new Error("Изображение больше 2 МБ. Уменьшите файл и загрузите снова.");
      const dataUrl = await readImageFile(file);
      setNotice("Загружаем изображение…");
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      onReady(dataUrl);
      setNotice("Изображение загружено.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось открыть изображение. Попробуйте другой файл."); }
    finally { event.target.value = ""; }
  }
  function handleSaveProject() {
    downloadTextFile(`gorod-svet-${productId === "letters" ? lettersText || "вывеска" : productId === "neon" ? "неон" : "панель"}.json`, JSON.stringify({ version: 1, project }, null, 2), "application/json");
    setNotice("Проект скачан. Его можно открыть здесь на любом устройстве.");
  }
  async function handleOpenProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 9_500_000) throw new Error("Файл проекта слишком большой.");
      const nextProject = validateProject(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
      try {
        await Promise.all([nextProject.panelImage, nextProject.logoImage, nextProject.backdropImage, nextProject.neonReferenceImage].filter(Boolean).map(async source => {
          const image = new Image();
          image.src = source;
          await image.decode();
        }));
      } catch { throw new Error("В проекте есть поврежденное изображение. Сохраните его заново."); }
      setProject(nextProject);
      setActiveSection("design");
      setZoom(100);
      setNotice("Проект открыт.");
    } catch (error) { setNotice(error instanceof Error && !(error instanceof SyntaxError) ? error.message : "Не удалось открыть проект. Выберите сохраненный файл JSON."); }
    finally { event.target.value = ""; }
  }
  function createCurrentSvg(withDimensions = showDimensions) {
    if (productId === "neon") return neonResult.design ? neonSvg(neonResult.design, neonWidth, neonHeight, project.neonDiameter, project.neonColor, sceneMode === "night", withDimensions, project.neonBackerShape, project.neonBrightness,{lightsOn:project.lightsOn,backerColor:project.neonBackerColor,installMode:project.neonInstallMode}) : "";
    if (productId === "panel") {
      return createPanelSvgMarkup({ shape: panelShape, size: panelSize, depth: project.panelDepth, wallGap: project.panelWallGap, mountMode: project.panelMountMode, cornerRadius: project.panelCornerRadius, faceColor: panelFaceColor.value, sideColor: panelSideColor.value, image: panelImage, imageScale: panelImageScale, imageX: panelImageX, imageY: panelImageY, sceneMode, lightsOn:project.lightsOn, showDimensions: withDimensions, flat: true });
    }
    return createLettersSvgMarkup({
      lightsOn:project.lightsOn,
      sceneMode,
      acpDepth,
      acpColor: acpColor.value,
      acpLayout,
      depth: letterDepth,
      estimatedWidth: lettersWidth,
      faceColor: letterFaceColor.value,
      font: letterFont,
      frameBottomPosition,
      frameEdgeInset,
      frameProfile,
      frameTopPosition,
      glowMode,
      haloBackerColor: haloBackerColor.value,
      haloBackerEnabled: glowHasHalo && haloBackerEnabled && mountMode === "wall",
      logoEnabled,
      showDimensions: withDimensions,
      height: letterHeight,
      layout: lettersLayout,
      letterOutlineEnabled,
      logoImage,
      logoOutlineEnabled,
      logoScale,
      logoShape,
      mountMode,
      outlineColor: outlineColor.value,
      sideColor: letterSideColor.value,
      text: lettersText,
      textBox: letterTextBox,
    });

  }
  function handle3DUnavailable() { setViewMode("2d"); setNotice("3D недоступен в этом браузере. Макет и размеры доступны в 2D."); }
  function handleFitPreview() { setZoom(100); setFitSignal(value => value + 1); }
  function handleExportVector() {
    downloadTextFile(`gorod-svet-${productId}-${Date.now()}.svg`, createCurrentSvg(), "image/svg+xml;charset=utf-8");
    setNotice(`SVG макета${showDimensions ? " с размерами" : ""} скачан. Буквы сохранены контурами и не требуют установки шрифтов.`);
  }

  return (
    <main className="public-sign-configurator sign-studio" style={visualStyle}>
      <a className="studio-skip" href="#studio-controls">К настройкам вывески</a>
      <header className="studio-header">
        <a className="studio-brand" href="./" aria-label="Город Свет — конструктор вывесок">
          <img className="studio-brand-mark" src={`${import.meta.env.BASE_URL}gorod-svet-bulb.png`} alt="" />
          <span><img className="studio-wordmark" src={`${import.meta.env.BASE_URL}gorod-svet-wordmark.svg`} alt="Город Свет"/><small>Конструктор вывесок</small></span>
        </a>
        <div className="studio-header-meta"><Check size={14} /><span role="status">{saveStatus}</span></div>
        <div className="studio-actions">
          <input hidden ref={projectFileRef} type="file" accept=".json,application/json" onChange={event => void handleOpenProject(event)} />
          <button className="studio-button" type="button" onClick={() => projectFileRef.current?.click()}><FolderOpen size={16} /><span>Открыть</span></button>
          <button className="studio-button" type="button" onClick={handleSaveProject}><Save size={16} /><span>Сохранить проект</span></button>
          <button className="studio-button primary" type="button" onClick={handleExportVector} disabled={productId === "neon" ? !neonResult.design || !neonFits : productId === "letters" && (fontPending || !letterContours)}><Download size={16} /><span>Скачать SVG</span></button>
          <button className="studio-button studio-cart-toggle" type="button" aria-expanded={cartOpen} aria-controls="sign-cart" onClick={() => setCartOpen(value => !value)}><ShoppingCart size={17} /><span>Корзина</span><span className="cart-count">{cartQuantity}</span></button>
        </div>
      </header>
      {notice && <div className="studio-notice" role="status"><span>{notice}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={16} /></button></div>}
      {cartOpen && <div><SignCart items={cart.items} onQuantityChange={cart.updateQuantity} onRemove={cart.removeItem} onClear={cart.clear} error={cart.error} onDismissError={cart.dismissError} onEdit={item => {
        try { setProject(validateProject({ version: 1, project: item.project })); setActiveSection("design"); setZoom(100); setCartOpen(false); setNotice("Макет открыт из корзины. Изменения можно добавить отдельной позицией."); }
        catch { setNotice("Этот проект не удалось открыть. Остальные позиции корзины доступны."); }
      }} /></div>}
      {cart.error && !cartOpen && <div className="studio-notice" role="alert">{cart.error}<button type="button" aria-label="Закрыть ошибку корзины" onClick={cart.dismissError}><X size={16} /></button></div>}
      <div className="studio-heading"><div><h1>Ваша вывеска. В деталях.</h1><p>Соберите макет и посмотрите, как он будет выглядеть днем и ночью.</p></div><span>Конструктор вывесок<ArrowUpRight size={16} /></span></div>
      <section className="product-tabs" aria-label="Тип вывески">
        {[...PRODUCTS].reverse().map(product => <button type="button" key={product.id} aria-pressed={productId === product.id} className={productId === product.id ? "active" : ""} onClick={() => { setProductId(product.id); setActiveSection("design"); setZoom(100); }}>
          {product.id === "letters" ? <Type size={24} /> : <Maximize size={24} />}
          <div><strong>{product.title}</strong><span>{product.note}</span></div><Check className="product-check" size={18} />
        </button>)}
      </section>
      <section className="sign-builder-layout">

        <aside className="builder-controls" id="studio-controls" aria-label="Настройки вывески">
          <header className="controls-heading"><h2>Настройте вывеску</h2><span>Все изменения — на макете</span></header>
          {productId !== "neon" && <nav className="studio-section-tabs" aria-label="Разделы настроек">
            {SECTION_ITEMS.filter(item => productId === "letters" || ["design", "colors", "mount", "logo"].includes(item.id)).map(item => <button type="button" key={item.id} aria-pressed={activeSection === item.id} className={activeSection === item.id ? "active" : ""} onClick={() => setActiveSection(item.id)}><item.icon size={18} /><span>{productId === "panel" && item.id === "design" ? "Форма" : item.label}</span></button>)}
          </nav>}
          <div className="controls-body"><SectionContext.Provider value={activeSection}>
          {productId === "neon" ? <NeonControls project={project} measuredWidth={neonResult.design?.width} requiredBacker={requiredNeonBacker} onReferenceChange={event=>void handleImageUpload(event,value=>patchProject({neonReferenceImage:value}))} onChange={patchProject} onUndo={undoNeon} canUndo={canUndo} selectedLine={selectedNeonLine} onSelectLine={setSelectedNeonLine}/> : productId === "panel" ? (
            <PanelControls
              faceColor={panelFaceColor}
              imageScale={panelImageScale}
              imageX={panelImageX}
              imageY={panelImageY}
              panelImage={panelImage}
              shape={panelShape}
              sideColor={panelSideColor}
              size={panelSize}
              depth={project.panelDepth}
              wallGap={project.panelWallGap}
              mountMode={project.panelMountMode}
              onMountModeChange={value => patchProject({panelMountMode:value,panelWallGap:value==='corner'?Math.max(project.panelWallGap,project.panelDepth/2+20):project.panelWallGap})}
              cornerRadius={project.panelCornerRadius}
              onWallGapChange={value => setProject(previous => ({ ...previous, panelWallGap:previous.panelMountMode==='corner'?Math.max(value,previous.panelDepth/2+20):value }))}
              onCornerRadiusChange={value => setProject(previous => ({ ...previous, panelCornerRadius: value }))}
              onDepthChange={setPanelDepth}
              onFaceColorChange={setPanelFaceColor}
              onImageChange={(event) => void handleImageUpload(event, setPanelImage)}
              onImageScaleChange={setPanelImageScale}
              onImageXChange={setPanelImageX}
              onImageYChange={setPanelImageY}
              onShapeChange={setPanelShape}
              onSideColorChange={setPanelSideColor}
              onSizeChange={setPanelSize}
            />
          ) : (
            <LettersControls
              acpColor={acpColor}
              acpDepth={acpDepth}
              acpHeight={acpHeight}
              acpWidth={acpWidth}
              depth={letterDepth}
              faceColor={letterFaceColor}
              font={letterFont}
              frameBottomPosition={frameBottomPosition}
              frameEdgeInset={frameEdgeInset}
              frameProfile={frameProfile}
              frameTopPosition={frameTopPosition}
              glowMode={glowMode}
              haloBackerColor={haloBackerColor}
              haloBackerEnabled={haloBackerEnabled}
              height={letterHeight}
              width={measuredLettersWidth}
              widthAuto={letterWidth === 0}
              logoEnabled={logoEnabled}
              letterOutlineEnabled={letterOutlineEnabled}
              logoImage={logoImage}
              logoOutlineEnabled={logoOutlineEnabled}
              logoScale={logoScale}
              logoShape={logoShape}
              mountMode={mountMode}
              outlineColor={outlineColor}
              sideColor={letterSideColor}
              text={lettersText}
              onAcpColorChange={setAcpColor}
              onAcpDepthChange={setAcpDepth}
              onAcpHeightChange={setAcpHeight}
              onAcpWidthChange={setAcpWidth}
              onDepthChange={setLetterDepth}
              onFaceColorChange={setLetterFaceColor}
              onFrameBottomPositionChange={setFrameBottomPosition}
              onFrameEdgeInsetChange={setFrameEdgeInset}
              onFontChange={setLetterFont}
              onFrameTopPositionChange={setFrameTopPosition}
              onGlowModeChange={setGlowMode}
              onHaloBackerColorChange={setHaloBackerColor}
              onHaloBackerEnabledChange={setHaloBackerEnabled}
              onHeightChange={setLetterHeight}
              onWidthChange={setLetterWidth}
              onLogoEnabledChange={setLogoEnabled}
              onLetterOutlineEnabledChange={setLetterOutlineEnabled}
              onLogoChange={(event) => void handleImageUpload(event, value => { setLogoImage(value); setLogoEnabled(true); })}
              onLogoOutlineEnabledChange={setLogoOutlineEnabled}
              onLogoScaleChange={setLogoScale}
              onLogoShapeChange={setLogoShape}
              onMountModeChange={setMountMode}
              onOutlineColorChange={setOutlineColor}
              onSideColorChange={setLetterSideColor}
              onTextChange={setLettersText}
            />
          )}
          </SectionContext.Provider>
          {productId === "letters" && activeSection === "design" && <label className="builder-field"><span>Вторая строка</span><input maxLength={60} placeholder="Добавить надпись ниже" value={project.secondLineText} onChange={event => patchProject({ secondLineText: event.target.value })}/><small className="control-note">Строки центрируются относительно друг друга</small></label>}
          {productId === "neon" && (neonResult.error || !neonFits) && <p className="studio-fit-warning" role="alert">{neonResult.error || "Уменьшите высоту или длину надписи, чтобы она поместилась на подложке."}</p>}
          {activeSection === "logo" && (productId === "letters" ? logoImage : panelImage) && <button className="studio-remove" type="button" onClick={() => productId === "letters" ? setLogoImage("") : setPanelImage("")}><X size={14} />Удалить изображение</button>}
          {productId === "panel" && activeSection === "design" && <p className="control-note">Размер — диаметр круга или сторона квадрата, в миллиметрах.</p>}
          {productId === "letters" && activeSection === "mount" && mountMode === "acp" && (measuredLettersWidth > acpWidth || letterHeight > acpHeight) && <p className="studio-fit-warning" role="status">Надпись выходит за подложку. Увеличьте АКП минимум до {measuredLettersWidth} × {letterHeight} мм или уменьшите высоту букв.</p>}
          </div>
          <details className="studio-help"><summary>Как пользоваться студией<ChevronRight size={14} /></summary><p>Выберите тип вывески и настройте параметры по разделам. Переключайте день и ночь, чтобы оценить свечение. Проект сохраняется в этом браузере. Скачайте JSON для переноса на другое устройство.</p><p>Макет дает представление о конструкции. Цвета на экране могут отличаться от физических образцов Oracal; производственную документацию нужно подготовить отдельно.</p></details>
        </aside>
        <section ref={workspaceRef} style={{ "--workspace-height": `${previewHeight}px` } as CSSProperties} className={`studio-workspace scene-${sceneMode} ${viewMode === "3d" ? "is-3d" : ""}`} aria-label="Рабочий макет">
          <header className="canvas-toolbar"><div className="canvas-title"><strong>Предпросмотр</strong><span>{sceneMode === "day" ? "Дневное освещение" : "Ночное освещение"}</span></div>
            <button type="button" className={"sign-power-switch "+(project.lightsOn?'on':'off')} role="switch" aria-checked={project.lightsOn} aria-label="Свет вывески" title={project.lightsOn?'Выключить свет вывески':'Включить свет вывески'} onClick={()=>patchProject({lightsOn:!project.lightsOn})}><Power size={15}/><span className="power-caption">Свет</span><span className="power-lever" aria-hidden="true"/><span className="power-state">{project.lightsOn?'Вкл':'Выкл'}</span></button>
            <div className={"scene-switch " + sceneMode} role="group" aria-label="Режим визуализации">
              <span className="celestial-track" aria-hidden="true"><Sun className="celestial-sun" size={19}/><Moon className="celestial-moon" size={19}/></span>
              <button type="button" aria-pressed={sceneMode === "day"} className={sceneMode === "day" ? "active" : ""} onClick={() => setSceneMode("day")}><Sun size={16} />День</button>
              <button type="button" aria-pressed={sceneMode === "night"} className={sceneMode === "night" ? "active" : ""} onClick={() => setSceneMode("night")}><Moon size={16} />Ночь</button>
            </div><div className="canvas-tools"><button type="button" aria-label="Уменьшить макет" disabled={zoom <= 25} onClick={() => setZoom(value => Math.max(25, value - 10))}><Minus size={16} /></button><span className="zoom-value" title="100% — масштаб после подгонки">{zoom}%</span><button type="button" aria-label="Увеличить макет" disabled={zoom >= 400} onClick={() => setZoom(value => Math.min(400, value + 10))}><Plus size={16} /></button><button type="button" aria-label="Подогнать макет" onClick={handleFitPreview}><Maximize size={16} /></button></div>
          </header>
          <div className="canvas-mode-toolbar">
            <div className="view-switch" role="group" aria-label="Вид макета"><button type="button" aria-pressed={viewMode === "2d"} className={viewMode === "2d" ? "active" : ""} onClick={() => { setViewMode("2d"); setZoom(100); }}>2D</button><button type="button" aria-pressed={viewMode === "3d"} className={viewMode === "3d" ? "active" : ""} onClick={() => { setViewMode("3d"); setZoom(100); }}>3D · вращение</button></div>
            {productId !== "panel" && viewMode === "2d" && <button className={"editor-toggle " + (editing ? "active" : "")} type="button" aria-pressed={editing} onClick={() => { setPlacement("none"); setEditing(!editing); }}>Редактировать макет</button>}
            <label className="placement-select"><span>Размещение</span><select aria-label="Размещение в основном просмотре" value={placement} onChange={e=>{setPlacement(e.target.value as SignPlacement);setEditing(false);}}>{SIGN_PLACEMENTS.map(place=><option key={place.id} value={place.id}>{place.title}</option>)}</select></label>
            <label className="dimensions-toggle"><input type="checkbox" checked={showDimensions} onChange={event => setShowDimensions(event.target.checked)} />Размеры</label>
          </div>
          {productId === "letters" && viewMode === "2d" && editing && <div className="editor-toolbar">
            <button type="button" onClick={() => patchProject({ textOffsetX: 0, textOffsetY: 0, logoOffsetX: 0, logoOffsetY: 0 })}>По центру{mountMode === "acp" ? " подложки" : " макета"}</button>
            <button type="button" onClick={() => patchProject({ textOffsetX: lettersLayout.viewWidth / 2 - lettersLayout.textWidth / 2 - lettersLayout.defaultTextX, textOffsetY: lettersLayout.viewHeight / 2 - lettersLayout.textHeight / 2 - lettersLayout.defaultTextY })}>Центр надписи</button>
            {logoEnabled && <button type="button" onClick={() => patchProject({ logoOffsetX: lettersLayout.viewWidth / 2 - lettersLayout.logoBox.width / 2 - lettersLayout.defaultLogoX, logoOffsetY: lettersLayout.viewHeight / 2 - lettersLayout.logoBox.height / 2 - lettersLayout.defaultLogoY })}>Центр логотипа</button>}
            <button type="button" onClick={() => { patchProject({ secondLineText: project.secondLineText || "НОВАЯ СТРОКА" }); setActiveSection("design"); }}>+ Строка ниже</button>
            <label><input type="checkbox" checked={mountMode === "acp"} onChange={e=>setMountMode(e.target.checked ? "acp" : "frame")}/>Подложка</label>
          </div>}
          {productId === "neon" && viewMode === "2d" && editing && <div className="editor-toolbar neon-inline-toolbar" aria-label="Настройки выбранной строки на макете">
            <label><span>Строка</span><select aria-label="Выбранная строка на макете" value={selectedNeonLine} onChange={event=>setSelectedNeonLine(Number(event.target.value))}>{project.neonText.split('\n').map((_,index)=><option key={index} value={index}>{index+1}</option>)}</select></label>
            <label><span>Шрифт</span><select aria-label="Шрифт выбранной строки" value={project.neonLineFonts[selectedNeonLine]||project.neonFont} onChange={event=>patchProject({neonLineFonts:Array.from({length:3},(_,index)=>index===selectedNeonLine?event.target.value:project.neonLineFonts[index]||project.neonFont)})}>{NEON_FONTS.map(font=><option key={font.id} value={font.id} disabled={neonUnsupportedCharacters(project.neonText.split('\n')[selectedNeonLine]||'',font.id).length>0}>{font.label}</option>)}</select></label>
            <input type="color" aria-label="Цвет выбранной строки" value={project.neonLineColors[selectedNeonLine]||project.neonColor} onChange={event=>patchProject({neonLineColors:Array.from({length:3},(_,index)=>index===selectedNeonLine?event.target.value:project.neonLineColors[index]||project.neonColor)})}/>
            <button type="button" onClick={()=>patchProject({neonLineOffsets:Array.from({length:3},(_,index)=>index===selectedNeonLine?{x:0,y:0}:project.neonLineOffsets[index]||{x:0,y:0})})}>Центровать</button>
          </div>}
        <section
          className={`builder-preview ${sceneMode} glow-${glowMode} view-mode-${viewMode}`}
          aria-label="Визуализация"
        >
          {(fontPending && productId === "letters" || productId === "neon" && neonFontReady!==neonFontKey && !neonFontError) && <div className="studio-font-loading" role="status">Обновляем шрифт…</div>}
          {viewMode === "3d" && !(productId === "neon" && (!neonResult.design || !neonFits)) ? <SceneBoundary onFail={handle3DUnavailable}><Suspense fallback={<div className="studio-3d-loading" role="status">Строим объемную модель…</div>}><SignScene3D project={project} layout={lettersLayout} width={signWidth} height={signHeight} depth={signDepth} showDimensions={showDimensions} zoom={zoom} onZoomChange={setZoom} placement={placement} resetKey={fitSignal} onUnavailable={handle3DUnavailable} /></Suspense></SceneBoundary> : <div className="preview-wall"><div className="preview-art" style={{ "--preview-zoom": zoom / 100 } as CSSProperties}>
            {placement!=="none" ? <SvgMarkupPreview className="facade-svg-render" markup={createFacadeSvg(placement,createCurrentSvg(false),sceneMode==="night",'canvas',{palette:project.facadePalette,signBox:facadeSignBox,panelMount})}/> : project.backdropImage&&!editing ? <SignPhotoPreview image={project.backdropImage} imageWidthMm={project.backdropWidth} markup={createCurrentSvg(showDimensions)} night={sceneMode==='night'}/> : productId === "neon" ? <SvgMarkupPreview className="letters-svg-render" markup={neonResult.design && neonFits ? createCurrentSvg(showDimensions) : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 180"><text x="200" y="90" text-anchor="middle" fill="#788f83" font-family="Arial" font-size="14">Настройте надпись и размеры</text></svg>'}>{editing&&neonResult.design&&neonFits&&<NeonStudioEditor design={neonResult.design} backerWidth={neonWidth} backerHeight={neonHeight} project={project} onChange={patchProject} selectedLine={selectedNeonLine} onSelectLine={setSelectedNeonLine}/>}</SvgMarkupPreview> : productId === "panel" ? (
              <PanelPreview
                lightsOn={project.lightsOn}
                image={panelImage}
                shape={panelShape}
                sideColor={panelSideColor.value}
                faceColor={panelFaceColor.value}
                imageScale={panelImageScale}
                imageX={panelImageX}
                imageY={panelImageY}
                sceneMode={sceneMode}
                size={panelSize}
                depth={project.panelDepth}
                wallGap={project.panelWallGap}
                mountMode={project.panelMountMode}
                cornerRadius={project.panelCornerRadius}
                showDimensions={showDimensions}
              />
            ) : (
              <LettersPreview
                lightsOn={project.lightsOn}
                editor={editing ? <SignLayoutEditor layout={lettersLayout} project={project} onChange={patchProject}/> : undefined}
                sceneMode={sceneMode}
                acpDepth={acpDepth}
                acpColor={acpColor.value}
                depth={letterDepth}
                faceColor={letterFaceColor.value}
                font={letterFont}
                frameProfile={frameProfile}
                glowMode={glowMode}
                haloBackerColor={haloBackerColor.value}
                haloBackerEnabled={glowHasHalo && haloBackerEnabled && mountMode === "wall"}
                logoEnabled={logoEnabled}
                showDimensions={showDimensions}
                height={letterHeight}
                layout={lettersLayout}
                letterOutlineEnabled={letterOutlineEnabled}
                logoImage={logoImage}
                logoOutlineEnabled={logoOutlineEnabled}
                logoShape={logoShape}
                mountMode={mountMode}
                outlineColor={outlineColor.value}
                sideColor={letterSideColor.value}
                text={lettersText}
              />
            )}
          </div></div>}
          {showDimensions && <div className="canvas-dimensions"><span className="dimension-line" /><span>{signWidth} × {signHeight} × {signDepth} мм</span><span className="dimension-line" /></div>}
        </section>
          <footer className="canvas-footer"><span><span className={`material-dot ${sceneMode}`} />{placement !== "none" ? `Дверь 1100 × 2100 мм${placement === "canopy" ? " · вынос козырька 1500 мм" : ""}` : productId === "letters" ? `${letterDepth} мм — до передней плоскости рамы` : productId === "neon" ? "Неон " + project.neonDiameter + " мм · " +(project.neonBackerColor==='black'?'черная':project.neonBackerColor==='white'?'белая':'прозрачная')+" подложка" : "Лицевое свечение"}</span><button type="button" onClick={handleFitPreview}><RotateCcw size={13} />Масштаб по размеру окна</button></footer>
        </section>

        <SignPlacements panelMount={panelMount} markup={createCurrentSvg(false)} signBox={facadeSignBox} night={sceneMode === "night"} selected={placement} palette={project.facadePalette} onPaletteChange={value=>patchProject({facadePalette:value})} onChange={value=>{setPlacement(value);setEditing(false);}}>
          <details className="photo-backdrop-controls"><summary>Примерить на своём фото</summary><label className="studio-button photo-upload"><ImagePlus size={16}/>Загрузить фасад<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>void handleImageUpload(event,value=>{patchProject({backdropImage:value});setPlacement('none');setEditing(false);})}/></label><p>PNG, JPG или WebP до 2 МБ. Укажите ширину участка на фотографии для примерного масштаба.</p>{project.backdropImage&&<><label className="builder-field"><span>Ширина участка на фото, мм</span><input type="number" min={500} max={20000} step={100} value={project.backdropWidth} onChange={event=>patchProject({backdropWidth:Math.max(500,Math.min(20000,Number(event.target.value)||500))})}/></label><button type="button" className="studio-remove" onClick={()=>patchProject({backdropImage:''})}><X size={14}/>Убрать фото</button></>}</details>
        </SignPlacements>
        <aside className="builder-summary" aria-label="Структура проекта"><header className="summary-heading"><h2>Ваш проект</h2><p>Параметры конструкции</p></header>
          <div className="summary-block">
            <span>Продукт</span>
            <strong>{activeProduct.title}</strong>
          </div>
          <div className="summary-block">
            <span>Габарит</span>
            <strong>
              {`${signWidth} × ${signHeight} × ${signDepth} мм`}
            </strong>
          </div>
          <div className="summary-block">
            <span>Свечение</span>
            <strong>{productId === "neon" ? "Неоновая трубка " + project.neonDiameter + " мм" : productId === "letters" ? glowLabel : "Лицевое"}</strong>
          </div>
          <div className="summary-block">
            <span>Монтаж</span>
            <strong>
              {productId === "letters"
                ? mountMode === "frame"
                  ? frameNeedsApproval ? `${mountLabel} — по согласованию` : `${mountLabel}, профиль 15 × 15 мм`
                  : mountLabel
                : productId === "neon" ? project.neonInstallMode==='hanging'?'Два подвеса':"Дистанционные держатели · 20 мм" : `${project.panelMountMode==='corner'?'На углу · по диагонали':project.panelMountMode==='corner-front'?'На углу · первая стена':project.panelMountMode==='corner-side'?'На углу · вторая стена':'Перпендикулярно стене'} · отступ ${project.panelWallGap} мм`}
            </strong>
          </div>
          <div className="summary-block">
            <span>{productId === "neon" ? "Цвет неона" : "Лицевая пленка"}</span>
            <strong>{productId === "neon" ? [...new Set(project.neonText.split('\n').flatMap((text,index)=>text.trim()?[project.neonLineColors[index]||project.neonColor]:[]))].join(' · ') : currentFaceColor.code + " " + currentFaceColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>{productId === "neon" ? "Подложка" : "Борт"}</span>
            <strong>{productId === "neon" ? (project.neonBackerColor==='black'?'Черная':project.neonBackerColor==='white'?'Белая':'Прозрачная')+" · 3 мм" : currentSideColor.code + " " + currentSideColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>{productId === "letters" ? "Габаритная площадь" : "Площадь лица"}</span>
            <strong>{formatArea(productId === "neon" ? neonWidth * neonHeight / 1_000_000 : productId === "panel" ? panelAreaM2 : lettersAreaM2)} м²</strong>
          </div>
          {productId === "letters" && (
            <div className="summary-block">
              <span>Кантик</span>
              <strong>
                {letterOutlineEnabled || logoOutlineEnabled
                  ? `${outlineColor.code} ${outlineColor.name}`
                  : "без кантика"}
              </strong>
            </div>
          )}

          <div className="studio-purchase">
            <div className="price-details"><span>{productId === "letters" ? "Стоимость букв" : "Стоимость вывески"}</span><strong className="price-total">{productId === "letters" && letterPrice.letterCount > 0 ? formatMoney(letterPrice.total) : "По согласованию"}</strong>
            {productId === "letters" && letterPrice.letterCount > 0 && <p className="price-formula">{letterPrice.letterCount} букв × {letterPrice.heightCm} см × 120 ₽</p>}</div>
            <button className="studio-add-cart" type="button" onClick={handleAddToCart} disabled={productId === "neon" ? !neonResult.design || !neonFits || !project.neonText.trim() : productId === "letters" && (fontPending || !letterContours || !lettersText.trim() && !logoEnabled)}><ShoppingCart size={18} />В корзину</button>
            {priceNotes.length > 0 && <p className="price-notes">{priceNotes.join(" ")}</p>}
            <p className="purchase-basis">{productId === "letters" ? "120 ₽ за 1 см высоты каждой буквы. Пробелы не считаются. Монтаж, подложка и доставка рассчитываются отдельно." : "Сохраните макет в корзину для согласования стоимости."}</p>
          </div>
        </aside>
      </section>
    </main>
  );
}

class SceneBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function PanelControls({
  mountMode, onMountModeChange,
  wallGap, cornerRadius, onWallGapChange, onCornerRadiusChange,
  faceColor,
  imageScale,
  imageX,
  imageY,
  panelImage,
  shape,
  sideColor,
  size,
  depth,
  onDepthChange,
  onFaceColorChange,
  onImageChange,
  onImageScaleChange,
  onImageXChange,
  onImageYChange,
  onShapeChange,
  onSideColorChange,
  onSizeChange,
}: {
  mountMode: PanelMountMode;
  onMountModeChange: (value: PanelMountMode) => void;
  wallGap: number;
  cornerRadius: number;
  onWallGapChange: (value: number) => void;
  onCornerRadiusChange: (value: number) => void;
  faceColor: ColorOption;
  imageScale: number;
  imageX: number;
  imageY: number;
  panelImage: string;
  shape: PanelShape;
  sideColor: ColorOption;
  size: number;
  depth: number;
  onDepthChange: (value: number) => void;
  onFaceColorChange: (color: ColorOption) => void;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImageScaleChange: (value: number) => void;
  onImageXChange: (value: number) => void;
  onImageYChange: (value: number) => void;
  onShapeChange: (shape: PanelShape) => void;
  onSideColorChange: (color: ColorOption) => void;
  onSizeChange: (size: number) => void;
}) {
  return (
    <>
      <ControlSection title="Форма">
        <div className="option-grid three">
          {PANEL_SHAPES.map((item) => (
            <button
              aria-pressed={shape === item.id} className={shape === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onShapeChange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {shape === "rounded" && <NumberField label="Радиус углов, мм" min={0} max={Math.min(300, size / 2)} value={Math.min(cornerRadius, size / 2)} onChange={onCornerRadiusChange} />}
      </ControlSection>

      <ControlSection title="Размер">
        <div className="dimension-number-grid"><NumberField label="Размер панели, мм" min={200} max={2000} value={size} onChange={onSizeChange} /><NumberField label="Глубина панели, мм" min={30} max={160} value={depth} onChange={onDepthChange} /></div>
        <div className="size-grid">
          {PANEL_SIZES.map((item) => (
            <button
              aria-pressed={size === item} className={size === item ? "active" : ""}
              key={item}
              onClick={() => onSizeChange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </ControlSection>

      <ControlSection title="Крепление к стене">
        <div className="option-grid two" role="group" aria-label="Монтаж панели-кронштейна">
          <button type="button" aria-pressed={mountMode==='wall'} className={mountMode==='wall'?'active':''} onClick={()=>onMountModeChange('wall')}>На стене</button>
          <button type="button" aria-pressed={isPanelCornerMount(mountMode)} className={isPanelCornerMount(mountMode)?'active':''} onClick={()=>onMountModeChange(isPanelCornerMount(mountMode)?mountMode:'corner-front')}>На углу здания</button>
        </div>
        {isPanelCornerMount(mountMode) && <div className="builder-field">
          <span>Положение на углу</span>
          <div className="option-grid three" role="group" aria-label="Положение панели на углу">
            <button type="button" aria-pressed={mountMode==='corner-front'} className={mountMode==='corner-front'?'active':''} onClick={()=>onMountModeChange('corner-front')}>Первая стена</button>
            <button type="button" aria-pressed={mountMode==='corner-side'} className={mountMode==='corner-side'?'active':''} onClick={()=>onMountModeChange('corner-side')}>Вторая стена</button>
            <button type="button" aria-pressed={mountMode==='corner'} className={mountMode==='corner'?'active':''} onClick={()=>onMountModeChange('corner')}>По диагонали</button>
          </div>
        </div>}
        <NumberField label={mountMode==='corner'?"Отступ корпуса от угла, мм":isPanelCornerMount(mountMode)?"Отступ от выбранной стены, мм":"Отступ корпуса от стены, мм"} min={mountMode==='corner'?Math.max(60,depth/2+20):60} max={400} value={wallGap} onChange={onWallGapChange} />
        <p className="control-note">{mountMode==='corner'?"Панель выступает по диагонали от наружного угла. Кронштейн опирается на обе стены.":isPanelCornerMount(mountMode)?"Панель стоит перпендикулярно выбранной стене рядом с углом. Обе консоли закреплены на этой стене.":"Двусторонняя панель стоит перпендикулярно фасаду. Две консоли закреплены на монтажных пластинах у стены."}</p>
      </ControlSection>

      <ControlSection title="Изображение">
        <label className="public-upload">
          <Upload size={17} />
          {panelImage ? "Заменить изображение" : "Загрузить изображение"}
          <input accept="image/png,image/jpeg,image/webp" onChange={onImageChange} type="file" />
        </label>
        <small className="control-note">PNG, JPG или WebP · до 2 МБ. Изображение наносится на обе стороны.</small>
        <RangeField label="Масштаб" max={130} min={45} onChange={onImageScaleChange} value={imageScale} />
        <RangeField label="Сдвиг X" max={40} min={-40} onChange={onImageXChange} value={imageX} />
        <RangeField label="Сдвиг Y" max={40} min={-40} onChange={onImageYChange} value={imageY} />
      </ControlSection>

      <ControlSection title="Лицо Oracal 8500">
        <ColorGrid colors={ORACAL_8500_COLORS} selected={faceColor} onSelect={onFaceColorChange} />
      </ControlSection>

      <ControlSection title="Борт Oracal 641">
        <ColorGrid colors={ORACAL_641_COLORS} selected={sideColor} onSelect={onSideColorChange} compact />
      </ControlSection>
    </>
  );
}

function LettersControls({
  acpColor,
  acpDepth,
  acpHeight,
  acpWidth,
  depth,
  faceColor,
  font,
  frameBottomPosition,
  frameEdgeInset,
  frameProfile,
  frameTopPosition,
  glowMode,
  haloBackerColor,
  haloBackerEnabled,
  height,
  width,
  widthAuto,
  logoEnabled,
  letterOutlineEnabled,
  logoImage,
  logoOutlineEnabled,
  logoScale,
  logoShape,
  mountMode,
  outlineColor,
  sideColor,
  text,
  onAcpColorChange,
  onAcpDepthChange,
  onAcpHeightChange,
  onAcpWidthChange,
  onDepthChange,
  onFaceColorChange,
  onFrameBottomPositionChange,
  onFrameEdgeInsetChange,
  onFontChange,
  onFrameTopPositionChange,
  onGlowModeChange,
  onHaloBackerColorChange,
  onHaloBackerEnabledChange,
  onHeightChange,
  onWidthChange,
  onLogoEnabledChange,
  onLetterOutlineEnabledChange,
  onLogoChange,
  onLogoOutlineEnabledChange,
  onLogoScaleChange,
  onLogoShapeChange,
  onMountModeChange,
  onOutlineColorChange,
  onSideColorChange,
  onTextChange,
}: {
  acpColor: ColorOption;
  acpDepth: number;
  acpHeight: number;
  acpWidth: number;
  depth: number;
  faceColor: ColorOption;
  font: string;
  frameBottomPosition: number;
  frameEdgeInset: number;
  frameProfile: FrameProfile;
  frameTopPosition: number;
  glowMode: GlowMode;
  haloBackerColor: ColorOption;
  haloBackerEnabled: boolean;
  height: number;
  width: number;
  widthAuto: boolean;
  logoEnabled: boolean;
  letterOutlineEnabled: boolean;
  logoImage: string;
  logoOutlineEnabled: boolean;
  logoScale: number;
  logoShape: LogoShape;
  mountMode: MountMode;
  outlineColor: ColorOption;
  sideColor: ColorOption;
  text: string;
  onAcpColorChange: (color: ColorOption) => void;
  onAcpDepthChange: (value: number) => void;
  onAcpHeightChange: (value: number) => void;
  onAcpWidthChange: (value: number) => void;
  onDepthChange: (value: number) => void;
  onFaceColorChange: (color: ColorOption) => void;
  onFrameBottomPositionChange: (value: number) => void;
  onFrameEdgeInsetChange: (value: number) => void;
  onFontChange: (font: string) => void;
  onFrameTopPositionChange: (value: number) => void;
  onGlowModeChange: (mode: GlowMode) => void;
  onHaloBackerColorChange: (color: ColorOption) => void;
  onHaloBackerEnabledChange: (value: boolean) => void;
  onHeightChange: (value: number) => void;
  onWidthChange: (value: number) => void;
  onLogoEnabledChange: (value: boolean) => void;
  onLetterOutlineEnabledChange: (value: boolean) => void;
  onLogoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onLogoOutlineEnabledChange: (value: boolean) => void;
  onLogoScaleChange: (value: number) => void;
  onLogoShapeChange: (shape: LogoShape) => void;
  onMountModeChange: (mode: MountMode) => void;
  onOutlineColorChange: (color: ColorOption) => void;
  onSideColorChange: (color: ColorOption) => void;
  onTextChange: (value: string) => void;
}) {
  const glowHasHalo = hasHaloGlow(glowMode);

  return (
    <>
      <ControlSection title="Надпись">
        <label className="builder-field">
          <span>Текст</span>
          <input maxLength={60} placeholder="Например, ЦВЕТЫ" value={text} onChange={(event) => onTextChange(event.target.value)} /><small className="control-note">До 60 символов · размеры рассчитываются по надписи</small>
        </label>
        <label className="builder-field">
          <span>Шрифт</span>
          <select value={font} onChange={(event) => onFontChange(event.target.value)}>
            {LETTER_FONTS.map((fontOption) => (
              <option key={fontOption.label} value={fontOption.value} disabled={!fontOption.file && !systemFontAvailable(fontOption.value.split(",")[0].replace(/"/g,""),fontOption.weight)}>
                {fontOption.label}
              </option>
            ))}
          </select>
          <small className="control-note">14 встроенных шрифтов + системные Arial и Arial Black. Контуры одинаковы в 2D и 3D.</small>
        </label>
        <div className="dimension-number-grid">
          <NumberField label="Ширина вывески, мм" min={Math.round(height * (logoEnabled ? Math.min(1.3, Math.max(0.45, logoScale / 100)) + 0.46 : 0.3))} max={20000} onChange={onWidthChange} value={width} />
          <NumberField label="Высота букв, мм" min={40} max={1200} onChange={onHeightChange} value={height} />
        </div>
        <label className={"width-auto-checkbox " + (widthAuto ? "checked" : "")}><input type="checkbox" checked={widthAuto} onChange={event => onWidthChange(event.target.checked ? 0 : width)}/><span><strong>Ширина по пропорциям</strong><small>{widthAuto ? "Сохраняем естественные пропорции шрифта" : "Ширину можно менять вручную"}</small></span></label>
        <label className="builder-field"><span>Глубина букв до рамы, мм</span><select value={depth} onChange={event => onDepthChange(Number(event.target.value))}>{(allowedLetterDepths(height).length ? allowedLetterDepths(height) : [60]).map(value => <option key={value} value={value}>{value} мм{height > 550 ? " · по согласованию" : ""}</option>)}</select><small className="control-note">40 мм — до 18 см; 50 мм — 12–35 см; 60 мм — 20–55 см. Выносные элементы в высоту не входят.</small></label>
      </ControlSection>

      <ControlSection title="Свечение">
        <div className="option-grid glow-grid">
          {GLOW_MODES.map((item) => (
            <button
              aria-pressed={glowMode === item.id} className={glowMode === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onGlowModeChange(item.id)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.note}</span>
            </button>
          ))}
        </div>
      </ControlSection>

      <ControlSection title="Размещение">
        <div className="option-grid mount-grid">
          {MOUNT_MODES.map((item) => (
            <button
              aria-pressed={mountMode === item.id} className={mountMode === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onMountModeChange(item.id)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.note}</span>
            </button>
          ))}
        </div>
      </ControlSection>

      {mountMode === "frame" && (
        <ControlSection title="Рама">
          <div className={`frame-policy ${height > 550 ? "warning" : ""}`}><strong className="frame-profile">{height > 550 ? "Рама по согласованию" : "Профиль 15 × 15 мм"}</strong><p>{height > 550 ? "Буквы выше 55 см. Сечение и конструкцию рамы согласуем перед изготовлением. В макете показан профиль 15 мм." : "Для букв высотой до 55 см включительно. Две горизонтальные трубы за буквами."}</p></div>
          <RangeField label="Отступ рамы от края, мм" max={120} min={0} onChange={onFrameEdgeInsetChange} step={5} value={frameEdgeInset} />
          <RangeField label="Верхний отступ рамы, мм" max={20} min={10} onChange={onFrameTopPositionChange} value={frameTopPosition} />
          <RangeField label="Нижний отступ рамы, мм" max={20} min={10} onChange={onFrameBottomPositionChange} value={frameBottomPosition} /><p className="control-note">Отступы от общей линии букв до наружного края трубы. Хвосты и надстрочные элементы не учитываются.</p>
          <small className="control-note">Положение и длина труб показаны в 2D и 3D в масштабе вывески.</small>
        </ControlSection>
      )}

      {mountMode === "acp" && (
        <ControlSection title="Подложка АКП">
          <div className="sign-size-grid">
            <NumberField label="Ширина, мм" min={400} max={backerLimits(acpDepth).width} onChange={onAcpWidthChange} value={acpWidth} />
            <NumberField label="Высота, мм" min={250} max={backerLimits(acpDepth).height} onChange={onAcpHeightChange} value={acpHeight} />
          </div>
          <RangeField label="Глубина подложки, мм" max={100} min={30} onChange={onAcpDepthChange} step={5} value={acpDepth} />
          <small className="control-note">Допустимые размеры рассчитываются автоматически.</small>
          <ColorGrid colors={ACP_COLORS} selected={acpColor} onSelect={onAcpColorChange} compact />
        </ControlSection>
      )}

      {glowHasHalo && mountMode !== "frame" && (
        <ControlSection title="Контражурная подложка">
          <div className="toggle-grid">
            <button
              aria-pressed={haloBackerEnabled} className={haloBackerEnabled ? "active" : ""}
              onClick={() => onHaloBackerEnabledChange(!haloBackerEnabled)}
              type="button"
            >
              Подложка контуром вокруг букв
            </button>
          </div>
          {haloBackerEnabled && (
            <ColorGrid colors={ACP_COLORS} selected={haloBackerColor} onSelect={onHaloBackerColorChange} compact />
          )}
        </ControlSection>
      )}

      <ControlSection title="Кантик">
        <div className="toggle-grid">
          <button
            aria-pressed={letterOutlineEnabled} className={letterOutlineEnabled ? "active" : ""}
            onClick={() => onLetterOutlineEnabledChange(!letterOutlineEnabled)}
            type="button"
          >
            Кантик букв
          </button>
          <button
            aria-pressed={logoOutlineEnabled} className={logoOutlineEnabled ? "active" : ""}
            onClick={() => onLogoOutlineEnabledChange(!logoOutlineEnabled)}
            type="button"
          >
            Кантик логотипа
          </button>
        </div>
        {(letterOutlineEnabled || logoOutlineEnabled) && (
          <ColorGrid colors={ORACAL_641_COLORS} selected={outlineColor} onSelect={onOutlineColorChange} compact />
        )}
      </ControlSection>

      <ControlSection title="Логотип">
        <label className="dimensions-toggle"><input type="checkbox" checked={logoEnabled} onChange={event => onLogoEnabledChange(event.target.checked)} />Добавить логотип</label>
        {logoEnabled && <div className="option-grid three">
          {LOGO_SHAPES.map((item) => (
            <button
              aria-pressed={logoShape === item.id} className={logoShape === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onLogoShapeChange(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>}
        <label className="public-upload">
          <Upload size={17} />
          {logoImage ? "Заменить логотип" : "Загрузить логотип"}
          <input accept="image/png,image/jpeg,image/webp" onChange={onLogoChange} type="file" />
        </label>
        <small className="control-note">PNG, JPG или WebP · до 2 МБ</small>
        {logoEnabled && <RangeField label="Масштаб логотипа" max={130} min={45} onChange={onLogoScaleChange} value={logoScale} />}
        <small className="control-note">Стоимость логотипа согласуем отдельно.</small>
      </ControlSection>

      <ControlSection title="Лицо Oracal 8500">
        <ColorGrid colors={ORACAL_8500_COLORS} selected={faceColor} onSelect={onFaceColorChange} />
      </ControlSection>

      <ControlSection title="Борт Oracal 641">
        <ColorGrid colors={ORACAL_641_COLORS} selected={sideColor} onSelect={onSideColorChange} compact />
      </ControlSection>
    </>
  );
}

function PanelPreview({
  mountMode,
  lightsOn,
  depth, wallGap, cornerRadius,
  image,
  shape,
  sideColor,
  faceColor,
  imageScale,
  imageX,
  imageY,
  sceneMode,
  size,
  showDimensions,
}: {
  lightsOn?:boolean;
  depth: number;
  wallGap: number;
  cornerRadius: number;
  image: string;
  mountMode: PanelMountMode;
  shape: PanelShape;
  sideColor: string;
  faceColor: string;
  imageScale: number;
  imageX: number;
  imageY: number;
  sceneMode: SceneMode;
  size: number;
  showDimensions: boolean;
}) {
  const markup = createPanelSvgMarkup({ image, shape, sideColor, faceColor, imageScale, imageX, imageY, sceneMode, size, depth, wallGap, mountMode, cornerRadius, showDimensions, lightsOn, flat: true });
  return <SvgMarkupPreview className="panel-svg-render" markup={markup.replace(/<\?xml[^>]*\?>\s*/, "")} />;
}

/** Keep measurement text readable in screen pixels, including a very wide sign on a phone. */
function SvgMarkupPreview({ className, markup, children }: { className: string; markup: string; children?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const prior = useRef(markup);
  const [previous, setPrevious] = useState('');
  const facadeNight = /data-facade-night="true"/.test(markup);
  const lastWindowMode = useRef(facadeNight);
  const [windowsLit, setWindowsLit] = useState(facadeNight);
  useEffect(() => {
    if (lastWindowMode.current === facadeNight) return;
    lastWindowMode.current = facadeNight;
    if (!facadeNight || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setWindowsLit(facadeNight); return;
    }
    setWindowsLit(false);
    const timer = window.setTimeout(() => setWindowsLit(true), SCENE_LIGHTING_TIMING.windowsDelayMs);
    return () => window.clearTimeout(timer);
  }, [facadeNight]);
  useEffect(() => {
    const isNight = (value: string) => /data-facade-night="true"|ночной|#d5e8e1/.test(value);
    const kind = (value:string)=>value.match(/aria-label="([^"]+)"/)?.[1];
    if (kind(prior.current)===kind(markup) && isNight(prior.current) !== isNight(markup) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrevious(prior.current);
      const timer = window.setTimeout(() => setPrevious(''), 780);
      prior.current = markup;
      return () => window.clearTimeout(timer);
    }
    prior.current = markup; setPrevious("");
  }, [markup]);
  const [labels, setLabels] = useState<{text: string; x: number; y: number; vertical: boolean}[]>([]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const scaleX = element.clientWidth / bounds.width, scaleY = element.clientHeight / bounds.height;
      setLabels(Array.from(element.querySelectorAll<SVGTextElement>(".studio-svg-layer:not(.studio-svg-previous) [data-dimensions] text")).map(text => {
        const rect = text.getBoundingClientRect();
        const vertical = Boolean(text.getAttribute("transform")?.includes("rotate"));
        const edgeX = vertical ? 10 : 44, edgeY = vertical ? 44 : 10;
        return { text: text.textContent ?? "", vertical,
          x: clamp((rect.x + rect.width / 2 - bounds.x) * scaleX, edgeX, element.clientWidth - edgeX),
          y: clamp((rect.y + rect.height / 2 - bounds.y) * scaleY, edgeY, element.clientHeight - edgeY) };
      }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [markup]);
  return <div className={className + (windowsLit ? " windows-lit" : " windows-dark")} ref={host} data-window-lights={windowsLit ? "on" : "off"}>
    <div className="studio-svg-layer" dangerouslySetInnerHTML={{ __html: markup }} />
    {previous && <div className="studio-svg-layer studio-svg-previous" aria-hidden="true" dangerouslySetInnerHTML={{__html:previous.replace(/id="([^"]+)"/g, (_a,id:string)=>`id="previous-${id}"`).replace(/url\(#([^\)]+)\)/g, (_a,id:string)=>`url(#previous-${id})`)}}/>}
    {children}
    <div className="studio-measure-labels" aria-hidden="true">{labels.map((label, index) => <span key={index}
      style={{ left: label.x, top: label.y, transform: `translate(-50%, -50%)${label.vertical ? " rotate(-90deg)" : ""}` }}>{label.text}</span>)}</div>
  </div>;
}

function LettersPreview({
  lightsOn,
  editor,
  acpColor,
  acpDepth,
  depth,
  faceColor,
  font,
  frameProfile,
  glowMode,
  haloBackerColor,
  haloBackerEnabled,
  logoEnabled,
  showDimensions,
  height,
  layout,
  letterOutlineEnabled,
  logoImage,
  logoOutlineEnabled,
  logoShape,
  mountMode,
  outlineColor,
  sceneMode = "day",
  sideColor,
  text,
}: {
  lightsOn?:boolean;
  acpColor: string;
  acpDepth?: number;
  editor?: ReactNode;
  depth: number;
  faceColor: string;
  font: string;
  frameProfile: FrameProfile;
  glowMode: GlowMode;
  haloBackerColor: string;
  haloBackerEnabled: boolean;
  logoEnabled: boolean;
  showDimensions: boolean;
  height: number;
  layout: LettersSvgLayout;
  letterOutlineEnabled: boolean;
  logoImage: string;
  logoOutlineEnabled: boolean;
  logoShape: LogoShape;
  mountMode: MountMode;
  outlineColor: string;
  sceneMode?: SceneMode;
  sideColor: string;
  text: string;
}) {
  const svg = createLettersSvgMarkup({
    lightsOn,
    acpColor, acpDepth, depth, faceColor, font, glowMode, haloBackerColor,
    haloBackerEnabled, height, layout, letterOutlineEnabled,
    logoImage, logoOutlineEnabled, logoShape, mountMode, outlineColor,
    sceneMode, sideColor, text, logoEnabled, showDimensions,
  }).replace(/^<\?xml[^>]*\?>\s*/, "");

  return (
    <div className={"letters-scene mount-" + mountMode + (haloBackerEnabled ? " with-halo-backer" : "")}>
      <SvgMarkupPreview className="letters-svg-render" markup={svg}>{editor}</SvgMarkupPreview>
      <div className="preview-dimension">
        h {height} мм · глубина до рамы {depth} мм
        {mountMode === "frame" ? " · профиль " + frameProfile + "x" + frameProfile + " · рама " + Math.round(layout.railWidth) + " мм" : ""}
      </div>
    </div>
  );
}

function ControlSection({ children, title }: { children: ReactNode; title: string }) {
  const active = useContext(SectionContext);
  if (SECTION_GROUPS[title] !== active) return null;
  return (
    <section className="control-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ColorGrid({
  colors,
  compact = false,
  selected,
  onSelect,
}: {
  colors: ColorOption[];
  compact?: boolean;
  selected: ColorOption;
  onSelect: (color: ColorOption) => void;
}) {
  return (
    <div className={compact ? "color-grid compact" : "color-grid"}>
      {colors.map((color) => (
        <button
          className={selected.code === color.code ? "active" : ""}
          aria-pressed={selected.code === color.code}
          aria-label={`${color.code} ${color.name}`}
          key={`${color.code}-${color.name}`}
          onClick={() => onSelect(color)}
          title={`${color.code} ${color.name}`}
          type="button"
        >
          <i style={{ background: color.value }} />
          <span>{color.code}</span>
          <strong>{color.name}</strong>
        </button>
      ))}
    </div>
  );
}

function RangeField({
  label,
  max,
  min,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  max: number;
  min: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="builder-field range-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{value}</strong>
    </label>
  );
}

function NumberField({
  label,
  min,
  max: suppliedMax,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const max = suppliedMax ?? (label.startsWith("Ширина") ? 20000 : 10000);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const next = Math.min(max, readPositiveInteger(draft, value, min)); setDraft(String(next)); onChange(next); };
  return (
    <label className="builder-field">
      <span>{label}</span>
      <input
        min={min}
        max={max}
        type="number"
        value={draft}
        onChange={event => { const raw = event.target.value; setDraft(raw); const next = Number(raw); if (raw && Number.isFinite(next) && next >= min && next <= max) onChange(Math.round(next)); }}
        onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") commit(); }}
      />
    </label>
  );
}

function createLettersSvgLayout(config: LettersSvgLayoutConfig): LettersSvgLayout {
  const requestedHeight = clamp(config.height, 40, 1200);
  const factor = config.contours?.lineFactor ?? 1;
  const natural = config.contours?.mainBox ?? config.textBox ?? { x: 0, y: -714, width: Math.max(1, config.text.length) * 640, height: 714 };
  const logoEnabled = Boolean(config.logoEnabled);
  const requestedLogo = logoEnabled ? requestedHeight * clamp(config.logoScale, 45, 130) / 100 : 0;
  const requestedGap = logoEnabled ? requestedHeight * LETTER_GAP_FACTOR : 0;
  const outline = config.letterOutlineEnabled ? Math.max(4, requestedHeight * .035) : 0;
  const requestedTextHeight = (requestedHeight - outline * 2) * factor;
  const naturalWidth = requestedTextHeight * natural.width / natural.height;
  const requestedWidth = config.widthOverride ? Math.max(requestedLogo + requestedGap + 20, config.widthOverride) : requestedLogo + requestedGap + naturalWidth + outline * 2;
  const ink = config.contours?.inkBox ?? natural;
  const overTop = Math.max(0, natural.y - ink.y) / natural.height * requestedTextHeight;
  const overBottom = Math.max(0, ink.y + ink.height - natural.y - natural.height) / natural.height * requestedTextHeight;
  const panelRequired = config.mountMode === 'acp';
  const fit = panelRequired ? Math.min(1, (config.acpLayout.faceWidth - 12) / requestedWidth,
    (config.acpLayout.faceHeight - 12) / (Math.max(requestedTextHeight + outline * 2, requestedLogo) + overTop + overBottom)) : 1;
  const height = requestedHeight * fit, logoSize = requestedLogo * fit, gap = requestedGap * fit;
  const textHeight = requestedTextHeight * fit, signWidth = requestedWidth * fit;
  const textWidth = Math.max(1, signWidth - logoSize - gap - outline * 2 * fit);
  const signHeight = Math.max(height * factor, logoSize);
  const fontSize = textHeight * 1000 / natural.height;
  const extraX = panelRequired ? 0 : Math.max(Math.abs(config.logoOffsetX ?? 0), Math.abs(config.textOffsetX ?? 0));
  const extraY = panelRequired ? 0 : Math.max(Math.abs(config.logoOffsetY ?? 0), Math.abs(config.textOffsetY ?? 0));
  const baseWidth = panelRequired ? config.acpLayout.faceWidth : signWidth + extraX * 2;
  const baseHeight = panelRequired ? config.acpLayout.faceHeight : signHeight + extraY * 2;
  const margin = Math.max(100, (overTop + overBottom) * fit + 70, Math.min(550, Math.max(baseHeight * .24, baseWidth * .045)));
  const viewWidth = baseWidth + margin * 2, viewHeight = baseHeight + margin * 2;
  const base = { x: (viewWidth-signWidth)/2, y: (viewHeight-signHeight)/2, width: signWidth, height: signHeight };
  const panelBox = { x: (viewWidth-config.acpLayout.faceWidth)/2, y: (viewHeight-config.acpLayout.faceHeight)/2, width:config.acpLayout.faceWidth, height:config.acpLayout.faceHeight };
  const defaultLogoX=base.x,defaultLogoY=base.y+(signHeight-logoSize)/2;
  const defaultTextX=base.x+logoSize+gap+outline*fit,defaultTextY=base.y+(signHeight-height*factor)/2+outline*fit;
  let logoBox = { x:defaultLogoX+(config.logoOffsetX??0), y:defaultLogoY+(config.logoOffsetY??0), width:logoSize, height:logoSize };
  let textX = defaultTextX+(config.textOffsetX??0);
  let textTop = defaultTextY+(config.textOffsetY??0);
  if(panelRequired) {
    const container={x:panelBox.x+6,y:panelBox.y+6,width:panelBox.width-12,height:panelBox.height-12};
    logoBox=containBox(logoBox,container);
    const inkBox=containBox({x:textX,y:textTop-overTop*fit,width:textWidth,height:textHeight+(overTop+overBottom)*fit},container);
    textX=inkBox.x; textTop=inkBox.y+overTop*fit;
  }
  const x1=Math.min(textX,logoEnabled?logoBox.x:textX),y1=Math.min(textTop,logoEnabled?logoBox.y:textTop);
  const x2=Math.max(textX+textWidth,logoEnabled?logoBox.x+logoBox.width:textX+textWidth);
  const y2=Math.max(textTop+textHeight,logoEnabled?logoBox.y+logoBox.height:textTop+textHeight);
  const signBox={x:x1,y:y1,width:x2-x1,height:y2-y1};
  const textBaseline=textTop-natural.y*textHeight/natural.height;
  const railHeight=15, centers=frameRailCenters(signBox.y,signBox.height,config.frameTopPosition,config.frameBottomPosition);
  const railTopY=centers.top,railBottomY=centers.bottom;
  const inset=clamp(config.frameEdgeInset,0,signBox.width*.38),railX=signBox.x+inset;
  const railWidth=Math.max(30,signBox.width-inset*2);
  const haloBackerBox={x:signBox.x-height*.16,y:signBox.y-height*.11,width:signBox.width+height*.32,height:signBox.height+height*.22};
  return {defaultTextX,defaultTextY,defaultLogoX,defaultLogoY,viewWidth,viewHeight,signBox,logoBox,logoCornerRadius:logoSize*.16,textX,textTop,textBaseline,textWidth,textHeight,fontSize,
    textPathData:config.contours?.pathData,textNaturalBox:natural,railX,railWidth,railHeight,railTopY,railBottomY,panelBox,panelCornerRadius:0,
    haloBackerBox,haloBackerRadius:Math.min(height*.28,haloBackerBox.height/2),seamXs:[],seamYs:[]};
}

function createLettersSvgMarkup(
  config: Partial<LettersSvgMarkupConfig> & Pick<LettersSvgMarkupConfig,
    "layout" | "height" | "depth" | "faceColor" | "sideColor" | "font" |
    "text" | "glowMode" | "mountMode" | "acpColor" | "haloBackerEnabled" |
    "haloBackerColor" | "letterOutlineEnabled" | "logoOutlineEnabled" |
    "outlineColor" | "logoShape" | "logoImage"
  > & { sceneMode?: SceneMode; acpDepth?: number },
) {
  const layout = config.layout;
  const night = config.sceneMode === "night";
  const faceLit = config.lightsOn !== false && config.glowMode !== "halo";
  const sideLit = config.lightsOn !== false && config.glowMode === "faceSide";
  const haloLit = config.lightsOn !== false && hasHaloGlow(config.glowMode);
  const n = roundSvg;
  const label = escapeXml(config.text.trim());
  const textStrokeWidth = config.letterOutlineEnabled ? Math.max(5, config.height * 0.035) : 0;
  const logoStrokeWidth = config.logoOutlineEnabled ? Math.max(6, config.height * 0.035) : 0;
  const extrusionX = 0;
  const extrusionY = 0;
  const mix = (color: string, target: string, amount: number) => {
    const parse = (value: string) => /^#[\da-f]{6}$/i.test(value)
      ? [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16))
      : [40, 48, 58];
    const source = parse(color);
    const destination = parse(target);
    return "#" + source.map((channel, index) =>
      Math.round(channel + (destination[index] - channel) * amount).toString(16).padStart(2, "0"),
    ).join("");
  };
  const face = night && !faceLit ? mix(config.faceColor, "#18212d", 0.6) : faceLit&&!night?mix(config.faceColor,'#ffffff',.06):config.faceColor;
  const side = sideLit ? mix(config.sideColor, "#ffffff", night?.32:.06)
    : night ? mix(config.sideColor, "#08101c", 0.6) : config.sideColor;
  const logoGeometry = (fill: string, stroke = "none", strokeWidth = 0) => !config.logoEnabled ? "" : config.logoShape === "circle"
    ? '<circle cx="' + n(layout.logoBox.x + layout.logoBox.width / 2) + '" cy="' + n(layout.logoBox.y + layout.logoBox.height / 2) + '" r="' + n(layout.logoBox.width / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />'
    : '<rect x="' + n(layout.logoBox.x) + '" y="' + n(layout.logoBox.y) + '" width="' + n(layout.logoBox.width) + '" height="' + n(layout.logoBox.height) + '" rx="' + (config.logoShape === "rounded" ? n(layout.logoCornerRadius) : 0) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />';
  const textGeometry = (fill: string, stroke = "none", strokeWidth = 0, _measure = false) => {
    const sx = layout.textWidth / layout.textNaturalBox.width;
    const sy = layout.textHeight / layout.textNaturalBox.height;
    const transform = 'translate(' + n(layout.textX - layout.textNaturalBox.x * sx) + ' ' + n(layout.textBaseline) + ') scale(' + sx + ' ' + sy + ')';
    return '<g transform="' + transform + '"><path d="' + (layout.textPathData ?? "") + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth / sy) + '" stroke-linejoin="round" paint-order="stroke fill" /></g>';
  };
  const silhouette = (fill: string) => logoGeometry(fill) + textGeometry(fill);
  const steps = 1;
  const sideMarkup = Array.from({ length: steps }, (_, index) => {
    const ratio = (steps - index) / steps;
    const layerColor = sideLit ? side : mix(side, "#02060c", ratio * 0.3);
    return '<g transform="translate(' + n(extrusionX * ratio) + " " +
      n(extrusionY * ratio) + ')" fill="' + layerColor + '">' + silhouette(layerColor) + "</g>";
  }).join("\n");
  const imageMarkup = !config.logoEnabled ? "" : config.logoImage
    ? '<image href="' + escapeXml(config.logoImage) + '" x="' + n(layout.logoBox.x) +
      '" y="' + n(layout.logoBox.y) + '" width="' + n(layout.logoBox.width) +
      '" height="' + n(layout.logoBox.height) +
      '" preserveAspectRatio="xMidYMid meet" clip-path="url(#letters-logo-clip)"' +
      (night && !faceLit ? ' opacity="0.25"' : "") + " />"
    : '<text x="' + n(layout.logoBox.x + layout.logoBox.width / 2) +
      '" y="' + n(layout.logoBox.y + layout.logoBox.height / 2) +
      '" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-size="' +
      n(Math.max(28, config.height * 0.13)) + '" font-weight="800" fill="' +
      (night ? "#c0cad5" : "#314153") + '" opacity="0.7">лого</text>';
  const panelDepth = config.acpDepth ?? config.acpLayout?.depth ?? config.depth;
  const panelMarkup = config.mountMode === "acp"
    ? '<g id="acp-backer" filter="url(#letters-cast-shadow)">' +
      '<rect x="' + n(layout.panelBox.x) + '" y="' +
      n(layout.panelBox.y) + '" width="' + n(layout.panelBox.width) +
      '" height="' + n(layout.panelBox.height) + '" rx="' + n(layout.panelCornerRadius) +
      '" fill="' + mix(config.acpColor, "#09121e", night ? 0.7 : 0.4) + '" />' +
      '<rect x="' + n(layout.panelBox.x) + '" y="' + n(layout.panelBox.y) +
      '" width="' + n(layout.panelBox.width) + '" height="' + n(layout.panelBox.height) +
      '" rx="' + n(layout.panelCornerRadius) + '" fill="url(#letters-acp-material)" stroke="' +
      (night ? "#3e4d60" : "#c2c9d0") + '" stroke-width="' +
      n(Math.max(1.5, config.height * 0.004)) + '" />' +
      layout.seamXs.filter((x) => x < layout.panelBox.x + layout.panelBox.width).map((x) =>
        '<line x1="' + n(x) + '" x2="' + n(x) + '" y1="' + n(layout.panelBox.y) +
        '" y2="' + n(layout.panelBox.y + layout.panelBox.height) +
        '" stroke="#8793a1" stroke-width="2" stroke-dasharray="12 9" opacity="0.5" />').join("") +
      layout.seamYs.filter((y) => y < layout.panelBox.y + layout.panelBox.height).map((y) =>
        '<line x1="' + n(layout.panelBox.x) + '" x2="' + n(layout.panelBox.x + layout.panelBox.width) +
        '" y1="' + n(y) + '" y2="' + n(y) +
        '" stroke="#8793a1" stroke-width="2" stroke-dasharray="12 9" opacity="0.5" />').join("") + "</g>"
    : "";
  const backerMarkup = config.haloBackerEnabled
    ? '<rect id="halo-backer" x="' + n(layout.haloBackerBox.x) + '" y="' +
      n(layout.haloBackerBox.y) + '" width="' + n(layout.haloBackerBox.width) +
      '" height="' + n(layout.haloBackerBox.height) + '" rx="' + n(layout.haloBackerRadius) +
      '" fill="' + (night ? mix(config.haloBackerColor, "#08101c", 0.73) : config.haloBackerColor) +
      '" stroke="' + (night ? "#354253" : "#cbd2db") + '" stroke-width="2" />'
    : "";
  const frameMarkup = config.mountMode === "frame"
    ? '<g id="frame-rails" filter="url(#letters-cast-shadow)">' +
      [layout.railTopY, layout.railBottomY].map((railY, index) =>
        '<g id="frame-rail-' + (index + 1) + '"><rect x="' + n(layout.railX) +
        '" y="' + n(railY - layout.railHeight / 2) + '" width="' + n(layout.railWidth) +
        '" height="' + n(layout.railHeight) + '" rx="0" fill="url(#letters-steel)" />' +
        '<line x1="' + n(layout.railX + layout.railHeight * 0.25) + '" x2="' +
        n(layout.railX + layout.railWidth - layout.railHeight * 0.25) + '" y1="' +
        n(railY - layout.railHeight / 2 + .75) + '" y2="' + n(railY - layout.railHeight / 2 + .75) +
        '" stroke="' + (night ? "#8896a7" : "#e1e5e9") + '" opacity="0.55" stroke-width="1.5" /></g>',
      ).join("") + "</g>"
    : "";
  const haloMarkup = haloLit
    ? '<g id="sign-halo" transform="translate(' + n(extrusionX * 0.8) + " " +
      n(extrusionY * 0.8) + ')" filter="url(#letters-halo)" opacity="' + (night?'0.78':'0.08') + '">' +
      silhouette(escapeXml(config.faceColor)) + "</g>"
    : "";

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Визуализация вывески" width="' +
    n(layout.viewWidth) + 'mm" height="' + n(layout.viewHeight) +
    'mm" viewBox="0 0 ' + n(layout.viewWidth) + " " + n(layout.viewHeight) + '">\n' +
    "<title>Вывеска " + label + " — " + (night ? "ночной" : "дневной") + " вид</title>\n" +
    "<defs>" +
    '<clipPath id="letters-logo-clip">' + logoGeometry("#ffffff") + "</clipPath>" +
    '<linearGradient id="letters-face-material" x1="0" y1="0" x2="0.16" y2="1">' +
    '<stop offset="0" stop-color="' + (night ? mix(face, "#ffffff", faceLit ? 0.2 : 0.07) : face) +
    '" /><stop offset="0.52" stop-color="' + face + '" /><stop offset="1" stop-color="' +
    (night ? mix(face, "#02060c", faceLit ? 0.03 : 0.12) : face) + '" /></linearGradient>' +
    '<linearGradient id="letters-acp-material" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + (night ? mix(config.acpColor, "#091524", 0.62) : mix(config.acpColor, "#ffffff", 0.12)) +
    '" /><stop offset="1" stop-color="' + mix(config.acpColor, "#091524", night ? 0.79 : 0.12) + '" /></linearGradient>' +
    '<linearGradient id="letters-steel" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + (night ? "#516173" : "#a1aab2") + '" />' +
    '<stop offset="0.02" stop-color="' + (night ? "#263440" : "#6c7782") + '" />' +
    '<stop offset="1" stop-color="' + (night ? "#263440" : "#6c7782") + '" /></linearGradient>' +
    '<filter id="letters-cast-shadow" x="-25%" y="-40%" width="160%" height="200%">' +
    '<feDropShadow dx="' + n(extrusionX * 0.42) + '" dy="' + n(extrusionY * 0.7) +
    '" stdDeviation="' + n(Math.max(3, config.depth * 0.12)) +
    '" flood-color="#020711" flood-opacity="' + (night ? "0.5" : "0.23") + '" /></filter>' +
    '<filter id="letters-face-light" x="-40%" y="-60%" width="180%" height="220%">' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.014) +
    '" flood-color="' + escapeXml(config.faceColor) + '" flood-opacity="' + (night?'0.85':'0.1') + '" />' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.045) +
    '" flood-color="' + escapeXml(config.faceColor) + '" flood-opacity="' + (night?'0.38':'0.035') + '" /></filter>' +
    '<filter id="letters-side-light" x="-40%" y="-60%" width="180%" height="220%">' +
    '<feDropShadow dx="' + n(extrusionX * 0.15) + '" dy="' + n(extrusionY * 0.15) +
    '" stdDeviation="' + n(config.height * 0.035) + '" flood-color="' +
    mix(config.sideColor, "#ffffff", 0.4) + '" flood-opacity="0.72" /></filter>' +
    '<filter id="letters-halo" x="-45%" y="-80%" width="200%" height="260%">' +
    '<feGaussianBlur stdDeviation="' + n(Math.max(10, config.height * 0.055)) + '" /></filter>' +
    "</defs>\n" + panelMarkup + "\n" + backerMarkup + "\n" + frameMarkup + "\n" + haloMarkup + "\n" +
    '<g id="sign-side"' + (sideLit ? ' filter="url(#letters-side-light)"' : ' filter="url(#letters-cast-shadow)"') +
    ">" + sideMarkup + "</g>\n" +
    '<g id="sign-face"' + (faceLit ? ' filter="url(#letters-face-light)"' : "") + ">" +
    logoGeometry("url(#letters-face-material)", config.logoOutlineEnabled ? escapeXml(config.outlineColor) : "none", logoStrokeWidth) +
    imageMarkup +
    textGeometry("url(#letters-face-material)", config.letterOutlineEnabled ? escapeXml(config.outlineColor) : "none", textStrokeWidth, true) +
    "</g>\n" + (config.showDimensions ? createSvgDimensions(config.mountMode === "acp" ? layout.panelBox : layout.signBox, Math.max(120, Math.min(550, layout.viewHeight * 0.12)), night ? "#dce5e0" : "#1b322b") : "") + "</svg>";
}

function createSvgDimensions(box: SvgBox, margin: number, color: string) {
  const n = roundSvg;
  const offset = margin * 0.55;
  const font = Math.max(16, margin * 0.22);
  const right = box.x + box.width, bottom = box.y + box.height;
  const h = bottom + offset, v = right + offset, tick = font * 0.28;
  return '<g data-dimensions="true" fill="' + color + '" stroke="' + color + '" stroke-width="1.7" font-family="Manrope,Arial,sans-serif" font-size="' + n(font) + '">' +
    '<path fill="none" d="M' + n(box.x) + ' ' + n(bottom + tick) + 'V' + n(h + tick) + 'M' + n(right) + ' ' + n(bottom + tick) + 'V' + n(h + tick) + 'M' + n(box.x) + ' ' + n(h) + 'H' + n(right) + 'M' + n(right + tick) + ' ' + n(box.y) + 'H' + n(v + tick) + 'M' + n(right + tick) + ' ' + n(bottom) + 'H' + n(v + tick) + 'M' + n(v) + ' ' + n(box.y) + 'V' + n(bottom) + '" />' +
    '<text stroke="none" text-anchor="middle" x="' + n(box.x + box.width / 2) + '" y="' + n(h + font * 1.25) + '">' + Math.round(box.width) + ' мм</text>' +
    '<text stroke="none" text-anchor="middle" transform="translate(' + n(v + font * 1.2) + ' ' + n(box.y + box.height / 2) + ') rotate(-90)">' + Math.round(box.height) + ' мм</text></g>';
}

function createAcpLayout(faceWidth: number, faceHeight: number, depth: number): AcpLayout {
  const unfoldedWidth = faceWidth + (depth + ACP_SECOND_RETURN_MM) * 2;
  const unfoldedHeight = faceHeight + (depth + ACP_SECOND_RETURN_MM) * 2;

  return {
    faceWidth,
    faceHeight,
    depth,
    secondReturn: ACP_SECOND_RETURN_MM,
    unfoldedWidth,
    unfoldedHeight,
    sheetsX: Math.max(1, Math.ceil(unfoldedWidth / ACP_SHEET_WIDTH_MM)),
    sheetsY: Math.max(1, Math.ceil(unfoldedHeight / ACP_SHEET_HEIGHT_MM)),
    sheetCount: Math.max(1, Math.ceil(unfoldedWidth / ACP_SHEET_WIDTH_MM)) *
      Math.max(1, Math.ceil(unfoldedHeight / ACP_SHEET_HEIGHT_MM)),
  };
}

function hasHaloGlow(mode: GlowMode) {
  return mode === "faceHalo" || mode === "halo";
}

function readPositiveInteger(value: string, fallback: number, min: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.round(parsed));
}

function rectStyle(left: number, top: number, width: number, height: number): CSSProperties {
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function unionSvgBoxes(first: SvgBox, second: SvgBox): SvgBox {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);

  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };
}

function getLogoRailLeft(logoBox: SvgBox, railY: number) {
  const radius = logoBox.width / 2;
  const centerY = logoBox.y + radius;
  const centerX = logoBox.x + radius;
  const verticalDelta = railY - centerY;

  if (Math.abs(verticalDelta) >= radius) {
    return logoBox.x + radius;
  }

  return centerX - Math.sqrt(radius ** 2 - verticalDelta ** 2);
}

function normalizeSvgBox(box: DOMRect): SvgBox {
  return {
    height: box.height,
    width: box.width,
    x: box.x,
    y: box.y,
  };
}

function areSvgBoxesClose(first: SvgBox, second: SvgBox | null) {
  if (!second) return false;
  const tolerance = 0.5;

  return Math.abs(first.x - second.x) < tolerance &&
    Math.abs(first.y - second.y) < tolerance &&
    Math.abs(first.width - second.width) < tolerance &&
    Math.abs(first.height - second.height) < tolerance;
}

function roundSvg(value: number) {
  return Number(value.toFixed(2));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Не удалось загрузить изображение.")));
    reader.readAsDataURL(file);
  });
}

function formatArea(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

function formatMoney(value: number) { return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value); }

function pluralizeSheet(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return "лист";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return "листа";
  return "листов";
}
