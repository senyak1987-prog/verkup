import { ArrowUpRight, Check, ChevronRight, Download, Eraser, FolderOpen, ImagePlus, Lightbulb, Maximize, Minus, Moon, Plus, Power, RotateCcw, Save, Settings2, ShoppingCart, Sun, Type, Upload, X } from "lucide-react";
import { Component, createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { createPanelSvgMarkup, panelSvgFaceBox } from "../lib/signPanelExport";
import { panelMountLayout, isPanelCornerMount, PANEL_SIZES, PANEL_DEPTHS, normalizePanelSize, normalizePanelDepth } from "../lib/panelConstruction";
import type { PanelMountMode } from "../lib/panelConstruction";
import { calculateLetterPrice, calculateLogoPrice, hasUnpricedSymbols, requiresFrameApproval, useSignCart } from "../lib/signCommerce";
import { systemFontAvailable } from "../lib/systemFontContours";
import { SIGN_FONTS, loadLetterContours, resolveSignFont, combineLetterLines } from "../lib/letterContours";
import type { LetterContours } from "../lib/letterContours";
import { haloBackerContour } from "../lib/haloBackerContour";
import { createLetterRowsLayout } from "../lib/letterRowsLayout";
import type { LetterRowLayout, LetterRowSetting } from "../lib/letterRowsLayout";
import type { LetterFrameSegment } from "../lib/letterFrame";
import { allowedLetterDepths, normalizeLetterDepth, frameRailCenters } from "../lib/letterConstruction";
import { constrainBacker, containBox, backerLimits, backerSeams } from "../lib/backerConstraints";
import { createNeonDesign, neonSvg, neonRequiredBacker, neonUnsupportedCharacters } from "../lib/neonConstruction";
import { fitNeonToWidth } from "../lib/neonSizing";
import { NeonControls } from "./NeonControls";
import { NeonStudioEditor } from "./NeonStudioEditor";
import { SignLayoutEditor } from "./SignLayoutEditor";
import { LetterLinesControls } from "./LetterLinesControls";
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Undo2 } from "lucide-react";
import { centerLayoutSelection, packLayoutComposition } from "../lib/signLayoutAlignment";
import type { AlignmentAxis, LayoutObject } from "../lib/signLayoutAlignment";
import { SignPlacements } from "./SignPlacements";
import { SignPhotoPreview } from "./SignPhotoPreview";
import { createFacadeSvg, SIGN_PLACEMENTS } from "../lib/signFacade";
import type { FacadeSignBox, SignPlacement } from "../lib/signFacade";
import { loadNeonFont } from "../lib/neonFonts";
import { NEON_FONTS } from "../lib/neonConstruction";
import { SCENE_LIGHTING_TIMING } from "../lib/sceneLighting";
import { signZoomTranslation } from "../lib/signZoomFocus";
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
  textRows?: LetterRowLayout[];
  frameSegments?: LetterFrameSegment[];
  letterLineOffsets?: {x:number;y:number}[];
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
  textInkBox: SvgBox;
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
  haloBackerPath?:string;
  haloBackerBox: SvgBox;
  haloBackerRadius: number;
  seamXs: number[];
  seamYs: number[];
};

type LettersSvgLayoutConfig = {
  lineSettings?: LetterRowSetting[];
  acpLayout: AcpLayout;
  estimatedWidth: number;
  frameBottomPosition: number;
  frameEdgeInset: number;
  frameProfile: FrameProfile;
  frameTopPosition: number;
  height: number;
  letterOutlineEnabled: boolean;
  logoScale: number;
  logoSizeMm?:number;
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
  logoFaceColor?: string;
  logoSideColor?: string;
  haloLightColor?: string;
  faceNoFilm?: boolean;
  logoNoFilm?: boolean;
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

// Codes, names and screen swatches sampled from the two supplied palette charts.
const ORACAL_8500_COLORS: ColorOption[] = [
  { code: "010", name: "Белый", value: "#e8e8e8" },
  { code: "025", name: "Серно-жёлтый", value: "#d1c901" },
  { code: "021", name: "Жёлтый", value: "#fed000" },
  { code: "013", name: "Цинково-жёлтый", value: "#f4c501" },
  { code: "020", name: "Золотисто-жёлтый", value: "#f9af00" },
  { code: "207", name: "Жёлтая охра", value: "#e0a314" },
  { code: "034", name: "Оранжевый", value: "#e45c01" },
  { code: "330", name: "Красная лиса", value: "#d1280d" },
  { code: "323", name: "Красный коралл", value: "#d30c2d" },
  { code: "032", name: "Светло-красный", value: "#d42d0a" },
  { code: "329", name: "Красно-алый", value: "#cc070c" },
  { code: "016", name: "Алый", value: "#db210c" },
  { code: "031", name: "Красный", value: "#c81e0d" },
  { code: "017", name: "Вишнёвый", value: "#ae0b07" },
  { code: "030", name: "Тёмно-красный", value: "#770c0e" },
  { code: "085", name: "Розовый", value: "#dd8d8f" },
  { code: "413", name: "Светло-малиновый", value: "#c45ba3" },
  { code: "041", name: "Малиновый", value: "#b30163" },
  { code: "008", name: "Вересковый", value: "#75032e" },
  { code: "040", name: "Фиолетовый", value: "#67135d" },
  { code: "403", name: "Светло-фиолетовый", value: "#5a2282" },
  { code: "012", name: "Лиловый", value: "#4b175d" },
  { code: "527", name: "Пастельно-голубой", value: "#528fae" },
  { code: "053", name: "Светло-голубой", value: "#0987c8" },
  { code: "052", name: "Лазурный", value: "#025ca8" },
  { code: "051", name: "Цвета генцианы", value: "#05549f" },
  { code: "528", name: "Серо-синий", value: "#025e9c" },
  { code: "005", name: "Средне-синий", value: "#29318e" },
  { code: "006", name: "Интенсивно-голубой", value: "#1e2b74" },
  { code: "049", name: "Королевский синий", value: "#3c2480" },
  { code: "542", name: "Карибский синий", value: "#2d237a" },
  { code: "065", name: "Кобальтовый", value: "#3a2177" },
  { code: "007", name: "Тёмно-синий", value: "#23185b" },
  { code: "541", name: "Тёмно-бирюзовый", value: "#024c6f" },
  { code: "066", name: "Бирюзово-синий", value: "#038a95" },
  { code: "054", name: "Бирюзовый", value: "#0aac8e" },
  { code: "062", name: "Светло-зелёный", value: "#039d35" },
  { code: "063", name: "Липово-зелёный", value: "#5fb230" },
  { code: "009", name: "Средне-зелёный", value: "#019c68" },
  { code: "614", name: "Зелёный камыш", value: "#05722b" },
  { code: "068", name: "Травянисто-зелёный", value: "#036a31" },
  { code: "618", name: "Зелёный дракон", value: "#03373a" },
  { code: "087", name: "Изумрудный", value: "#047729" },
  { code: "060", name: "Тёмно-зелёный", value: "#02331e" },
  { code: "070", name: "Чёрный", value: "#000004" },
  { code: "074", name: "Средне-серый", value: "#868c8f" },
  { code: "076", name: "Серый", value: "#9da3a8" },
  { code: "072", name: "Светло-серый", value: "#c7cccb" },
  { code: "805", name: "Слоновая кость", value: "#e5d6b4" },
  { code: "011", name: "Бледно-коричневый", value: "#e4bf89" },
  { code: "081", name: "Светло-коричневый", value: "#b78856" },
  { code: "088", name: "Шоколадный", value: "#3c1701" },
  { code: "090", name: "Серебристый", value: "#c3c5c9" },
  { code: "091", name: "Золотистый", value: "#bf9f4e" },
];

const ORACAL_641_COLORS: ColorOption[] = [
  { code: "000", name: "Прозрачный", value: "#fdfdfd" },
  { code: "010", name: "Белый", value: "#e6eaed" },
  { code: "020", name: "Золотисто-жёлтый", value: "#faa802" },
  { code: "019", name: "Ярко-жёлтый", value: "#e9a700" },
  { code: "021", name: "Жёлтый", value: "#ffc702" },
  { code: "022", name: "Светло-жёлтый", value: "#f4cc02" },
  { code: "025", name: "Серно-жёлтый", value: "#f1e10e" },
  { code: "312", name: "Бургунди", value: "#750310" },
  { code: "030", name: "Тёмно-красный", value: "#930817" },
  { code: "031", name: "Красный", value: "#af0009" },
  { code: "032", name: "Светло-красный", value: "#c80d01" },
  { code: "047", name: "Оранжево-красный", value: "#d13002" },
  { code: "034", name: "Оранжевый", value: "#db4500" },
  { code: "036", name: "Светло-оранжевый", value: "#ef6602" },
  { code: "035", name: "Пастельно-оранжевый", value: "#fe6e02" },
  { code: "404", name: "Пурпурный", value: "#3e2974" },
  { code: "040", name: "Фиолетовый", value: "#5f2d67" },
  { code: "043", name: "Лавандовый", value: "#7a5fa1" },
  { code: "042", name: "Сиреневый", value: "#b993b9" },
  { code: "041", name: "Малиновый", value: "#c2276b" },
  { code: "045", name: "Светло-розовый", value: "#ef89bc" },
  { code: "562", name: "Глубоководный синий", value: "#111c38" },
  { code: "518", name: "Синий со стальным отливом", value: "#0f113b" },
  { code: "050", name: "Тёмно-синий", value: "#1e305e" },
  { code: "065", name: "Кобальтовый синий", value: "#0a1d6b" },
  { code: "049", name: "Королевский синий", value: "#182b79" },
  { code: "086", name: "Ярко-синий", value: "#1b30ad" },
  { code: "067", name: "Синий", value: "#003a7a" },
  { code: "057", name: "Дорожный синий", value: "#00408e" },
  { code: "051", name: "Генциановый синий", value: "#024583" },
  { code: "098", name: "Генциановый синий", value: "#004f9d" },
  { code: "052", name: "Лазурный", value: "#025ead" },
  { code: "084", name: "Небесно-голубой", value: "#0172b9" },
  { code: "053", name: "Голубой", value: "#0189c6" },
  { code: "056", name: "Светло-голубой", value: "#439fd4" },
  { code: "066", name: "Бирюзово-синий", value: "#018292" },
  { code: "054", name: "Бирюзовый", value: "#019b97" },
  { code: "055", name: "Цвет мяты", value: "#5fcfb9" },
  { code: "060", name: "Тёмно-зелёный", value: "#003c20" },
  { code: "613", name: "Лесной зелёный", value: "#005136" },
  { code: "061", name: "Зелёный", value: "#007b4c" },
  { code: "068", name: "Травянисто-зелёный", value: "#017840" },
  { code: "062", name: "Светло-зелёный", value: "#008a3b" },
  { code: "064", name: "Жёлто-зелёный", value: "#219d0f" },
  { code: "063", name: "Липово-зелёный", value: "#6ca82f" },
  { code: "800", name: "Коричневая нуга", value: "#54331e" },
  { code: "083", name: "Ореховый", value: "#ae5b1c" },
  { code: "081", name: "Светло-коричневый", value: "#aa885a" },
  { code: "082", name: "Бежевый", value: "#ccc2a1" },
  { code: "023", name: "Кремовый", value: "#e7d096" },
  { code: "070", name: "Чёрный", value: "#060606" },
  { code: "073", name: "Тёмно-серый", value: "#4c4c4c" },
  { code: "071", name: "Серый", value: "#757f7b" },
  { code: "076", name: "Серый телеком", value: "#80868b" },
  { code: "074", name: "Средне-серый", value: "#8a8f8d" },
  { code: "072", name: "Светло-серый", value: "#bdc4c1" },
  { code: "090", name: "Серебристо-серый", value: "#9d9e99" },
  { code: "091", name: "Золотистый", value: "#a58a33" },
  { code: "092", name: "Медный", value: "#845611" },
];

type WhiteLightTone = "cool" | "neutral" | "warm";
const WHITE_LIGHT_TONES = [
  { id: "cool" as const, label: "Холодное", kelvin: "6000 К", value: "#e6f3ff" },
  { id: "neutral" as const, label: "Нейтральное", kelvin: "4000 К", value: "#fff4e6" },
  { id: "warm" as const, label: "Тёплое", kelvin: "3000 К", value: "#ffdcb1" },
];
const LIGHT_FACE_FILMS = ORACAL_8500_COLORS.filter(color => !["010", "070"].includes(color.code));
function bareFaceColor(tone: WhiteLightTone): ColorOption {
  return { code: "none", name: "Без плёнки", value: WHITE_LIGHT_TONES.find(item => item.id === tone)!.value };
}
function closestFilm(color:ColorOption, palette:ColorOption[]):ColorOption {
  const distance=(candidate:ColorOption)=>[1,3,5].reduce((sum,offset)=>sum+(parseInt(candidate.value.slice(offset,offset+2),16)-parseInt(color.value.slice(offset,offset+2),16))**2,0);
  return palette.reduce((best,item)=>distance(item)<distance(best)?item:best);
}
function normalizeFaceFilms(project:ProjectState):ProjectState {
  const palette=project.glowMode === "halo" ? ORACAL_641_COLORS : LIGHT_FACE_FILMS;
  for(const [faceKey,toneKey] of [["letterFaceColor","letterWhiteTone"],["logoFaceColor","logoWhiteTone"]] as const) {
    const color=project[faceKey];
    if(project.glowMode !== "halo" && ["none","000","010","070"].includes(color.code)) project[faceKey]=bareFaceColor(project[toneKey]);
    else project[faceKey]=palette.find(item=>item.code===(color.code==="none"?"010":color.code)) ?? closestFilm(color,palette);
  }
  return project;
}

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
  panelDepth: 130,
  panelWallGap: 120,
  panelMountMode: "wall" as PanelMountMode,
  panelCornerRadius: 60,
  panelImage: "",
  panelImageScale: 82,
  panelImageX: 0,
  panelImageY: 0,
  panelFaceColor: ORACAL_8500_COLORS.find(color=>color.code==="025")! as ColorOption,
  panelSideColor: ORACAL_641_COLORS.find(color=>color.code==="070")! as ColorOption,
  lettersText: "ЦВЕТЫ",
  secondLineText: "",
  thirdLineText: "",
  letterLineFonts: [] as string[], letterLineHeights: [] as number[], letterLineOffsets: [] as {x:number;y:number}[],
  logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0,
  neonText: "ГОРОД СВЕТ", neonFont: "rounded", neonHeight: 200, neonDiameter: 6, neonColor: "#ffa658", neonBackerWidth: 1900, neonBackerHeight: 350, neonBackerShape: "rectangle", neonBrightness: 85, neonAlign: "center",
  neonLineFonts: [] as string[], neonLineColors: [] as string[], neonLineScales: [] as number[], neonLineOffsets: [] as {x:number;y:number}[],
  neonIcon: "none", neonBackerColor: "clear" as "clear" | "white" | "black", neonInstallMode: "standoffs" as "standoffs" | "hanging", neonUse: "indoor" as "indoor" | "outdoor", neonTargetWidth: 0, neonKeepAspect: true, neonLetterSpacing: 0, neonLineSpacing: 0, neonReferenceImage: "",
  backdropImage: "", backdropWidth: 4000,
  letterFont: LETTER_FONTS[0].value as string,
  letterHeight: 410,
  letterWidth: 0,
  letterDepth: 50,
  letterFaceColor: ORACAL_8500_COLORS.find(color=>color.code==="032")! as ColorOption,
  letterSideColor: ORACAL_641_COLORS.find(color=>color.code==="070")! as ColorOption,
  logoFaceColor: bareFaceColor("neutral") as ColorOption,
  logoSideColor: ORACAL_641_COLORS.find(color=>color.code==="070")! as ColorOption,
  haloLightColor: ORACAL_8500_COLORS[0] as ColorOption,
  letterWhiteTone: "neutral" as WhiteLightTone,
  logoWhiteTone: "neutral" as WhiteLightTone,
  glowMode: "faceHalo" as GlowMode,
  logoShape: "circle" as LogoShape,
  logoImage: "",
  logoEnabled: false,
  logoScale: 86,
  logoSizeMm: 100,
  letterOutlineEnabled: false,
  logoOutlineEnabled: false,
  outlineColor: ORACAL_641_COLORS.find(color=>color.code==="070")! as ColorOption,
  haloBackerEnabled: false,
  haloBackerOffsetMm: 20,
  haloBackerColor: ORACAL_641_COLORS.find(color=>color.code==="010")! as ColorOption,
  mountMode: "frame" as MountMode,
  frameProfile: 15 as FrameProfile,
  frameEdgeInset: 0,
  frameTopPosition: 15,
  frameBottomPosition: 15,
  acpColor: ORACAL_641_COLORS.find(color=>color.code==="010")! as ColorOption,
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
  "Лицо Oracal 8500": "colors", "Лицо Oracal 641": "colors", "Борт Oracal 641": "colors", "Кантик": "colors",
  "Свечение": "light", "Контражурная подложка": "light",
  "Размещение": "mount", "Рама": "mount", "Подложка АКП": "mount", "Крепление к стене": "mount",
  "Логотип": "design", "Изображение": "logo",
};
const PROJECT_ENUMS: Record<string, readonly unknown[]> = {
  letterWhiteTone: ["cool","neutral","warm"], logoWhiteTone: ["cool","neutral","warm"],
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
  letterHeight: [100, 700], letterDepth: [40, 60], logoScale: [45, 130], logoSizeMm: [100,700], haloBackerOffsetMm: [15,25],
  letterWidth: [0, 20000],
  panelSize: [350, 700], panelDepth: [130, 150],
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
      if (!Array.isArray(value) || value.length > 3) throw new Error("Некорректные настройки строк.");
      output[key] = value.map(item => {
        if (key === "letterLineFonts" && typeof item === "string" && (!item || resolveSignFont(item).value === item)) return item;
        if (key === "letterLineHeights" && typeof item === "number" && Number.isFinite(item)) return item === 0 ? 0 : Math.max(100,Math.min(700,item));
        if (key === "letterLineOffsets" && item && typeof item === "object" && typeof item.x === "number" && typeof item.y === "number" && Number.isFinite(item.x) && Number.isFinite(item.y)) return {x:Math.max(-20000,Math.min(20000,item.x)),y:Math.max(-10000,Math.min(10000,item.y))};
        if (key === "neonLineFonts" && typeof item === "string" && NEON_FONTS.some(font=>font.id===item)) return item;
        if (key === "neonLineColors" && typeof item === "string" && /^#[0-9a-f]{6}$/i.test(item)) return item;
        if (key === "neonLineScales" && typeof item === "number" && Number.isFinite(item)) return Math.max(.5,Math.min(2,item));
        if (key === "neonLineOffsets" && item && typeof item === "object" && typeof item.x === "number" && typeof item.y === "number" && Number.isFinite(item.x) && Number.isFinite(item.y)) return {x:Math.max(-1800,Math.min(1800,item.x)),y:Math.max(-700,Math.min(700,item.y))};
        throw new Error("Проверьте шрифт, размеры и положение строк.");
      });
    } else if (PROJECT_ENUMS[key]) {
      if (key === "letterFont" && typeof value === "string") { output[key] = resolveSignFont(value).value; continue; }
      if (!PROJECT_ENUMS[key].includes(value)) throw new Error("В проекте есть неподдерживаемые настройки.");
      output[key] = value;
    } else if (typeof initial === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Проверьте числовые параметры проекта.");
      const limits = PROJECT_RANGES[key];
      const bounded = limits ? Math.min(limits[1], Math.max(limits[0], value)) : value;
      output[key] = key === "logoOffsetX" || key === "logoOffsetY" || key === "textOffsetX" || key === "textOffsetY"
        ? Math.round(bounded * 1000) / 1000 : limits ? Math.round(bounded) : bounded;
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
      const palette = key.includes("Face") || key === "haloLightColor" ? [...ORACAL_8500_COLORS,...ORACAL_641_COLORS,...(["letterFaceColor","logoFaceColor"].includes(key)?[bareFaceColor("neutral")]:[])] : ORACAL_641_COLORS;
      const legacy = ACP_COLORS.find(color=>color.code === (value as ColorOption)?.code);
      const match = palette.find(color => color.code === (value as ColorOption)?.code && color.value === (value as ColorOption)?.value)
        ?? palette.find(color=>color.code === (value as ColorOption)?.code)
        ?? ((value as ColorOption)?.code === "080" ? ORACAL_641_COLORS.find(color=>color.code==="800") : undefined)
        ?? (legacy && (key === "acpColor" || key === "haloBackerColor") ? ORACAL_641_COLORS.reduce((best,color)=>{
          const distance=(hex:string)=>[1,3,5].reduce((sum,offset)=>sum+(parseInt(hex.slice(offset,offset+2),16)-parseInt(legacy.value.slice(offset,offset+2),16))**2,0);
          return distance(color.value)<distance(best.value)?color:best;
        }) : undefined);
      if (!match) throw new Error("Цвет в проекте отсутствует в палитре.");
      output[key] = match;
    }
  }
  result.frameProfile = 15;
  if(input.logoFaceColor===undefined)result.logoFaceColor=result.letterFaceColor;
  if(input.logoSideColor===undefined)result.logoSideColor=result.letterSideColor;
  if(input.haloLightColor===undefined)result.haloLightColor=result.letterFaceColor;
  if(result.haloBackerEnabled && ["halo","faceHalo"].includes(result.glowMode))result.mountMode="frame";
  result.panelSize=normalizePanelSize(result.panelSize);result.panelDepth=normalizePanelDepth(result.panelDepth);
  if(input.logoSizeMm===undefined)result.logoSizeMm=Math.max(100,Math.min(700,result.letterHeight*result.logoScale/100));
  if(result.panelMountMode==='corner') result.panelWallGap=Math.max(result.panelWallGap,result.panelDepth/2+20);
  result.letterDepth = normalizeLetterDepth([result.lettersText,result.secondLineText,result.thirdLineText].map((text,index)=>text.trim()?result.letterLineHeights[index]||result.letterHeight:0).filter(Boolean), result.letterDepth, result.glowMode);
  if (Number(input.frameTopPosition) > 20) result.frameTopPosition = 15;
  if (Number(input.frameBottomPosition) > 20) result.frameBottomPosition = 15;
  if (input.logoEnabled === undefined) result.logoEnabled = Boolean(result.logoImage);
  const bounded = constrainBacker(result.acpWidth,result.acpHeight,result.acpDepth); result.acpWidth=bounded.width; result.acpHeight=bounded.height;
  result.neonText=result.neonText.split("\n").slice(0,3).join("\n");
  return normalizeFaceFilms(result);
}
function loadSavedProject(): ProjectState {
  try {
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY) ?? localStorage.getItem("verkup-sign-studio-v1");
    return saved ? validateProject(JSON.parse(saved)) : { ...DEFAULT_PROJECT };
  } catch { return { ...DEFAULT_PROJECT }; }
}

function resetProjectSettings(): ProjectState {
  return { ...DEFAULT_PROJECT };
}

function clearProjectArtwork(current: ProjectState): ProjectState {
  return {
    ...current, lettersText: "", secondLineText: "", thirdLineText: "", neonText: "",
    logoEnabled: false, logoImage: "", panelImage: "", backdropImage: "", neonReferenceImage: "", neonIcon: "none",
    logoOffsetX: 0, logoOffsetY: 0, textOffsetX: 0, textOffsetY: 0, panelImageX: 0, panelImageY: 0,
    letterLineOffsets: [], neonLineOffsets: [],
  };
}

function isProjectBlank(project: ProjectState) {
  return project.productId === "letters"
    ? ![project.lettersText, project.secondLineText, project.thirdLineText].some(text => text.trim()) && !project.logoEnabled
    : project.productId === "neon" && !project.neonText.trim() && project.neonIcon === "none";
}

export function SignProductConfigurator() {
  const [project, setProject] = useState<ProjectState>(loadSavedProject);
  const undoHistory = useRef<ProjectState[]>([]);
  const lastUndoEdit = useRef(0);
  const [canUndo,setCanUndo] = useState(false);
  const [selectedNeonLine,setSelectedNeonLine] = useState(0);
  useEffect(() => { setSelectedNeonLine(index => Math.min(index, project.neonText.split('\n').length - 1)); }, [project.neonText]);
  const [editing, setEditing] = useState(true);
  const [layoutSelection, setLayoutSelection] = useState<LayoutObject>("composition");
  const layoutInteraction = useRef<"idle" | "start" | "active">("idle");
  useEffect(() => { if (!project.logoEnabled && layoutSelection === "logo") setLayoutSelection("composition"); }, [project.logoEnabled, layoutSelection]);
  const combinedText = [project.lettersText,project.secondLineText,project.thirdLineText].filter(text=>text.trim()).join("\n");
  const lineSettings = useMemo<LetterRowSetting[]>(() => [project.lettersText,project.secondLineText,project.thirdLineText]
    .map((text,index)=>({index,text,font:project.letterLineFonts[index]||project.letterFont,height:project.letterLineHeights[index]||project.letterHeight,offset:project.letterLineOffsets[index]||{x:0,y:0}}))
    .filter((row,_,rows)=>row.text.trim()||!rows.some(item=>item.text.trim())&&row.index===0),
    [project.lettersText,project.secondLineText,project.thirdLineText,project.letterFont,project.letterHeight,project.letterLineFonts,project.letterLineHeights,project.letterLineOffsets]);
  const contourKey = JSON.stringify(lineSettings.map(row=>[row.index,row.font,row.text]));
  const patchProject = (patch: Partial<ProjectState>, remember = true) => {
    const layoutEdit = project.productId === "letters" && Object.keys(patch).some(key =>
      ["logoOffsetX", "logoOffsetY", "textOffsetX", "textOffsetY", "logoScale", "logoSizeMm", "letterWidth", "letterHeight", "lettersText", "letterFont", "secondLineText", "thirdLineText", "letterLineFonts", "letterLineHeights", "letterLineOffsets"].includes(key));
    if (remember && (layoutEdit || project.productId === 'neon' && Object.keys(patch).some(key=>key.startsWith('neon')))) {
      if (layoutInteraction.current === "start" || layoutInteraction.current !== "active" && (Date.now()-lastUndoEdit.current > 800 || !undoHistory.current.length)) {
        undoHistory.current.push(project); if (undoHistory.current.length>30) undoHistory.current.shift(); setCanUndo(true);
      }
      if (layoutEdit && layoutInteraction.current !== "idle") layoutInteraction.current = "active";
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
    next.letterDepth = normalizeLetterDepth([next.lettersText,next.secondLineText,next.thirdLineText].map((text,index)=>text.trim()?next.letterLineHeights[index]||next.letterHeight:0).filter(Boolean), next.letterDepth, next.glowMode);
    return normalizeFaceFilms(next);
    });
  };
  const undoNeon = () => { const previous=undoHistory.current.pop(); if(previous) setProject(previous); lastUndoEdit.current=0; setCanUndo(undoHistory.current.length>0); };
  useEffect(() => {
    const keyboardUndo = (event: globalThis.KeyboardEvent) => {
      if (!canUndo || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); undoNeon();
    };
    document.addEventListener("keydown", keyboardUndo);
    return () => document.removeEventListener("keydown", keyboardUndo);
  }, [canUndo]);
  const beginLayoutInteraction = () => { layoutInteraction.current = "start"; };
  const endLayoutInteraction = () => { layoutInteraction.current = "idle"; lastUndoEdit.current = 0; };
  useEffect(() => { const bounded = constrainBacker(project.acpWidth, project.acpHeight, project.acpDepth);
    if (bounded.width !== project.acpWidth || bounded.height !== project.acpHeight) patchProject({ acpWidth: bounded.width, acpHeight: bounded.height });
  }, [project.acpWidth, project.acpHeight, project.acpDepth]);
  const { productId, sceneMode, panelShape, panelSize, panelImage, panelImageScale, panelImageX, panelImageY, panelFaceColor, panelSideColor, lettersText, letterFont, letterHeight, letterWidth, letterDepth, letterFaceColor, letterSideColor, glowMode, logoShape, logoImage, logoEnabled, logoScale, letterOutlineEnabled, logoOutlineEnabled, outlineColor, haloBackerEnabled, haloBackerColor, mountMode, frameProfile, frameEdgeInset, frameTopPosition, frameBottomPosition, acpColor, acpWidth, acpHeight, acpDepth } = project;
  const setProductId = (value: ProjectState["productId"]) => setProject(previous => ({ ...previous, productId: value }));
  const setSceneMode = (value: ProjectState["sceneMode"]) => setProject(previous => ({ ...previous, sceneMode: value }));
  const setPanelShape = (value: ProjectState["panelShape"]) => setProject(previous => ({ ...previous, panelShape: value }));
  const setPanelSize = (value: ProjectState["panelSize"]) => setProject(previous => ({ ...previous, panelSize: normalizePanelSize(value) }));
  const setPanelDepth = (value: number) => setProject(previous => ({ ...previous, panelDepth: normalizePanelDepth(value), panelWallGap:previous.panelMountMode==='corner'?Math.max(previous.panelWallGap,normalizePanelDepth(value)/2+20):previous.panelWallGap }));
  const setPanelImage = (value: ProjectState["panelImage"]) => setProject(previous => ({ ...previous, panelImage: value }));
  const setPanelImageScale = (value: ProjectState["panelImageScale"]) => setProject(previous => ({ ...previous, panelImageScale: value }));
  const setPanelImageX = (value: ProjectState["panelImageX"]) => setProject(previous => ({ ...previous, panelImageX: value }));
  const setPanelImageY = (value: ProjectState["panelImageY"]) => setProject(previous => ({ ...previous, panelImageY: value }));
  const setPanelFaceColor = (value: ProjectState["panelFaceColor"]) => setProject(previous => ({ ...previous, panelFaceColor: value }));
  const setPanelSideColor = (value: ProjectState["panelSideColor"]) => setProject(previous => ({ ...previous, panelSideColor: value }));
  const setLettersText = (value: ProjectState["lettersText"]) => setProject(previous => ({ ...previous, lettersText: value }));
  const setLetterFont = (value: ProjectState["letterFont"]) => setProject(previous => ({ ...previous, letterFont: value }));
  const setLetterHeight = (value: ProjectState["letterHeight"]) => setProject(previous => ({ ...previous, letterHeight: value, letterDepth: normalizeLetterDepth(value, previous.letterDepth, previous.glowMode) }));
  const setLetterWidth = (value: number) => setProject(previous => ({ ...previous, letterWidth: value }));
  const setLetterDepth = (value: ProjectState["letterDepth"]) => patchProject({letterDepth:value});
  const setLineText = (index:number,text:string) => patchProject(index===0?{lettersText:text}:index===1?{secondLineText:text}:{thirdLineText:text});
  const setLineFont = (index:number,font:string) => patchProject({...index===0?{letterFont:font}:{},letterLineFonts:Array.from({length:3},(_,i)=>i===index?font:project.letterLineFonts[i]||project.letterFont)});
  const setLineHeight = (index:number,height:number) => patchProject({...index===0?{letterHeight:height}:{},letterLineHeights:Array.from({length:3},(_,i)=>i===index?height:project.letterLineHeights[i]||project.letterHeight)});
  const selectLetterLine = (index:number) => { setLayoutSelection(`line-${index}`);setEditing(true);setViewMode("2d");setPlacement("none"); };
  const addLetterLine = () => { const index=!project.secondLineText.trim()?1:2;patchProject({...index===1?{secondLineText:"НОВАЯ СТРОКА"}:{thirdLineText:"НОВАЯ СТРОКА"},letterLineFonts:Array.from({length:3},(_,i)=>i===index?project.letterLineFonts[0]||project.letterFont:project.letterLineFonts[i]||""),letterLineHeights:Array.from({length:3},(_,i)=>i===index?project.letterLineHeights[0]||project.letterHeight:project.letterLineHeights[i]||0),letterLineOffsets:Array.from({length:3},(_,i)=>i===index?{x:0,y:0}:project.letterLineOffsets[i]||{x:0,y:0})});selectLetterLine(index);setActiveSection("design"); };
  const removeLetterLine = (index:number) => { setLineText(index,"");setLayoutSelection("composition"); };
  const setLetterFaceColor = (value: ProjectState["letterFaceColor"]) => setProject(previous => ({ ...previous, letterFaceColor: value }));
  const setLetterSideColor = (value: ProjectState["letterSideColor"]) => setProject(previous => ({ ...previous, letterSideColor: value }));
  const setGlowMode = (value: ProjectState["glowMode"]) => patchProject({glowMode:value});
  const setLogoShape = (value: ProjectState["logoShape"]) => setProject(previous => ({ ...previous, logoShape: value }));
  const setLogoImage = (value: ProjectState["logoImage"]) => setProject(previous => ({ ...previous, logoImage: value }));
  const setLogoEnabled = (value: boolean) => setProject(previous => ({ ...previous, logoEnabled: value }));
  const setLogoSize = (value:number) => setProject(previous => ({ ...previous, logoSizeMm: Math.max(100,Math.min(700,value)) }));
  const setLetterOutlineEnabled = (value: ProjectState["letterOutlineEnabled"]) => setProject(previous => ({ ...previous, letterOutlineEnabled: value }));
  const setLogoOutlineEnabled = (value: ProjectState["logoOutlineEnabled"]) => setProject(previous => ({ ...previous, logoOutlineEnabled: value }));
  const setOutlineColor = (value: ProjectState["outlineColor"]) => setProject(previous => ({ ...previous, outlineColor: value }));
  const setHaloBackerEnabled = (value: ProjectState["haloBackerEnabled"]) => setProject(previous => ({ ...previous, haloBackerEnabled: value, ...(value ? { mountMode: "frame" as const } : {}) }));
  const setHaloBackerColor = (value: ProjectState["haloBackerColor"]) => setProject(previous => ({ ...previous, haloBackerColor: value }));
  const setMountMode = (value: ProjectState["mountMode"]) => setProject(previous => ({ ...previous, mountMode: value, ...(value !== "frame" ? { haloBackerEnabled: false } : {}) }));
  const setFrameTopPosition = (value: ProjectState["frameTopPosition"]) => setProject(previous => ({ ...previous, frameTopPosition: value }));
  const setFrameBottomPosition = (value: ProjectState["frameBottomPosition"]) => setProject(previous => ({ ...previous, frameBottomPosition: value }));
  const setAcpColor = (value: ProjectState["acpColor"]) => setProject(previous => ({ ...previous, acpColor: value }));
  const setAcpWidth = (value: ProjectState["acpWidth"]) => setProject(previous => ({ ...previous, acpWidth: value }));
  const setAcpHeight = (value: ProjectState["acpHeight"]) => setProject(previous => ({ ...previous, acpHeight: value }));
  const setAcpDepth = (value: ProjectState["acpDepth"]) => setProject(previous => ({ ...previous, acpDepth: value }));
  const [activeSection, setActiveSection] = useState<StudioSection>("design");
  const [zoom, setZoom] = useState(100);
  const previewArtRef = useRef<HTMLDivElement>(null);
  const [previewFocus, setPreviewFocus] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [placement,setPlacement] = useState<SignPlacement>("none");
  const [neonFontReady,setNeonFontReady] = useState("rounded");
  const [neonFontError,setNeonFontError] = useState("");
  const neonFontKey=JSON.stringify([project.neonFont,...project.neonLineFonts]);
  useEffect(()=>{let active=true;setNeonFontError("");void Promise.all([...new Set([project.neonFont,...project.neonLineFonts])].map(id=>loadNeonFont(id))).then(()=>{if(active)setNeonFontReady(neonFontKey);}).catch(error=>{if(active)setNeonFontError(error.message);});return()=>{active=false;};},[neonFontKey]);
  const [fitSignal, setFitSignal] = useState(0);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [showDimensions, setShowDimensions] = useState(true);
  const [showFacadeSign, setShowFacadeSign] = useState(true);
  const [showFacadePanel, setShowFacadePanel] = useState(true);
  const [showScalePerson, setShowScalePerson] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useSignCart<ProjectState>();
  const latestProject = useRef(project);
  latestProject.current = project;
  const [notice, setNotice] = useState("");
  const pendingFileVersion = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const replaceProjectWithUndo = (next: ProjectState, message: string) => {
    undoHistory.current.push(project);
    if (undoHistory.current.length > 30) undoHistory.current.shift();
    setCanUndo(true); lastUndoEdit.current = 0; layoutInteraction.current = "idle";
    pendingFileVersion.current++;
    setProject(next); setZoom(100); setViewMode("2d"); setEditing(false); setPlacement("none");
    setLayoutSelection("composition"); setSelectedNeonLine(0); setActiveSection("design");
    setFitSignal(value => value + 1); setNotice(message);
  };
  const handleResetSettings = () => {
    replaceProjectWithUndo(resetProjectSettings(), "Все изменения сброшены. Возвращены исходные параметры конструктора. Действие можно отменить.");
    setShowDimensions(true); setShowFacadeSign(true); setShowFacadePanel(true); setShowScalePerson(true); setCartOpen(false); setEditing(true);
  };
  const handleClearLayout = () => replaceProjectWithUndo(clearProjectArtwork(project), "Макет очищен. Действие можно отменить.");
  useEffect(() => {
    const art = previewArtRef.current;
    if (!art || viewMode !== "2d") return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = art.clientWidth, height = art.clientHeight;
        let x = width / 2, y = height / 2;
        const svg = art.querySelector<SVGSVGElement>("svg[data-sign-anchor]");
        const coordinates = svg?.getAttribute("data-sign-anchor")?.trim().split(/\s+/).map(Number);
        const matrix = svg?.getScreenCTM();
        if (svg && matrix && coordinates?.length === 2 && coordinates.every(Number.isFinite)) {
          const point = svg.createSVGPoint(); point.x = coordinates[0]; point.y = coordinates[1];
          const screen = point.matrixTransform(matrix), rect = art.getBoundingClientRect();
          const scale = rect.width / Math.max(1, width);
          // Remove this wrapper's current transform; getScreenCTM includes SVG contain/letterboxing.
          x = (screen.x - rect.left) / scale; y = (screen.y - rect.top) / scale;
        }
        setPreviewFocus(previous => Math.abs(previous.x-x)+Math.abs(previous.y-y)+Math.abs(previous.width-width)+Math.abs(previous.height-height) < .1
          ? previous : { x, y, width, height });
      });
    };
    const observer = new ResizeObserver(update); observer.observe(art);
    const changes = new MutationObserver(update); changes.observe(art, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-sign-anchor", "viewBox"] });
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); changes.disconnect(); };
  }, [viewMode, placement, productId]);
  const previewTranslation = signZoomTranslation(previewFocus, previewFocus, zoom / 100);
  const revealPreviewFrame = useRef(0);
  const revealPreview = () => {
    cancelAnimationFrame(revealPreviewFrame.current);
    revealPreviewFrame.current = requestAnimationFrame(() => {
      revealPreviewFrame.current = requestAnimationFrame(() => {
        const host = workspaceRef.current; if (!host) return;
        const bounds = host.getBoundingClientRect(), height = window.visualViewport?.height ?? window.innerHeight;
        const edge = window.matchMedia("(max-width: 767px)").matches ? 0 : 12;
        if (bounds.height <= height - edge * 2 && (bounds.top < edge || bounds.bottom > height - edge))
          host.scrollIntoView({ block: "start", behavior: "instant" });
      });
    });
  };
  useEffect(() => () => cancelAnimationFrame(revealPreviewFrame.current), []);
  useEffect(()=>{const host=workspaceRef.current;if(!host||viewMode!=="2d")return;const wheel=(event:WheelEvent)=>{if(!(event.target as Element).closest(".builder-preview"))return;event.preventDefault();setZoom(value=>Math.max(25,Math.min(400,Math.round(value*Math.exp(-event.deltaY*.0015)))));};host.addEventListener("wheel",wheel,{passive:false});return()=>host.removeEventListener("wheel",wheel);},[viewMode]);
  const [previewBounds, setPreviewBounds] = useState(() => {
    const width = Math.max(1, Math.min(600, window.innerWidth - 32, (window.innerHeight - 180) * 1.5));
    const previewHeight = width / 1.5;
    return { width, previewHeight, height: previewHeight + 180, sticky: true };
  });
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const host = workspaceRef.current; if (!host) return;
        const mobile = window.matchMedia("(max-width: 767px)").matches;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const style = getComputedStyle(host);
        const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
        const rows = Array.from(host.children).filter(child => !child.classList.contains("builder-preview"));
        const chromeHeight = rows.reduce((height, row) => height + row.getBoundingClientRect().height, borders) +
          (parseFloat(style.rowGap) || 0) * rows.length;
        const availableWidth=parseFloat(getComputedStyle(host.parentElement!).gridTemplateColumns) || host.parentElement!.clientWidth;
        // Width follows the available browser column; viewport height must not create side gutters.
        const width = Math.max(1, Math.floor(Math.min(availableWidth-2, viewportWidth-16)));
        const previewHeight = width / 1.5;
        const height = previewHeight + chromeHeight;
        // A full-width 3:2 canvas can exceed a short viewport: keep its controls reachable by scrolling.
        const sticky = height <= viewportHeight - (mobile ? 120 : 24);
        setPreviewBounds(previous => previous.width === width && previous.previewHeight === previewHeight && previous.height === height && previous.sticky === sticky
          ? previous : { width, previewHeight, height, sticky });
      });
    };
    const host = workspaceRef.current;
    const observer = new ResizeObserver(update);
    if (host) {
      observer.observe(host);
      if (host.parentElement) observer.observe(host.parentElement);
      for (const row of Array.from(host.children)) if (!row.classList.contains("builder-preview")) observer.observe(row);
    }
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, [editing, viewMode, project.productId]);
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
  const [fontPending, setFontPending] = useState(false);
  useEffect(() => {
    let active = true;
    setFontPending(true);
    void Promise.all(lineSettings.map(row=>loadLetterContours(row.font,row.text).catch(error=>{throw new Error(`Строка ${row.index+1}: ${error.message}`);}))).then(lines => {
      if (active) { setLetterContours({...combineLetterLines(lines),lines}); setFontPending(false); }
    }).catch(error => { if (active) { setLetterContours(null); setFontPending(false); setNotice(error.message); } });
    return () => { active = false; };
  }, [contourKey]);
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
  const lettersLayout = useMemo(() => { const layout=createLettersSvgLayout({
    lineSettings,
    acpLayout,
    estimatedWidth: lettersWidth,
    frameBottomPosition,
    frameEdgeInset,
    frameProfile,
    frameTopPosition,
    height: letterHeight,
    letterOutlineEnabled,
    logoScale,
    logoSizeMm:project.logoSizeMm,
    logoShape,
    mountMode,
    text: lettersText,
    textBox: letterTextBox,
    contours: letterContours,
    widthOverride: letterWidth,
    logoEnabled,
    logoOffsetX: project.logoOffsetX, logoOffsetY: project.logoOffsetY, textOffsetX: project.textOffsetX, textOffsetY: project.textOffsetY,
  }); return {...layout,haloBackerPath:haloBackerEnabled&&mountMode==="frame"&&hasHaloGlow(glowMode)?haloBackerContour(layout.textRows??[],project.haloBackerOffsetMm):undefined}; }, [
    haloBackerEnabled,glowMode,project.haloBackerOffsetMm,project.logoSizeMm,
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
    logoEnabled, project.logoOffsetX, project.logoOffsetY, project.textOffsetX, project.textOffsetY, lineSettings,
  ]);
  const alignLayoutSelection = (axis: AlignmentAxis) => {
    lastUndoEdit.current = 0;
    patchProject(centerLayoutSelection(lettersLayout, layoutSelection, logoEnabled, axis, mountMode === "acp"));
    lastUndoEdit.current = 0;
  };
  const packLayout = () => {
    lastUndoEdit.current = 0;
    patchProject(packLayoutComposition(lettersLayout, logoEnabled, mountMode === "acp"));
    lastUndoEdit.current = 0;
    setLayoutSelection("composition");
  };
  useEffect(() => {
    if (project.mountMode !== 'acp' || !letterContours || fontPending || lettersLayout.textRows) return;
    const actualHeight = lettersLayout.textHeight / (letterContours.lineFactor ?? 1);
    const expectedHeight = letterHeight - (letterOutlineEnabled ? Math.max(4, letterHeight * .035) * 2 : 0);
    if (actualHeight < expectedHeight - 1) {
      const nextHeight = Math.max(100, Math.floor(letterHeight * actualHeight / expectedHeight));
      patchProject({ letterHeight: nextHeight, letterWidth: letterWidth ? Math.floor(lettersLayout.signBox.width) : 0 });
    }
  }, [lettersLayout, letterContours, fontPending, project.mountMode, letterHeight, letterOutlineEnabled, letterWidth]);
  const measuredLettersWidth = Math.max(1, Math.round(lettersLayout.signBox.width));
  const lettersAreaM2 = (measuredLettersWidth * lettersLayout.signBox.height) / 1_000_000;
  const glowHasHalo = hasHaloGlow(glowMode);
  const glowLabel = GLOW_MODES.find((item) => item.id === glowMode)?.label || "";
  const mountLabel = MOUNT_MODES.find((item) => item.id === mountMode)?.label || "";
  const rowPrices = (lettersLayout.textRows ?? []).filter(row=>row.text.trim()).map(row=>({...calculateLetterPrice(row.text,row.box.height),index:row.index}));
  const letterPrice = { letterCount:rowPrices.reduce((sum,row)=>sum+row.letterCount,0), total:rowPrices.reduce((sum,row)=>sum+row.total,0) };
  const logoPrice=calculateLogoPrice(lettersLayout.logoBox.height,logoEnabled);
  const pricedTotal=letterPrice.total+logoPrice.total;
  const hasPricedArtwork=letterPrice.letterCount>0||logoPrice.heightCm>0;
  const objectDimensions=(lettersLayout.textRows??[]).filter(row=>row.text.trim()).map(row=>({id:row.id,label:`Строка ${row.index+1}`,width:row.box.width,height:row.box.height}));
  if(logoEnabled)objectDimensions.push({id:"logo",label:"Логотип",width:lettersLayout.logoBox.width,height:lettersLayout.logoBox.height});
  const maximumRowHeight = Math.max(...lineSettings.map(row=>row.height));
  const frameNeedsApproval = mountMode === "frame" && requiresFrameApproval(maximumRowHeight);
  const priceNotes = productId === "neon" ? ["Неоновая вывеска — по согласованию."] : productId === "panel" ? ["Панель-кронштейн — по согласованию."] : [
    ...(hasUnpricedSymbols(combinedText) ? ["Специальные символы — по согласованию."] : []),
    ...(maximumRowHeight > 550 ? ["Глубина букв выше 55 см — по согласованию."] : []),
    ...(lineSettings.some(row=>row.height<=550&&!allowedLetterDepths(row.height).includes(letterDepth)) ? ["Общая глубина для строк разной высоты — по согласованию."] : []),
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
  const visibleObjectDimensions=productId==='neon'?(neonResult.design?.lines??[]).map(row=>({id:`neon-line-${row.index}`,label:`Строка ${row.index+1}`,width:row.width,height:row.height})):objectDimensions;
  const blankSign = isProjectBlank(project);
  const lettersFit = mountMode !== "acp" || [...(lettersLayout.textRows??[]).map(row=>row.inkBox),...(logoEnabled?[lettersLayout.logoBox]:[])].every(box=>box.x>=lettersLayout.panelBox.x+6-.01&&box.y>=lettersLayout.panelBox.y+6-.01&&box.x+box.width<=lettersLayout.panelBox.x+lettersLayout.panelBox.width-6+.01&&box.y+box.height<=lettersLayout.panelBox.y+lettersLayout.panelBox.height-6+.01);
  const canOutputSign = !blankSign && (productId === "letters" ? !fontPending && Boolean(letterContours) && lettersFit
    : productId === "neon" ? Boolean(neonResult.design) && neonFits : true);
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
  const signDepth = productId === "neon" ? (project.neonInstallMode==='hanging'?3:23) + project.neonDiameter : productId === "panel" ? project.panelDepth : letterDepth + (glowHasHalo ? mountMode === "acp" ? 20 : haloBackerEnabled && mountMode === "frame" ? 23 : 0 : 0);
  const companionScene = placement === 'none' ? undefined : productId === 'panel'
    ? !fontPending && letterContours && !isProjectBlank({ ...project, productId: 'letters' })
      ? { project: { ...project, productId: 'letters' as const }, width: mountMode === 'acp' ? acpWidth : measuredLettersWidth,
          height: mountMode === 'acp' ? acpHeight : Math.round(lettersLayout.signBox.height), depth: letterDepth + (glowHasHalo ? mountMode === "acp" ? 20 : haloBackerEnabled && mountMode === "frame" ? 23 : 0 : 0) } : undefined
    : { project: { ...project, productId: 'panel' as const }, width: panelSize, height: panelSize, depth: project.panelDepth };
  const panelMount=productId==='panel'?panelMountLayout(panelSize,panelShape,project.panelWallGap,project.panelCornerRadius,project.panelDepth,project.panelMountMode):undefined;
  const cartQuantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  function handleAddToCart() {
    if (!canOutputSign) return;
    const added = cart.addItem({
      project, label: productId === "neon" ? "Неон · " + project.neonText : productId === "letters" ? lettersText.trim() || "Объемные буквы" : "Панель-кронштейн",
      widthMm: signWidth, heightMm: signHeight, depthMm: signDepth,
      price: productId === "letters" && hasPricedArtwork ? pricedTotal : null,
      requiresApproval: priceNotes.length > 0 || productId === "letters" && !hasPricedArtwork,
      approvalNote: priceNotes.join(" "),
      thumbnailSvg: createCurrentSvg(false),
    });
    if (added) { setCartOpen(true); setNotice("Вывеска добавлена в корзину. Ее параметры сохранены отдельно."); }
  }

  const visualStyle = {
    "--workspace-height": `${previewBounds.height}px`,
    "--workspace-sticky-offset": previewBounds.sticky ? `${previewBounds.height}px` : "0px",
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
    "--frame-edge-inset": "0%",
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
    const fileVersion = pendingFileVersion.current;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Выберите PNG, JPG или WebP.");
      if (file.size > 2_000_000) throw new Error("Изображение больше 2 МБ. Уменьшите файл и загрузите снова.");
      const dataUrl = await readImageFile(file);
      if (fileVersion !== pendingFileVersion.current) return;
      setNotice("Загружаем изображение…");
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      if (fileVersion !== pendingFileVersion.current) return;
      onReady(dataUrl);
      setNotice("Изображение загружено.");
    } catch (error) { if (fileVersion === pendingFileVersion.current) setNotice(error instanceof Error ? error.message : "Не удалось открыть изображение. Попробуйте другой файл."); }
    finally { event.target.value = ""; }
  }
  function handleSaveProject() {
    downloadTextFile(`gorod-svet-${productId === "letters" ? lettersText || "вывеска" : productId === "neon" ? "неон" : "панель"}.json`, JSON.stringify({ version: 1, project }, null, 2), "application/json");
    setNotice("Проект скачан. Его можно открыть здесь на любом устройстве.");
  }
  async function handleOpenProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileVersion = pendingFileVersion.current;
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
      if (fileVersion !== pendingFileVersion.current) return;
      setProject(nextProject);
      setActiveSection("design");
      setZoom(100);
      setNotice("Проект открыт.");
    } catch (error) { if (fileVersion === pendingFileVersion.current) setNotice(error instanceof Error && !(error instanceof SyntaxError) ? error.message : "Не удалось открыть проект. Выберите сохраненный файл JSON."); }
    finally { event.target.value = ""; }
  }
  function createCurrentSvg(withDimensions = showDimensions) {
    if (blankSign) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><title>Пустой макет</title></svg>';
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
      logoFaceColor: project.logoFaceColor.value, logoSideColor: project.logoSideColor.value, haloLightColor: project.haloLightColor.value, faceNoFilm:letterFaceColor.code==="none", logoNoFilm:project.logoFaceColor.code==="none",
      faceColor: letterFaceColor.value,
      font: letterFont,
      frameBottomPosition,
      frameEdgeInset,
      frameProfile,
      frameTopPosition,
      glowMode,
      haloBackerColor: haloBackerColor.value,
      haloBackerEnabled: glowHasHalo && haloBackerEnabled && mountMode === "frame",
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
    if (!canOutputSign) return;
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
          <button className="studio-button studio-reset-all" type="button" onClick={handleResetSettings} title="Сбросить надписи, изображения, размеры, материалы и настройки просмотра к исходным значениям"><RotateCcw size={16} /><span>Сбросить всё</span></button>
          <input hidden ref={projectFileRef} type="file" accept=".json,application/json" onChange={event => void handleOpenProject(event)} />
          <button className="studio-button" type="button" onClick={() => projectFileRef.current?.click()}><FolderOpen size={16} /><span>Открыть</span></button>
          <button className="studio-button" type="button" onClick={handleSaveProject}><Save size={16} /><span>Сохранить проект</span></button>
          <button className="studio-button primary" type="button" onClick={handleExportVector} disabled={!canOutputSign}><Download size={16} /><span>Скачать SVG</span></button>
          <button className="studio-button studio-cart-toggle" type="button" aria-expanded={cartOpen} aria-controls="sign-cart" onClick={() => setCartOpen(value => !value)}><ShoppingCart size={17} /><span>Корзина</span><span className="cart-count">{cartQuantity}</span></button>
        </div>
      </header>
      {notice && <div className="studio-notice" role="status"><span>{notice}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={16} /></button></div>}
      {cartOpen && <div><SignCart items={cart.items} onQuantityChange={cart.updateQuantity} onRemove={cart.removeItem} onClear={cart.clear} error={cart.error} onDismissError={cart.dismissError} onEdit={item => {
        try { setProject(validateProject({ version: 1, project: item.project })); setActiveSection("design"); setZoom(100); setCartOpen(false); setNotice("Макет открыт из корзины. Изменения можно добавить отдельной позицией."); }
        catch { setNotice("Этот проект не удалось открыть. Остальные позиции корзины доступны."); }
      }} /></div>}
      {cart.error && !cartOpen && <div className="studio-notice" role="alert">{cart.error}<button type="button" aria-label="Закрыть ошибку корзины" onClick={cart.dismissError}><X size={16} /></button></div>}
      <div className="studio-heading"><div><h1>Конструктор вывесок</h1><p>Создайте макет с размерами. Затем примерьте вывеску и кронштейн на фасаде в 3D.</p></div><span>Город Свет<ArrowUpRight size={16} /></span></div>
      <section className="product-tabs" aria-label="Тип вывески">
        {[...PRODUCTS].reverse().map(product => <button type="button" key={product.id} aria-pressed={productId === product.id} className={productId === product.id ? "active" : ""} onClick={() => { setProductId(product.id); setActiveSection("design"); setZoom(100); }}>
          {product.id === "letters" ? <Type size={24} /> : <Maximize size={24} />}
          <div><strong>{product.title}</strong><span>{product.note}</span></div><Check className="product-check" size={18} />
        </button>)}
      </section>
      <section className="sign-builder-layout">

        <aside className="builder-controls" id="studio-controls" aria-label="Настройки вывески">
          <header className="controls-heading"><h2>Настройте вывеску</h2><span>Все изменения — на макете</span></header>
          <div className="studio-project-actions" role="group" aria-label="Действия с макетом">
            <button type="button" onClick={handleClearLayout}><Eraser size={14} />Очистить макет</button>
            <button type="button" title="Отменить последнее изменение (Ctrl / Command Z)" disabled={!canUndo} onClick={undoNeon}><Undo2 size={14} />Отменить</button>
          </div>
          {productId !== "neon" && <nav className="studio-section-tabs" aria-label="Разделы настроек">
            {SECTION_ITEMS.filter(item => productId === "letters" ? item.id !== "logo" : ["design", "colors", "mount", "logo"].includes(item.id)).map(item => <button type="button" key={item.id} aria-pressed={activeSection === item.id} className={activeSection === item.id ? "active" : ""} onClick={() => setActiveSection(item.id)}><item.icon size={18} /><span>{productId === "panel" && item.id === "design" ? "Форма" : item.label}</span></button>)}
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
              faceColors={<FaceFilmControl luminous={glowMode!=="halo"} selected={letterFaceColor} tone={project.letterWhiteTone} label="Тип свечения букв" onSelect={setLetterFaceColor} onToneChange={value=>patchProject({letterWhiteTone:value})} />}
              logoColors={<><h3>Лицо логотипа · Oracal {glowMode === "halo" ? "641" : "8500"}</h3><FaceFilmControl luminous={glowMode!=="halo"} selected={project.logoFaceColor} tone={project.logoWhiteTone} label="Тип свечения логотипа" onSelect={value=>patchProject({logoFaceColor:value})} onToneChange={value=>patchProject({logoWhiteTone:value})} /><h3>Борт логотипа · Oracal 641</h3><ColorGrid colors={ORACAL_641_COLORS} selected={project.logoSideColor} onSelect={value=>patchProject({logoSideColor:value})} compact /></>}
              haloColors={glowHasHalo && <><h3>Цвет контражура</h3><ColorGrid colors={ORACAL_8500_COLORS} selected={project.haloLightColor} onSelect={value=>patchProject({haloLightColor:value})} compact /><p className="control-note">Цвет подсветки выбирается независимо от лица букв и логотипа.</p></>}
              lineEditor={<LetterLinesControls rows={[project.lettersText,project.secondLineText,project.thirdLineText].map((text,index)=>({index,text,font:project.letterLineFonts[index]||letterFont,height:project.letterLineHeights[index]||letterHeight})).filter(row=>row.index===0||row.text.trim())} onTextChange={setLineText} onFontChange={setLineFont} onHeightChange={setLineHeight} onSelect={selectLetterLine} onAdd={addLetterLine} onRemove={removeLetterLine}/>}
              rowHeights={lineSettings.map(row=>row.height)}
              acpColor={acpColor}
              acpDepth={acpDepth}
              acpHeight={acpHeight}
              acpWidth={acpWidth}
              depth={letterDepth}
              faceColor={letterFaceColor}
              font={letterFont}
              frameBottomPosition={frameBottomPosition}
              frameProfile={frameProfile}
              frameTopPosition={frameTopPosition}
              glowMode={glowMode}
              haloBackerColor={haloBackerColor}
              haloBackerEnabled={haloBackerEnabled}
              haloBackerOffsetMm={project.haloBackerOffsetMm}
              onHaloBackerOffsetChange={value=>patchProject({haloBackerOffsetMm:value})}
              height={letterHeight}
              width={measuredLettersWidth}
              widthAuto={letterWidth === 0}
              logoEnabled={logoEnabled}
              letterOutlineEnabled={letterOutlineEnabled}
              logoImage={logoImage}
              logoOutlineEnabled={logoOutlineEnabled}
              logoSizeMm={project.logoSizeMm}
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
              onLogoSizeChange={setLogoSize}
              onLogoShapeChange={setLogoShape}
              onMountModeChange={setMountMode}
              onOutlineColorChange={setOutlineColor}
              onSideColorChange={setLetterSideColor}
              onTextChange={setLettersText}
            />
          )}
          </SectionContext.Provider>
          {productId === "neon" && (neonResult.error || !neonFits) && <p className="studio-fit-warning" role="alert">{neonResult.error || "Уменьшите высоту или длину надписи, чтобы она поместилась на подложке."}</p>}
          {activeSection === (productId === "letters" ? "design" : "logo") && (productId === "letters" ? logoImage : panelImage) && <button className="studio-remove" type="button" onClick={() => productId === "letters" ? setLogoImage("") : setPanelImage("")}><X size={14} />Удалить изображение</button>}
          {productId === "panel" && activeSection === "design" && <p className="control-note">Размер — диаметр круга или сторона квадрата, в миллиметрах.</p>}
          {productId === "letters" && activeSection === "mount" && mountMode === "acp" && !lettersFit && <p className="studio-fit-warning" role="status">Макет не помещается на подложке при минимальной высоте 100 мм. Увеличьте подложку или измените надпись и размеры элементов.</p>}
          </div>
          <details className="studio-help"><summary>Как пользоваться студией<ChevronRight size={14} /></summary><p>Выберите тип вывески и настройте параметры по разделам. Переключайте день и ночь, чтобы оценить свечение. Проект сохраняется в этом браузере. Скачайте JSON для переноса на другое устройство.</p><p>Макет дает представление о конструкции. Цвета на экране могут отличаться от физических образцов Oracal; производственную документацию нужно подготовить отдельно.</p></details>
        </aside>
        <section ref={workspaceRef} style={{ top: previewBounds.sticky ? undefined : 0, "--preview-width": `${previewBounds.width}px`, "--preview-height": `${previewBounds.previewHeight}px`, "--workspace-position": previewBounds.sticky ? "sticky" : "relative" } as CSSProperties} className={`studio-workspace scene-${sceneMode} ${viewMode === "3d" ? "is-3d" : ""}`} aria-label="Рабочий макет"
          onFocusCapture={event => { if (!(event.target as Element).closest(".dimensions-toggle") && (event.target as Element).closest(".canvas-toolbar,.canvas-mode-toolbar,.editor-toolbar,.neon-inline-toolbar,.canvas-footer")) revealPreview(); }}
          onPointerDownCapture={event => { if (!(event.target as Element).closest(".dimensions-toggle") && (event.target as Element).closest(".canvas-toolbar,.canvas-mode-toolbar,.editor-toolbar,.neon-inline-toolbar,.canvas-footer")) revealPreview(); }}
          onWheelCapture={revealPreview}>
          <header className="canvas-toolbar"><div className="canvas-title"><strong>Предпросмотр</strong><span>{sceneMode === "day" ? "Дневное освещение" : "Ночное освещение"}</span></div>
            <button type="button" className={"sign-power-switch "+(project.lightsOn?'on':'off')} role="switch" aria-checked={project.lightsOn} aria-label="Свет вывески" title={project.lightsOn?'Выключить свет вывески':'Включить свет вывески'} onClick={()=>patchProject({lightsOn:!project.lightsOn})}><Power size={15}/><span className="power-caption">Свет</span><span className="power-lever" aria-hidden="true"/><span className="power-state">{project.lightsOn?'Вкл':'Выкл'}</span></button>
            <div className={"scene-switch " + sceneMode} role="group" aria-label="Режим визуализации">
              <span className="celestial-track" aria-hidden="true"><Sun className="celestial-sun" size={19}/><Moon className="celestial-moon" size={19}/></span>
              <button type="button" aria-pressed={sceneMode === "day"} className={sceneMode === "day" ? "active" : ""} onClick={() => setSceneMode("day")}><Sun size={16} />День</button>
              <button type="button" aria-pressed={sceneMode === "night"} className={sceneMode === "night" ? "active" : ""} onClick={() => setSceneMode("night")}><Moon size={16} />Ночь</button>
            </div><div className="canvas-tools"><button type="button" aria-label="Уменьшить макет" disabled={zoom <= 25} onClick={() => setZoom(value => Math.max(25, value - 10))}><Minus size={16} /></button><span className="zoom-value" title="100% — масштаб после подгонки">{zoom}%</span><button type="button" aria-label="Увеличить макет" disabled={zoom >= 400} onClick={() => setZoom(value => Math.min(400, value + 10))}><Plus size={16} /></button><button type="button" aria-label="Подогнать макет" onClick={handleFitPreview}><Maximize size={16} /></button></div>
          </header>
          <div className="canvas-mode-toolbar">
            <div className="view-switch" role="group" aria-label="Вид макета"><button type="button" aria-pressed={viewMode === "2d"} className={viewMode === "2d" ? "active" : ""} onClick={() => { setViewMode("2d"); setZoom(100); setPlacement('none'); setEditing(true); }}>Конструктор · 2D</button><button type="button" aria-pressed={viewMode === "3d"} className={viewMode === "3d" ? "active" : ""} onClick={() => { setViewMode("3d"); setZoom(100); setEditing(false); if (placement === 'none') setPlacement('windows'); }}>Примерка · 3D</button></div>
            {productId !== "panel" && viewMode === "2d" && <button className={"editor-toggle " + (editing ? "active" : "")} type="button" aria-pressed={editing} onClick={() => { setPlacement("none"); setEditing(!editing); }}>Редактировать макет</button>}
            <label className="placement-select"><span>Размещение</span><select aria-label="Размещение в основном просмотре" value={placement} onChange={e=>{setPlacement(e.target.value as SignPlacement);setEditing(false);}}>{SIGN_PLACEMENTS.map(place=><option key={place.id} value={place.id}>{place.title}</option>)}</select></label>
            <label className="dimensions-toggle" onMouseDown={event => event.preventDefault()}><input type="checkbox" checked={showDimensions} onChange={event => setShowDimensions(event.target.checked)} />Размеры</label>
          </div>
          {viewMode === '3d' && placement !== 'none' && <div className="facade-context-toolbar" role="group" aria-label="Общий вид фасада">
            <label><input type="checkbox" checked={showFacadeSign} onChange={event => setShowFacadeSign(event.target.checked)} />{productId === 'neon' ? 'Неоновая вывеска' : 'Вывеска'}</label>
            <label><input type="checkbox" checked={showFacadePanel} onChange={event => setShowFacadePanel(event.target.checked)} />Панель-кронштейн</label>
            <label><input type="checkbox" checked={showScalePerson} onChange={event => setShowScalePerson(event.target.checked)} />Человек 175 см</label>
            <span>Параметры каждого изделия — в его вкладке</span>
          </div>}
          {productId === "letters" && viewMode === "2d" && editing && <div className="editor-toolbar layout-alignment-toolbar" aria-label="Выбор и выравнивание объектов макета">
            <button className="layout-pack-button" type="button" title="Собрать логотип и надпись в ряд с обычным промежутком и центрировать по обеим осям" disabled={fontPending} onClick={packLayout}>Собрать и центрировать</button>
            <label className="layout-object-select"><span>Объект</span><select aria-label="Выбранный объект макета" value={layoutSelection} onChange={event => setLayoutSelection(event.target.value as LayoutObject)}><option value="text">Все строки</option>{lineSettings.filter(row=>row.text.trim()).map(row=><option key={row.index} value={`line-${row.index}`}>Строка {row.index+1}</option>)}<option value="logo" disabled={!logoEnabled}>Логотип</option><option value="composition">Вся композиция</option></select></label>
            <div className="alignment-actions" role="group" aria-label={mountMode === "acp" ? "Центрирование по подложке" : "Центрирование по макету"}>
              <button type="button" title={mountMode === "acp" ? "По центру подложки по горизонтали" : "По центру макета по горизонтали"} disabled={fontPending} onClick={() => alignLayoutSelection("x")}><AlignHorizontalJustifyCenter size={16}/>Центр X</button>
              <button type="button" title={mountMode === "acp" ? "По центру подложки по вертикали" : "По центру макета по вертикали"} disabled={fontPending} onClick={() => alignLayoutSelection("y")}><AlignVerticalJustifyCenter size={16}/>Центр Y</button>
            </div>
            <span className="alignment-reference">{mountMode === "acp" ? "По подложке" : "По макету"}</span>
            <button type="button" aria-label="Отменить изменение макета" title="Отменить изменение макета (Ctrl / Command Z)" disabled={!canUndo} onClick={undoNeon}><Undo2 size={16}/></button>
            <button type="button" disabled={!!project.secondLineText.trim()&&!!project.thirdLineText.trim()} onClick={addLetterLine}>+ Строка ниже</button>
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
          {!blankSign && (fontPending && productId === "letters" || productId === "neon" && neonFontReady!==neonFontKey && !neonFontError) && <div className="studio-font-loading" role="status">Обновляем шрифт…</div>}
          {blankSign ? <div className="studio-empty-preview" role="status"><Type size={34} aria-hidden="true" /><strong>Макет пуст</strong>
            <p>{productId === "neon" ? "Добавьте надпись или фигуру в настройках." : "Добавьте надпись или логотип в настройках."}</p>
            <a className="studio-button" href="#studio-controls" onClick={() => setActiveSection("design")}>Добавить надпись</a>
          </div> : viewMode === "3d" && !(productId === "neon" && (!neonResult.design || !neonFits)) ? <SceneBoundary onFail={handle3DUnavailable}><Suspense fallback={<div className="studio-3d-loading" role="status">Строим объемную модель…</div>}><SignScene3D project={project} layout={lettersLayout} width={signWidth} height={signHeight} depth={signDepth} showDimensions={showDimensions} zoom={zoom} onZoomChange={setZoom} placement={placement} companion={companionScene} showPerson={showScalePerson} showSign={showFacadeSign} showPanel={showFacadePanel} resetKey={fitSignal} onUnavailable={handle3DUnavailable} /></Suspense></SceneBoundary> : <div className="preview-wall"><div ref={previewArtRef} className="preview-art" data-sign-focus={`${previewFocus.x.toFixed(2)},${previewFocus.y.toFixed(2)}`} style={{ "--preview-zoom": zoom / 100, transform: `translate(${previewTranslation.x}px, ${previewTranslation.y}px) scale(${zoom / 100})`, transformOrigin: "center" } as CSSProperties}>
            {placement!=="none" ? <SvgMarkupPreview className="facade-svg-render" markup={createFacadeSvg(placement,createCurrentSvg(false),sceneMode==="night",'canvas',{palette:project.facadePalette,signBox:facadeSignBox,panelMount})}/> : project.backdropImage&&!editing ? <SignPhotoPreview image={project.backdropImage} imageWidthMm={project.backdropWidth} signBox={facadeSignBox} markup={createCurrentSvg(showDimensions)} night={sceneMode==='night'}/> : productId === "neon" ? <SvgMarkupPreview className="letters-svg-render" markup={neonResult.design && neonFits ? createCurrentSvg(showDimensions) : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 180"><text x="200" y="90" text-anchor="middle" fill="#788f83" font-family="Arial" font-size="14">Настройте надпись и размеры</text></svg>'}>{editing&&neonResult.design&&neonFits&&<NeonStudioEditor design={neonResult.design} backerWidth={neonWidth} backerHeight={neonHeight} project={project} onChange={patchProject} selectedLine={selectedNeonLine} onSelectLine={setSelectedNeonLine}/>}</SvgMarkupPreview> : productId === "panel" ? (
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
                objectColors={{logoFaceColor:project.logoFaceColor.value,logoSideColor:project.logoSideColor.value,haloLightColor:project.haloLightColor.value,faceNoFilm:letterFaceColor.code==="none",logoNoFilm:project.logoFaceColor.code==="none"}}
                lightsOn={project.lightsOn}
                editor={editing && !fontPending ? <SignLayoutEditor layout={lettersLayout} project={project} selection={layoutSelection} onSelect={setLayoutSelection} onChange={patchProject} onInteractionStart={beginLayoutInteraction} onInteractionEnd={endLayoutInteraction} onUndo={undoNeon}/> : undefined}
                sceneMode={sceneMode}
                acpDepth={acpDepth}
                acpColor={acpColor.value}
                depth={letterDepth}
                faceColor={letterFaceColor.value}
                font={letterFont}
                frameProfile={frameProfile}
                glowMode={glowMode}
                haloBackerColor={haloBackerColor.value}
                haloBackerEnabled={glowHasHalo && haloBackerEnabled && mountMode === "frame"}
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
          {showDimensions && !blankSign && <div className="canvas-dimensions"><span className="dimension-line" /><span>{signWidth} × {signHeight} × {signDepth} мм</span><span className="dimension-line" /></div>}
        </section>
          {!blankSign && (productId!=="panel" || viewMode==="3d"&&placement!=="none"&&showFacadeSign) && <div className="canvas-object-dimensions" aria-label="Размеры элементов вывески" aria-hidden={!showDimensions} style={{ visibility: showDimensions ? "visible" : "hidden" }}>{visibleObjectDimensions.map(item=><span key={item.id}><strong>{item.label}</strong> {Math.round(item.width)} × {Math.round(item.height)} мм</span>)}</div>}
          <footer className="canvas-footer"><span><span className={`material-dot ${sceneMode}`} />{placement !== "none" ? `Дверь 1100 × 2100 мм${placement === "canopy" ? " · вынос козырька 1500 мм" : ""}` : productId === "letters" ? `Борт ${letterDepth} мм${glowHasHalo && mountMode === "acp" ? " · проставки 20 мм" : glowHasHalo && haloBackerEnabled && mountMode === "frame" ? " · проставки 20 мм · подложка 3 мм" : ""}` : productId === "neon" ? "Неон " + project.neonDiameter + " мм · " +(project.neonBackerColor==='black'?'черная':project.neonBackerColor==='white'?'белая':'прозрачная')+" подложка" : "Лицевое свечение"}</span><button type="button" onClick={handleFitPreview}><RotateCcw size={13} />Масштаб по размеру окна</button></footer>
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
              {blankSign ? "Пока не задан" : `${signWidth} × ${signHeight} × ${signDepth} мм`}
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
            <strong>{productId === "neon" ? [...new Set(project.neonText.split('\n').flatMap((text,index)=>text.trim()?[project.neonLineColors[index]||project.neonColor]:[]))].join(' · ') : currentFaceColor.code === "none" ? currentFaceColor.name + " · " + WHITE_LIGHT_TONES.find(item=>item.id===project.letterWhiteTone)!.label.toLowerCase() : currentFaceColor.code + " " + currentFaceColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>{productId === "neon" ? "Подложка" : "Борт"}</span>
            <strong>{productId === "neon" ? (project.neonBackerColor==='black'?'Черная':project.neonBackerColor==='white'?'Белая':'Прозрачная')+" · 3 мм" : currentSideColor.code + " " + currentSideColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>{productId === "letters" ? "Габаритная площадь" : "Площадь лица"}</span>
            <strong>{blankSign ? "—" : `${formatArea(productId === "neon" ? neonWidth * neonHeight / 1_000_000 : productId === "panel" ? panelAreaM2 : lettersAreaM2)} м²`}</strong>
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
            <div className="price-details"><span>{productId === "letters" ? "Буквы и логотип" : "Стоимость вывески"}</span><strong className="price-total">{blankSign ? "—" : productId === "letters" && hasPricedArtwork ? formatMoney(pricedTotal) : "По согласованию"}</strong>
            {productId === "letters" && letterPrice.letterCount > 0 && rowPrices.map(row=><p key={row.index} className="price-formula">Строка {row.index+1}: {row.letterCount} букв × {Number(row.heightCm.toFixed(1))} см × 120 ₽</p>)}{productId === "letters" && logoEnabled && <p className="price-formula">Логотип: {Number(logoPrice.heightCm.toFixed(1))} см × 180 ₽ = {formatMoney(logoPrice.total)}</p>}</div>
            <button className="studio-add-cart" type="button" onClick={handleAddToCart} disabled={!canOutputSign}><ShoppingCart size={18} />В корзину</button>
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
        <p className="control-note">Размер панели, мм</p>
        <div className="size-grid">
          {PANEL_SIZES.map((item) => (
            <button
              aria-pressed={size === item} className={size === item ? "active" : ""}
              key={item}
              onClick={() => onSizeChange(item)}
              type="button"
            >
              {item} мм
            </button>
          ))}
        </div>
        <p className="control-note">Глубина панели</p><div className="option-grid two" role="group" aria-label="Глубина панели">{PANEL_DEPTHS.map(value=><button key={value} type="button" aria-pressed={depth===value} className={depth===value?"active":""} onClick={()=>onDepthChange(value)}>{value} мм</button>)}</div>
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
  logoColors,haloColors,faceColors,
  lineEditor,
  rowHeights,
  acpColor,
  acpDepth,
  acpHeight,
  acpWidth,
  depth,
  faceColor,
  font,
  frameBottomPosition,
  frameProfile,
  frameTopPosition,
  glowMode,
  haloBackerColor,
  haloBackerEnabled,
  haloBackerOffsetMm,onHaloBackerOffsetChange,
  height,
  width,
  widthAuto,
  logoEnabled,
  letterOutlineEnabled,
  logoImage,
  logoOutlineEnabled,
  logoSizeMm,
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
  onLogoSizeChange,
  onLogoShapeChange,
  onMountModeChange,
  onOutlineColorChange,
  onSideColorChange,
  onTextChange,
}: {
  logoColors: ReactNode; haloColors: ReactNode; faceColors: ReactNode;
  acpColor: ColorOption;
  lineEditor: ReactNode;
  rowHeights: number[];
  acpDepth: number;
  acpHeight: number;
  acpWidth: number;
  depth: number;
  faceColor: ColorOption;
  font: string;
  frameBottomPosition: number;
  frameProfile: FrameProfile;
  frameTopPosition: number;
  glowMode: GlowMode;
  haloBackerColor: ColorOption;
  haloBackerEnabled: boolean;
  haloBackerOffsetMm:number;onHaloBackerOffsetChange:(value:number)=>void;
  height: number;
  width: number;
  widthAuto: boolean;
  logoEnabled: boolean;
  letterOutlineEnabled: boolean;
  logoImage: string;
  logoOutlineEnabled: boolean;
  logoSizeMm: number;
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
  onLogoSizeChange: (value: number) => void;
  onLogoShapeChange: (shape: LogoShape) => void;
  onMountModeChange: (mode: MountMode) => void;
  onOutlineColorChange: (color: ColorOption) => void;
  onSideColorChange: (color: ColorOption) => void;
  onTextChange: (value: string) => void;
}) {
  const glowHasHalo = hasHaloGlow(glowMode);
  const frameHeight = Math.max(...rowHeights);
  const depthOptions = allowedLetterDepths(rowHeights).filter(value => !hasHaloGlow(glowMode) || value <= 50);
  const selectableDepths = depthOptions.length ? depthOptions : hasHaloGlow(glowMode) ? [40,50] : [60];

  return (
    <>
      <ControlSection title="Надпись">
        {lineEditor}
        <div className="dimension-number-grid">
          <NumberField label="Ширина вывески, мм" min={Math.round(logoEnabled ? logoSizeMm+height*.16+20 : height*.3)} max={20000} onChange={onWidthChange} value={width} />

        </div>
        <label className={"width-auto-checkbox " + (widthAuto ? "checked" : "")}><input type="checkbox" checked={widthAuto} onChange={event => onWidthChange(event.target.checked ? 0 : width)}/><span><strong>Ширина по пропорциям</strong><small>{widthAuto ? "Сохраняем естественные пропорции шрифта" : "Ширину можно менять вручную"}</small></span></label>
        <label className="builder-field"><span>Глубина борта букв, мм</span><select value={depth} onChange={event => onDepthChange(Number(event.target.value))}>{selectableDepths.map(value => <option key={value} value={value}>{value} мм{!depthOptions.length ? " · по согласованию" : ""}</option>)}</select><small className="control-note">40 мм — до 18 см; 50 мм — 12–35 см; 60 мм — 20–55 см. Для контражура — 40 или 50 мм.</small></label>
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
        {haloColors}
      </ControlSection>

      {hasHaloGlow(glowMode) && <ControlSection title="Контражурная подложка">
        <label className="dimensions-toggle"><input type="checkbox" checked={haloBackerEnabled} onChange={event=>onHaloBackerEnabledChange(event.target.checked)} />Контурная подложка на раме</label>
        {haloBackerEnabled && <><RangeField label="Отступ от букв, мм" min={15} max={25} step={5} value={haloBackerOffsetMm} onChange={onHaloBackerOffsetChange} /><ColorGrid colors={ORACAL_641_COLORS} selected={haloBackerColor} onSelect={onHaloBackerColorChange} compact /><p className="control-note">Плоская подложка крепится на раме. Борт — 40 или 50 мм; зазор от задней части букв до подложки — 20 мм на дистанционных проставках.</p></>}
      </ControlSection>}

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
          <div className={`frame-policy ${frameHeight > 550 ? "warning" : ""}`}><strong className="frame-profile">{frameHeight > 550 ? "Рама по согласованию" : "Профиль 15 × 15 мм"}</strong><p>{frameHeight > 550 ? "Буквы выше 55 см. Сечение и конструкцию рамы согласуем перед изготовлением. В макете показан профиль 15 мм." : "По две горизонтальные трубы на каждую строку, соединённые сварными перемычками."}</p></div>
          <RangeField label="Верхний отступ рамы, мм" max={20} min={10} onChange={onFrameTopPositionChange} value={frameTopPosition} />
          <RangeField label="Нижний отступ рамы, мм" max={20} min={10} onChange={onFrameBottomPositionChange} value={frameBottomPosition} /><p className="control-note">Отступы внутрь от верхнего и нижнего края меньшего элемента: логотипа или надписи. У букв хвосты и надстрочные элементы не учитываются.</p>
          <small className="control-note">Длина каждой пары труб ограничена своей строкой. Логотип соединён с внутренними трубами или сварной перемычкой. Положение одинаково в 2D и 3D.</small>
        </ControlSection>
      )}

      {mountMode === "acp" && (
        <ControlSection title="Подложка АКП">
        <p className="control-note">Цвет подложки · Oracal 641</p>
          <div className="sign-size-grid">
            <NumberField label="Ширина, мм" min={400} max={20000} onChange={onAcpWidthChange} value={acpWidth} />
            <NumberField label="Высота, мм" min={250} max={backerLimits(acpDepth).height} onChange={onAcpHeightChange} value={acpHeight} />
          </div>
          <RangeField label="Глубина подложки, мм" max={100} min={30} onChange={onAcpDepthChange} step={5} value={acpDepth} />
          <small className="control-note">Допустимые размеры рассчитываются автоматически.</small>
          <ColorGrid colors={ORACAL_641_COLORS} selected={acpColor} onSelect={onAcpColorChange} compact />
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
        {logoEnabled && <NumberField label="Размер логотипа, мм" max={700} min={100} onChange={onLogoSizeChange} value={logoSizeMm} />}
        {logoEnabled && logoColors}
        <small className="control-note">Логотип: 180 ₽ за сантиметр высоты. Размер — от 100 до 700 мм.</small>
      </ControlSection>

      <ControlSection title={glowMode === "halo" ? "Лицо Oracal 641" : "Лицо Oracal 8500"}>
        {faceColors}
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setWindowsLit(facadeNight); return;
    }
    // Hold the current window state through the exterior fade, including quick reversals.
    const delay=facadeNight?SCENE_LIGHTING_TIMING.windowsDelayMs:SCENE_LIGHTING_TIMING.windowsOffDelayMs;
    const timer = window.setTimeout(() => setWindowsLit(facadeNight), delay);
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
  objectColors,
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
  objectColors: Pick<LettersSvgMarkupConfig,"logoFaceColor"|"logoSideColor"|"haloLightColor"|"faceNoFilm"|"logoNoFilm">;
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
    lightsOn, ...objectColors,
    acpColor, acpDepth, depth, faceColor, font, glowMode, haloBackerColor,
    haloBackerEnabled, height, layout, letterOutlineEnabled,
    logoImage, logoOutlineEnabled, logoShape, mountMode, outlineColor,
    sceneMode, sideColor, text, logoEnabled, showDimensions,
  }).replace(/^<\?xml[^>]*\?>\s*/, "");

  return (
    <div className={"letters-scene mount-" + mountMode + (haloBackerEnabled ? " with-halo-backer" : "")}>
      <SvgMarkupPreview className="letters-svg-render" markup={svg}>{editor}</SvgMarkupPreview>
      <div className="preview-dimension">
        h {height} мм · борт {depth} мм
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

function FaceFilmControl({luminous,selected,tone,label,onSelect,onToneChange}: {
  luminous:boolean;selected:ColorOption;tone:WhiteLightTone;label:string;
  onSelect:(color:ColorOption)=>void;onToneChange:(tone:WhiteLightTone)=>void;
}) {
  if(!luminous)return <ColorGrid colors={ORACAL_641_COLORS} selected={selected} onSelect={onSelect} />;
  return <div className="face-film-control">
    <button type="button" className="face-no-film" aria-pressed={selected.code==="none"} onClick={()=>onSelect(bareFaceColor(tone))}>Без плёнки</button>
    {selected.code==="none" && <div className="white-light-control"><h3>{label}</h3><div className="white-light-options" role="group" aria-label={label}>
      {WHITE_LIGHT_TONES.map(item=><button key={item.id} type="button" aria-pressed={tone===item.id} onClick={()=>onToneChange(item.id)}><i style={{background:item.value}} aria-hidden="true"/><span>{item.label}</span><small>{item.kelvin}</small></button>)}
    </div></div>}
    <ColorGrid colors={LIGHT_FACE_FILMS} selected={selected} onSelect={onSelect}/>
  </div>;
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
          <i style={{ background: color.code === "000" ? "repeating-conic-gradient(#ffffff 0% 25%, #d4d9d5 0% 50%) 0 / 10px 10px" : color.value }} />
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
  if (config.lineSettings) return createLetterRowsLayout({...config,lineSettings:config.lineSettings});
  const requestedHeight = clamp(config.height, 100, 700);
  const factor = config.contours?.lineFactor ?? 1;
  const natural = config.contours?.mainBox ?? config.textBox ?? { x: 0, y: -714, width: Math.max(1, config.text.length) * 640, height: 714 };
  const logoEnabled = Boolean(config.logoEnabled);
  const requestedLogo = logoEnabled ? (config.logoSizeMm===undefined ? clamp(requestedHeight * clamp(config.logoScale,45,130)/100,100,700) : clamp(config.logoSizeMm,100,700)) : 0;
  const requestedGap = logoEnabled ? requestedHeight * LETTER_GAP_FACTOR : 0;
  const outline = config.letterOutlineEnabled ? Math.max(4, requestedHeight * .035) : 0;
  const requestedTextHeight = (requestedHeight - outline * 2) * factor;
  const naturalWidth = requestedTextHeight * natural.width / natural.height;
  const requestedWidth = config.widthOverride ? Math.max(requestedLogo + requestedGap + 20, config.widthOverride) : requestedLogo + requestedGap + naturalWidth + outline * 2;
  const ink = config.contours?.inkBox ?? natural;
  const overTop = Math.max(0, natural.y - ink.y) / natural.height * requestedTextHeight;
  const overBottom = Math.max(0, ink.y + ink.height - natural.y - natural.height) / natural.height * requestedTextHeight;
  const panelRequired = config.mountMode === 'acp';
  const minimumFit = Math.max(100/requestedHeight,requestedLogo?100/requestedLogo:0);
  const fit = panelRequired ? Math.max(minimumFit,Math.min(1, (config.acpLayout.faceWidth - 12) / requestedWidth,
    (config.acpLayout.faceHeight - 12) / (Math.max(requestedTextHeight + outline * 2, requestedLogo) + overTop + overBottom))) : 1;
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
  const textInkBox={x:textX,y:textTop-overTop*fit,width:textWidth,height:textHeight+(overTop+overBottom)*fit};
  const textBody={y:textTop-outline*fit,height:textHeight+outline*2*fit};
  const frameReference=logoEnabled&&logoBox.height>0&&logoBox.height<textBody.height?logoBox:textBody;
  const railHeight=15, centers=frameRailCenters(frameReference.y,frameReference.height,config.frameTopPosition,config.frameBottomPosition);
  const railTopY=centers.top,railBottomY=centers.bottom;
  const railX=signBox.x,railWidth=signBox.width;
  const haloBackerBox={x:signBox.x-height*.16,y:signBox.y-height*.11,width:signBox.width+height*.32,height:signBox.height+height*.22};
  return {defaultTextX,defaultTextY,defaultLogoX,defaultLogoY,viewWidth,viewHeight,signBox,logoBox,logoCornerRadius:logoSize*.16,textX,textTop,textBaseline,textWidth,textHeight,textInkBox,fontSize,
    textPathData:config.contours?.pathData,textNaturalBox:natural,railX,railWidth,railHeight,railTopY,railBottomY,panelBox,panelCornerRadius:0,
    haloBackerBox,haloBackerRadius:Math.min(height*.28,haloBackerBox.height/2),seamXs:panelRequired?backerSeams(panelBox.width,config.acpLayout.depth??50).map(x=>panelBox.x+x):[],seamYs:[]};
}

function createLettersSvgMarkup(
  config: Partial<LettersSvgMarkupConfig> & Pick<LettersSvgMarkupConfig,
    "layout" | "height" | "depth" | "faceColor" | "sideColor" | "font" |
    "text" | "glowMode" | "mountMode" | "acpColor" | "haloBackerEnabled" |
    "haloBackerColor" | "letterOutlineEnabled" | "logoOutlineEnabled" |
    "outlineColor" | "logoShape" | "logoImage" | "logoFaceColor" | "logoSideColor" | "haloLightColor"
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
  const surfaceFace = config.faceNoFilm && !faceLit ? "#f5f5f3" : config.faceColor;
  const surfaceLogo = config.logoNoFilm && !faceLit ? "#f5f5f3" : config.logoFaceColor ?? config.faceColor;
  const face = night && !faceLit ? mix(surfaceFace, "#18212d", 0.6) : faceLit&&!night?mix(surfaceFace,'#ffffff',.06):surfaceFace;
  const logoFace = night && !faceLit ? mix(surfaceLogo,"#18212d",.6) : surfaceLogo;
  const side = sideLit ? mix(config.sideColor, "#ffffff", night?.32:.06)
    : night ? mix(config.sideColor, "#08101c", 0.6) : config.sideColor;
  const logoGeometry = (fill: string, stroke = "none", strokeWidth = 0) => !config.logoEnabled ? "" : config.logoShape === "circle"
    ? '<circle cx="' + n(layout.logoBox.x + layout.logoBox.width / 2) + '" cy="' + n(layout.logoBox.y + layout.logoBox.height / 2) + '" r="' + n(layout.logoBox.width / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />'
    : '<rect x="' + n(layout.logoBox.x) + '" y="' + n(layout.logoBox.y) + '" width="' + n(layout.logoBox.width) + '" height="' + n(layout.logoBox.height) + '" rx="' + (config.logoShape === "rounded" ? n(layout.logoCornerRadius) : 0) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />';
  const textGeometry = (fill: string, stroke = "none", strokeWidth = 0, _measure = false) => {
    if (layout.textRows) return layout.textRows.map(row=>{
      const sx=row.pathBox.width/row.naturalBox.width,sy=row.pathBox.height/row.naturalBox.height;
      const transform=`matrix(${sx} 0 0 ${sy} ${n(row.pathBox.x-row.naturalBox.x*sx)} ${n(row.pathBox.y-row.naturalBox.y*sy)})`;
      const outline=strokeWidth ? Math.max(4,row.box.height*.035) : 0;
      return `<g data-line-index="${row.index}" data-line-font="${escapeXml(row.font)}" transform="${transform}"><path d="${row.pathData}" fill="${fill}" fill-rule="nonzero" stroke="${stroke}" stroke-width="${n(outline/sy)}" stroke-linejoin="round" paint-order="stroke fill" /></g>`;
    }).join("");
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
        '" stroke="#8793a1" stroke-width="1.5" opacity="0.4" />').join("") +
      layout.seamYs.filter((y) => y < layout.panelBox.y + layout.panelBox.height).map((y) =>
        '<line x1="' + n(layout.panelBox.x) + '" x2="' + n(layout.panelBox.x + layout.panelBox.width) +
        '" y1="' + n(y) + '" y2="' + n(y) +
        '" stroke="#8793a1" stroke-width="1.5" opacity="0.4" />').join("") + "</g>"
    : "";
  const frameMarkup = config.mountMode === "frame"
    ? layout.frameSegments ? '<g id="frame-rails" filter="url(#letters-cast-shadow)">' + layout.frameSegments.map(segment=>
      `<rect data-frame-id="${segment.id}" data-frame-kind="${segment.kind}" x="${n(segment.x)}" y="${n(segment.y)}" width="${n(segment.width)}" height="${n(segment.height)}" rx="0" fill="${segment.kind==='rail'?'url(#letters-steel)':night?'#424649':'#606669'}" stroke="${night?'#6e7275':'#82888b'}" stroke-width="0.5" />`).join("")+'</g>'
    : '<g id="frame-rails" filter="url(#letters-cast-shadow)">' +
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
      silhouette(escapeXml(config.haloLightColor ?? config.faceColor)) + "</g>"
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
    '<filter id="logo-face-light" x="-40%" y="-60%" width="180%" height="220%">' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.014) +
    '" flood-color="' + escapeXml(config.logoFaceColor ?? config.faceColor) + '" flood-opacity="' + (night?'0.85':'0.1') + '" />' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.045) +
    '" flood-color="' + escapeXml(config.logoFaceColor ?? config.faceColor) + '" flood-opacity="' + (night?'0.38':'0.035') + '" /></filter>' +
    '<filter id="letters-side-light" x="-40%" y="-60%" width="180%" height="220%">' +
    '<feDropShadow dx="' + n(extrusionX * 0.15) + '" dy="' + n(extrusionY * 0.15) +
    '" stdDeviation="' + n(config.height * 0.035) + '" flood-color="' +
    mix(config.sideColor, "#ffffff", 0.4) + '" flood-opacity="0.72" /></filter>' +
    '<filter id="letters-halo" x="-45%" y="-80%" width="200%" height="260%">' +
    '<feGaussianBlur stdDeviation="' + n(Math.max(10, config.height * 0.055)) + '" /></filter>' +
    "</defs>\n" + panelMarkup + "\n" + frameMarkup + "\n" + (config.haloBackerEnabled && layout.haloBackerPath ? `<path id="halo-contour-backer" d="${layout.haloBackerPath}" fill="${escapeXml(config.haloBackerColor)}" filter="url(#letters-cast-shadow)" />` : "") + haloMarkup + "\n" +
    '<g id="sign-side"' + (sideLit ? ' filter="url(#letters-side-light)"' : ' filter="url(#letters-cast-shadow)"') +
    ">" + sideMarkup + "</g>\n" +
    '<g id="sign-face"' + (faceLit ? ' filter="url(#letters-face-light)"' : "") + ">" +
    textGeometry("url(#letters-face-material)", config.letterOutlineEnabled ? escapeXml(config.outlineColor) : "none", textStrokeWidth, true) +
    '</g><g id="logo-face"' + (faceLit ? ' filter="url(#logo-face-light)"' : "") + ">" +
    logoGeometry(logoFace, config.logoOutlineEnabled ? escapeXml(config.outlineColor) : "none", logoStrokeWidth) + imageMarkup +
    "</g>\n" + (config.showDimensions ? createSvgDimensions(config.mountMode === "acp" ? layout.panelBox : layout.signBox, Math.max(120, Math.min(550, layout.viewHeight * 0.12)), night ? "#dce5e0" : "#1b322b") + createSvgObjectDimensions(layout,config.logoEnabled!==false,night ? "#dce5e0" : "#1b322b") : "") + "</svg>";
}

function createSvgObjectDimensions(layout:LettersSvgLayout,logoEnabled:boolean,color:string){
  const font=Math.max(14,Math.min(40,layout.viewWidth*.012));
  const objects=(layout.textRows??[]).map(row=>({id:row.id,label:`Строка ${row.index+1}`,box:row.box}));
  if(logoEnabled&&layout.logoBox.width>0)objects.push({id:'logo',label:'Логотип',box:layout.logoBox});
  return `<g data-object-dimensions="true" fill="${color}" font-family="Arial,sans-serif" font-size="${roundSvg(font)}">`+objects.map(item=>
    `<text data-object="${item.id}" x="${roundSvg(item.box.x+item.box.width/2)}" y="${roundSvg(item.box.y-font*.7)}" text-anchor="middle">${item.label}: ${Math.round(item.box.width)} × ${Math.round(item.box.height)} мм</text>`).join('')+'</g>';
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
  const moduleCount = Math.ceil(faceWidth / backerLimits(depth).width);
  const unfoldedWidth = faceWidth / moduleCount + (depth + ACP_SECOND_RETURN_MM) * 2;
  const unfoldedHeight = faceHeight + (depth + ACP_SECOND_RETURN_MM) * 2;

  return {
    faceWidth,
    faceHeight,
    depth,
    secondReturn: ACP_SECOND_RETURN_MM,
    unfoldedWidth,
    unfoldedHeight,
    sheetsX: moduleCount,
    sheetsY: Math.max(1, Math.ceil(unfoldedHeight / ACP_SHEET_HEIGHT_MM)),
    sheetCount: moduleCount *
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
