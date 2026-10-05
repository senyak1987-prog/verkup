import { ArrowUpRight, Check, ChevronRight, Download, FolderOpen, ImagePlus, Lightbulb, Maximize, Minus, Moon, Plus, RotateCcw, Save, Settings2, Sun, Type, Upload, X } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { createPanelSvgMarkup } from "../lib/signPanelExport";

type ProductId = "panel" | "letters";
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
  viewWidth: number;
  viewHeight: number;
  logoBox: SvgBox;
  logoCornerRadius: number;
  textX: number;
  textBaseline: number;
  fontSize: number;
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
};

type LettersSvgMarkupConfig = LettersSvgLayoutConfig & {
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
  { id: "acp", label: "На подложке АКП", note: "короб с подворотами" },
];

const FRAME_PROFILES: Array<{ value: FrameProfile; label: string }> = [
  { value: 15, label: "15 x 15" },
  { value: 20, label: "20 x 20" },
];
const LOGO_WIDTH_FACTOR = 0.72;
const LETTER_GAP_FACTOR = 0.16;
const LETTER_TEXT_WIDTH_FACTOR = 0.64;

const LETTER_FONTS: FontOption[] = [
  { label: "Manrope · современный", value: "Manrope, sans-serif" },
  { label: "Roboto Condensed · узкий", value: "\"Roboto Condensed\", sans-serif" },
  { label: "Arial Black", value: "\"Arial Black\", Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Arial Narrow", value: "\"Arial Narrow\", Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "\"Trebuchet MS\", Arial, sans-serif" },
  { label: "Segoe UI", value: "\"Segoe UI\", Arial, sans-serif" },
  { label: "Century Gothic", value: "\"Century Gothic\", Arial, sans-serif" },
  { label: "Franklin Gothic", value: "\"Franklin Gothic Medium\", Arial, sans-serif" },
  { label: "Gill Sans", value: "\"Gill Sans\", \"Trebuchet MS\", sans-serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, sans-serif" },
  { label: "Haettenschweiler", value: "Haettenschweiler, Impact, sans-serif" },
  { label: "Futura", value: "Futura, \"Trebuchet MS\", sans-serif" },
  { label: "Avenir", value: "Avenir, Arial, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Calibri", value: "Calibri, Arial, sans-serif" },
  { label: "Candara", value: "Candara, Calibri, sans-serif" },
  { label: "Corbel", value: "Corbel, Arial, sans-serif" },
  { label: "Optima", value: "Optima, Candara, sans-serif" },
  { label: "Copperplate", value: "Copperplate, \"Copperplate Gothic Light\", serif" },
  { label: "Baskerville", value: "Baskerville, Georgia, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Garamond", value: "Garamond, Georgia, serif" },
  { label: "Palatino", value: "Palatino, \"Palatino Linotype\", serif" },
  { label: "Book Antiqua", value: "\"Book Antiqua\", Palatino, serif" },
  { label: "Didot", value: "Didot, Georgia, serif" },
  { label: "Bodoni 72", value: "\"Bodoni 72\", Didot, serif" },
  { label: "Rockwell", value: "Rockwell, Georgia, serif" },
  { label: "Courier New", value: "\"Courier New\", Courier, monospace" },
  { label: "Consolas", value: "Consolas, \"Courier New\", monospace" },
  { label: "Lucida Console", value: "\"Lucida Console\", Monaco, monospace" },
  { label: "Lucida Sans", value: "\"Lucida Sans\", \"Lucida Grande\", sans-serif" },
  { label: "Lucida Bright", value: "\"Lucida Bright\", Georgia, serif" },
  { label: "Brush Script", value: "\"Brush Script MT\", cursive" },
  { label: "Segoe Script", value: "\"Segoe Script\", \"Brush Script MT\", cursive" },
  { label: "Snell Roundhand", value: "\"Snell Roundhand\", \"Segoe Script\", cursive" },
  { label: "Comic Sans", value: "\"Comic Sans MS\", cursive" },
  { label: "Marker Felt", value: "\"Marker Felt\", \"Comic Sans MS\", cursive" },
  { label: "Papyrus", value: "Papyrus, fantasy" },
  { label: "Bebas Style", value: "\"Bebas Neue\", Impact, sans-serif" },
  { label: "Montserrat Style", value: "Montserrat, \"Segoe UI\", sans-serif" },
  { label: "Oswald Style", value: "Oswald, \"Arial Narrow\", sans-serif" },
  { label: "Roboto Condensed", value: "\"Roboto Condensed\", \"Arial Narrow\", sans-serif" },
  { label: "DIN Style", value: "DIN, \"Arial Narrow\", sans-serif" },
  { label: "Eurostile", value: "Eurostile, \"Arial Black\", sans-serif" },
  { label: "Bank Gothic", value: "\"Bank Gothic\", \"Arial Black\", sans-serif" },
  { label: "Avant Garde", value: "\"Avant Garde\", Century Gothic, sans-serif" },
];

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
const PROJECT_STORAGE_KEY = "verkup-sign-studio-v1";
const DEFAULT_PROJECT = {
  productId: "letters" as ProductId,
  sceneMode: "day" as SceneMode,
  panelShape: "circle" as PanelShape,
  panelSize: 500,
  panelImage: "",
  panelImageScale: 82,
  panelImageX: 0,
  panelImageY: 0,
  panelFaceColor: ORACAL_8500_COLORS[1] as ColorOption,
  panelSideColor: ORACAL_641_COLORS[1] as ColorOption,
  lettersText: "ЦВЕТЫ",
  letterFont: LETTER_FONTS[0].value,
  letterHeight: 410,
  letterDepth: 40,
  letterFaceColor: ORACAL_8500_COLORS[4] as ColorOption,
  letterSideColor: ORACAL_641_COLORS[1] as ColorOption,
  glowMode: "faceHalo" as GlowMode,
  logoShape: "circle" as LogoShape,
  logoImage: "",
  logoScale: 86,
  letterOutlineEnabled: false,
  logoOutlineEnabled: false,
  outlineColor: ORACAL_641_COLORS[1] as ColorOption,
  haloBackerEnabled: true,
  haloBackerColor: ACP_COLORS[0] as ColorOption,
  mountMode: "frame" as MountMode,
  frameProfile: 20 as FrameProfile,
  frameEdgeInset: 0,
  frameTopPosition: 47,
  frameBottomPosition: 24,
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
  "Размещение": "mount", "Рама": "mount", "Подложка АКП": "mount",
  "Логотип": "logo", "Изображение": "logo",
};
const PROJECT_ENUMS: Record<string, readonly unknown[]> = {
  productId: ["panel", "letters"], sceneMode: ["day", "night"],
  panelShape: ["circle", "square", "rounded"], logoShape: ["circle", "square", "rounded"],
  glowMode: ["face", "faceSide", "faceHalo", "halo"], mountMode: ["wall", "frame", "acp"],
  frameProfile: [15, 20], panelSize: PANEL_SIZES, letterFont: LETTER_FONTS.map(item => item.value),
};
const PROJECT_RANGES: Record<string, [number, number]> = {
  panelImageScale: [45, 130], panelImageX: [-40, 40], panelImageY: [-40, 40],
  letterHeight: [120, 1200], letterDepth: [30, 160], logoScale: [45, 130],
  frameEdgeInset: [0, 120], frameTopPosition: [25, 60], frameBottomPosition: [12, 45],
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
    if (PROJECT_ENUMS[key]) {
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
      if (key === "panelImage" || key === "logoImage") {
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
  return result;
}
function loadSavedProject(): ProjectState {
  try {
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY);
    return saved ? validateProject(JSON.parse(saved)) : { ...DEFAULT_PROJECT };
  } catch { return { ...DEFAULT_PROJECT }; }
}

export function SignProductConfigurator() {
  const [project, setProject] = useState<ProjectState>(loadSavedProject);
  const { productId, sceneMode, panelShape, panelSize, panelImage, panelImageScale, panelImageX, panelImageY, panelFaceColor, panelSideColor, lettersText, letterFont, letterHeight, letterDepth, letterFaceColor, letterSideColor, glowMode, logoShape, logoImage, logoScale, letterOutlineEnabled, logoOutlineEnabled, outlineColor, haloBackerEnabled, haloBackerColor, mountMode, frameProfile, frameEdgeInset, frameTopPosition, frameBottomPosition, acpColor, acpWidth, acpHeight, acpDepth } = project;
  const setProductId = (value: ProjectState["productId"]) => setProject(previous => ({ ...previous, productId: value }));
  const setSceneMode = (value: ProjectState["sceneMode"]) => setProject(previous => ({ ...previous, sceneMode: value }));
  const setPanelShape = (value: ProjectState["panelShape"]) => setProject(previous => ({ ...previous, panelShape: value }));
  const setPanelSize = (value: ProjectState["panelSize"]) => setProject(previous => ({ ...previous, panelSize: value }));
  const setPanelImage = (value: ProjectState["panelImage"]) => setProject(previous => ({ ...previous, panelImage: value }));
  const setPanelImageScale = (value: ProjectState["panelImageScale"]) => setProject(previous => ({ ...previous, panelImageScale: value }));
  const setPanelImageX = (value: ProjectState["panelImageX"]) => setProject(previous => ({ ...previous, panelImageX: value }));
  const setPanelImageY = (value: ProjectState["panelImageY"]) => setProject(previous => ({ ...previous, panelImageY: value }));
  const setPanelFaceColor = (value: ProjectState["panelFaceColor"]) => setProject(previous => ({ ...previous, panelFaceColor: value }));
  const setPanelSideColor = (value: ProjectState["panelSideColor"]) => setProject(previous => ({ ...previous, panelSideColor: value }));
  const setLettersText = (value: ProjectState["lettersText"]) => setProject(previous => ({ ...previous, lettersText: value }));
  const setLetterFont = (value: ProjectState["letterFont"]) => setProject(previous => ({ ...previous, letterFont: value }));
  const setLetterHeight = (value: ProjectState["letterHeight"]) => setProject(previous => ({ ...previous, letterHeight: value }));
  const setLetterDepth = (value: ProjectState["letterDepth"]) => setProject(previous => ({ ...previous, letterDepth: value }));
  const setLetterFaceColor = (value: ProjectState["letterFaceColor"]) => setProject(previous => ({ ...previous, letterFaceColor: value }));
  const setLetterSideColor = (value: ProjectState["letterSideColor"]) => setProject(previous => ({ ...previous, letterSideColor: value }));
  const setGlowMode = (value: ProjectState["glowMode"]) => setProject(previous => ({ ...previous, glowMode: value }));
  const setLogoShape = (value: ProjectState["logoShape"]) => setProject(previous => ({ ...previous, logoShape: value }));
  const setLogoImage = (value: ProjectState["logoImage"]) => setProject(previous => ({ ...previous, logoImage: value }));
  const setLogoScale = (value: ProjectState["logoScale"]) => setProject(previous => ({ ...previous, logoScale: value }));
  const setLetterOutlineEnabled = (value: ProjectState["letterOutlineEnabled"]) => setProject(previous => ({ ...previous, letterOutlineEnabled: value }));
  const setLogoOutlineEnabled = (value: ProjectState["logoOutlineEnabled"]) => setProject(previous => ({ ...previous, logoOutlineEnabled: value }));
  const setOutlineColor = (value: ProjectState["outlineColor"]) => setProject(previous => ({ ...previous, outlineColor: value }));
  const setHaloBackerEnabled = (value: ProjectState["haloBackerEnabled"]) => setProject(previous => ({ ...previous, haloBackerEnabled: value }));
  const setHaloBackerColor = (value: ProjectState["haloBackerColor"]) => setProject(previous => ({ ...previous, haloBackerColor: value }));
  const setMountMode = (value: ProjectState["mountMode"]) => setProject(previous => ({ ...previous, mountMode: value }));
  const setFrameProfile = (value: ProjectState["frameProfile"]) => setProject(previous => ({ ...previous, frameProfile: value }));
  const setFrameEdgeInset = (value: ProjectState["frameEdgeInset"]) => setProject(previous => ({ ...previous, frameEdgeInset: value }));
  const setFrameTopPosition = (value: ProjectState["frameTopPosition"]) => setProject(previous => ({ ...previous, frameTopPosition: value }));
  const setFrameBottomPosition = (value: ProjectState["frameBottomPosition"]) => setProject(previous => ({ ...previous, frameBottomPosition: value }));
  const setAcpColor = (value: ProjectState["acpColor"]) => setProject(previous => ({ ...previous, acpColor: value }));
  const setAcpWidth = (value: ProjectState["acpWidth"]) => setProject(previous => ({ ...previous, acpWidth: value }));
  const setAcpHeight = (value: ProjectState["acpHeight"]) => setProject(previous => ({ ...previous, acpHeight: value }));
  const setAcpDepth = (value: ProjectState["acpDepth"]) => setProject(previous => ({ ...previous, acpDepth: value }));
  const [activeSection, setActiveSection] = useState<StudioSection>("design");
  const [zoom, setZoom] = useState(100);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("Сохранено на устройстве");
  const projectFileRef = useRef<HTMLInputElement>(null);
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
  const [letterTextBox, setLetterTextBox] = useState<SvgBox | null>(null);

  useLayoutEffect(() => {
    setLetterTextBox(null);
  }, [letterFont, letterHeight, letterOutlineEnabled, lettersText, logoScale, logoShape]);

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
    logoScale,
    logoShape,
    mountMode,
  ]);
  const measuredLettersWidth = Math.max(1, Math.round(lettersLayout.signBox.width));
  const frameEdgeInsetSafe = Math.max(0, Math.min(120, frameEdgeInset));
  const frameEdgeInsetPercent = Math.min(12, (frameEdgeInsetSafe / Math.max(1, measuredLettersWidth)) * 100);
  const lettersAreaM2 = (measuredLettersWidth * letterHeight) / 1_000_000;
  const glowHasHalo = hasHaloGlow(glowMode);
  const glowLabel = GLOW_MODES.find((item) => item.id === glowMode)?.label || "";
  const mountLabel = MOUNT_MODES.find((item) => item.id === mountMode)?.label || "";

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
    downloadTextFile(`verkup-${productId === "letters" ? lettersText || "вывеска" : "панель"}.json`, JSON.stringify({ version: 1, project }, null, 2), "application/json");
    setNotice("Проект скачан. Его можно открыть здесь на любом устройстве.");
  }
  async function handleOpenProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 6_500_000) throw new Error("Файл проекта слишком большой.");
      const nextProject = validateProject(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
      try {
        await Promise.all([nextProject.panelImage, nextProject.logoImage].filter(Boolean).map(async source => {
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
  function handleExportVector() {
    if (productId === "panel") {
      downloadTextFile(`verkup-panel-${panelSize}.svg`, createPanelSvgMarkup({ shape: panelShape, size: panelSize, faceColor: panelFaceColor.value, sideColor: panelSideColor.value, image: panelImage, imageScale: panelImageScale, imageX: panelImageX, imageY: panelImageY, sceneMode }), "image/svg+xml;charset=utf-8");
      setNotice("SVG панели скачан.");
      return;
    }
    const svg = createLettersSvgMarkup({
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
      haloBackerEnabled: glowHasHalo && haloBackerEnabled && mountMode !== "frame",
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

    downloadTextFile(`verkup-sign-${Date.now()}.svg`, svg, "image/svg+xml;charset=utf-8");
    setNotice("SVG макета скачан. Текст сохранен как текст, шрифты должны быть установлены у получателя.");
  }

  return (
    <main className="public-sign-configurator sign-studio" style={visualStyle}>
      <a className="studio-skip" href="#studio-controls">К настройкам вывески</a>
      <header className="studio-header">
        <a className="studio-brand" href="./" aria-label="Веркуп — студия вывесок">
          <img className="studio-brand-mark" src={`${import.meta.env.BASE_URL}verkup-app-icon-v4-mark.svg`} alt="" />
          <span>ВЕРКУП<small>Студия вывесок</small></span>
        </a>
        <div className="studio-header-meta"><Check size={14} /><span role="status">{saveStatus}</span></div>
        <div className="studio-actions">
          <input hidden ref={projectFileRef} type="file" accept=".json,application/json" onChange={event => void handleOpenProject(event)} />
          <button className="studio-button" type="button" onClick={() => projectFileRef.current?.click()}><FolderOpen size={16} /><span>Открыть</span></button>
          <button className="studio-button" type="button" onClick={handleSaveProject}><Save size={16} /><span>Сохранить проект</span></button>
          <button className="studio-button primary" type="button" onClick={handleExportVector}><Download size={16} /><span>Скачать SVG</span></button>
        </div>
      </header>
      {notice && <div className="studio-notice" role="status"><span>{notice}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={16} /></button></div>}
      <div className="studio-heading"><div><h1>Ваша вывеска. В деталях.</h1><p>Соберите макет и посмотрите, как он будет выглядеть днем и ночью.</p></div><span>Конструктор вывесок<ArrowUpRight size={16} /></span></div>
      <section className="product-tabs" aria-label="Тип вывески">
        {[...PRODUCTS].reverse().map(product => <button type="button" key={product.id} aria-pressed={productId === product.id} className={productId === product.id ? "active" : ""} onClick={() => { setProductId(product.id); setActiveSection("design"); setZoom(100); }}>
          {product.id === "letters" ? <Type size={24} /> : <Maximize size={24} />}
          <div><strong>{product.id === "letters" ? "Объемные буквы" : "Панель-кронштейн"}</strong><span>{product.id === "letters" ? "Надпись и логотип на вашем фасаде" : "Двусторонняя вывеска на кронштейне"}</span></div><Check className="product-check" size={18} />
        </button>)}
      </section>
      <section className="sign-builder-layout">
        <aside className="builder-controls" id="studio-controls" aria-label="Настройки вывески">
          <header className="controls-heading"><h2>Настройте вывеску</h2><span>Все изменения — на макете</span></header>
          <nav className="studio-section-tabs" aria-label="Разделы настроек">
            {SECTION_ITEMS.filter(item => productId === "letters" || ["design", "colors", "logo"].includes(item.id)).map(item => <button type="button" key={item.id} aria-pressed={activeSection === item.id} className={activeSection === item.id ? "active" : ""} onClick={() => setActiveSection(item.id)}><item.icon size={18} /><span>{productId === "panel" && item.id === "design" ? "Форма" : item.label}</span></button>)}
          </nav>
          <div className="controls-body"><SectionContext.Provider value={activeSection}>
          {productId === "panel" ? (
            <PanelControls
              faceColor={panelFaceColor}
              imageScale={panelImageScale}
              imageX={panelImageX}
              imageY={panelImageY}
              panelImage={panelImage}
              shape={panelShape}
              sideColor={panelSideColor}
              size={panelSize}
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
              onFrameProfileChange={setFrameProfile}
              onFrameTopPositionChange={setFrameTopPosition}
              onGlowModeChange={setGlowMode}
              onHaloBackerColorChange={setHaloBackerColor}
              onHaloBackerEnabledChange={setHaloBackerEnabled}
              onHeightChange={setLetterHeight}
              onLetterOutlineEnabledChange={setLetterOutlineEnabled}
              onLogoChange={(event) => void handleImageUpload(event, setLogoImage)}
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
          {activeSection === "logo" && (productId === "letters" ? logoImage : panelImage) && <button className="studio-remove" type="button" onClick={() => productId === "letters" ? setLogoImage("") : setPanelImage("")}><X size={14} />Удалить изображение</button>}
          {productId === "panel" && activeSection === "design" && <p className="control-note">Размер — диаметр круга или сторона квадрата, в миллиметрах.</p>}
          {productId === "letters" && activeSection === "mount" && mountMode === "acp" && (measuredLettersWidth > acpWidth || letterHeight > acpHeight) && <p className="studio-fit-warning" role="status">Надпись выходит за подложку. Увеличьте АКП минимум до {measuredLettersWidth} × {letterHeight} мм или уменьшите высоту букв.</p>}
          </div>
          <details className="studio-help"><summary>Как пользоваться студией<ChevronRight size={14} /></summary><p>Выберите тип вывески и настройте параметры по разделам. Переключайте день и ночь, чтобы оценить свечение. Проект сохраняется в этом браузере. Скачайте JSON для переноса на другое устройство.</p><p>Макет дает представление о конструкции. Цвета на экране могут отличаться от физических образцов Oracal; производственную документацию нужно подготовить отдельно.</p></details>
        </aside>
        <section className="studio-workspace" aria-label="Рабочий макет">
          <header className="canvas-toolbar"><div className="canvas-title"><strong>Предпросмотр</strong><span>{sceneMode === "day" ? "Дневное освещение" : "Ночное освещение"}</span></div>
            <div className="scene-switch" role="group" aria-label="Режим визуализации">
              <button type="button" aria-pressed={sceneMode === "day"} className={sceneMode === "day" ? "active" : ""} onClick={() => setSceneMode("day")}><Sun size={16} />День</button>
              <button type="button" aria-pressed={sceneMode === "night"} className={sceneMode === "night" ? "active" : ""} onClick={() => setSceneMode("night")}><Moon size={16} />Ночь</button>
            </div><div className="canvas-tools"><button type="button" aria-label="Уменьшить макет" disabled={zoom <= 60} onClick={() => setZoom(value => Math.max(60, value - 10))}><Minus size={16} /></button><span className="zoom-value">{zoom}%</span><button type="button" aria-label="Увеличить макет" disabled={zoom >= 140} onClick={() => setZoom(value => Math.min(140, value + 10))}><Plus size={16} /></button><button type="button" aria-label="Подогнать макет" onClick={() => setZoom(100)}><Maximize size={16} /></button></div>
          </header>
        <section
          className={`builder-preview ${sceneMode} glow-${glowMode}`}
          aria-label="Визуализация"
        >
          <div className="preview-wall"><div className="preview-art" style={{ "--preview-zoom": zoom / 100 } as CSSProperties}>
            {productId === "panel" ? (
              <PanelPreview
                image={panelImage}
                shape={panelShape}
                sideColor={panelSideColor.value}
                faceColor={panelFaceColor.value}
                imageScale={panelImageScale}
                imageX={panelImageX}
                imageY={panelImageY}
                sceneMode={sceneMode}
                size={panelSize}
              />
            ) : (
              <LettersPreview
                sceneMode={sceneMode}
                acpDepth={acpDepth}
                acpColor={acpColor.value}
                depth={letterDepth}
                faceColor={letterFaceColor.value}
                font={letterFont}
                frameProfile={frameProfile}
                glowMode={glowMode}
                haloBackerColor={haloBackerColor.value}
                haloBackerEnabled={glowHasHalo && haloBackerEnabled && mountMode !== "frame"}
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
                textBox={letterTextBox}
                onTextBoxChange={setLetterTextBox}
              />
            )}
          </div></div>
          <div className="canvas-dimensions"><span className="dimension-line" /><span>{productId === "panel" ? `${panelSize} × ${panelSize}` : mountMode === "acp" ? `${acpWidth} × ${acpHeight}` : `${measuredLettersWidth} × ${letterHeight}`} мм</span><span className="dimension-line" /></div>
        </section>
          <footer className="canvas-footer"><span><span className={`material-dot ${sceneMode}`} />{productId === "letters" ? `${letterDepth} мм — глубина букв` : "Лицевое свечение"}</span><button type="button" onClick={() => setZoom(100)}><RotateCcw size={13} />Масштаб по размеру окна</button></footer>
        </section>

        <aside className="builder-summary" aria-label="Структура проекта"><header className="summary-heading"><h2>Ваш проект</h2><p>Параметры конструкции</p></header>
          <div className="summary-block">
            <span>Продукт</span>
            <strong>{activeProduct.title}</strong>
          </div>
          <div className="summary-block">
            <span>Габарит</span>
            <strong>
              {productId === "panel"
                ? `${panelSize} x ${panelSize} мм`
                : mountMode === "acp"
                  ? `${acpWidth} x ${acpHeight} x ${acpDepth} мм`
                  : `${measuredLettersWidth} x ${letterHeight} мм`}
            </strong>
          </div>
          <div className="summary-block">
            <span>Свечение</span>
            <strong>{productId === "letters" ? glowLabel : "Лицевое"}</strong>
          </div>
          <div className="summary-block">
            <span>Монтаж</span>
            <strong>
              {productId === "letters"
                ? mountMode === "frame"
                  ? `${mountLabel}, профиль ${frameProfile} x ${frameProfile}`
                  : mountLabel
                : "Кронштейн"}
            </strong>
          </div>
          <div className="summary-block">
            <span>Лицевая пленка</span>
            <strong>{currentFaceColor.code} {currentFaceColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>Борт</span>
            <strong>{currentSideColor.code} {currentSideColor.name}</strong>
          </div>
          <div className="summary-block">
            <span>{productId === "letters" ? "Габаритная площадь" : "Площадь лица"}</span>
            <strong>{formatArea(productId === "panel" ? panelAreaM2 : lettersAreaM2)} м²</strong>
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
          {productId === "letters" && mountMode === "acp" && (
            <AcpLayoutCard layout={acpLayout} />
          )}
          <div className="summary-block muted"><span>Расчет стоимости</span><strong>Требует оценки материалов и монтажа</strong></div>
        </aside>
      </section>
    </main>
  );
}

function PanelControls({
  faceColor,
  imageScale,
  imageX,
  imageY,
  panelImage,
  shape,
  sideColor,
  size,
  onFaceColorChange,
  onImageChange,
  onImageScaleChange,
  onImageXChange,
  onImageYChange,
  onShapeChange,
  onSideColorChange,
  onSizeChange,
}: {
  faceColor: ColorOption;
  imageScale: number;
  imageX: number;
  imageY: number;
  panelImage: string;
  shape: PanelShape;
  sideColor: ColorOption;
  size: number;
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
      </ControlSection>

      <ControlSection title="Размер">
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

      <ControlSection title="Изображение">
        <label className="public-upload">
          <Upload size={17} />
          {panelImage ? "Заменить изображение" : "Загрузить изображение"}
          <input accept="image/png,image/jpeg,image/webp" onChange={onImageChange} type="file" />
        </label>
        <small className="control-note">PNG, JPG или WebP · до 2 МБ</small>
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
  onFrameProfileChange,
  onFrameTopPositionChange,
  onGlowModeChange,
  onHaloBackerColorChange,
  onHaloBackerEnabledChange,
  onHeightChange,
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
  onFrameProfileChange: (value: FrameProfile) => void;
  onFrameTopPositionChange: (value: number) => void;
  onGlowModeChange: (mode: GlowMode) => void;
  onHaloBackerColorChange: (color: ColorOption) => void;
  onHaloBackerEnabledChange: (value: boolean) => void;
  onHeightChange: (value: number) => void;
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
              <option key={fontOption.label} value={fontOption.value}>
                {fontOption.label}
              </option>
            ))}
          </select>
          <small className="control-note">Manrope и Roboto Condensed встроены. Остальные шрифты зависят от устройства.</small>
        </label>
        <RangeField label="Высота букв, мм" max={1200} min={120} onChange={onHeightChange} step={10} value={height} />
        <RangeField label="Глубина борта, мм" max={160} min={30} onChange={onDepthChange} step={5} value={depth} />
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
          <div className="option-grid two">
            {FRAME_PROFILES.map((profile) => (
              <button
                aria-pressed={frameProfile === profile.value} className={frameProfile === profile.value ? "active" : ""}
                key={profile.value}
                onClick={() => onFrameProfileChange(profile.value)}
                type="button"
              >
                Профиль {profile.label}
              </button>
            ))}
          </div>
          <RangeField label="Отступ рамы от края, мм" max={120} min={0} onChange={onFrameEdgeInsetChange} step={5} value={frameEdgeInset} />
          <RangeField label="Верхняя труба, % высоты" max={60} min={25} onChange={onFrameTopPositionChange} value={frameTopPosition} />
          <RangeField label="Нижняя труба от низа, %" max={45} min={12} onChange={onFrameBottomPositionChange} value={frameBottomPosition} />
          <small className="control-note">Две горизонтальные трубы за буквами, в пределах габарита вывески.</small>
        </ControlSection>
      )}

      {mountMode === "acp" && (
        <ControlSection title="Подложка АКП">
          <div className="sign-size-grid">
            <NumberField label="Ширина, мм" min={400} onChange={onAcpWidthChange} value={acpWidth} />
            <NumberField label="Высота, мм" min={250} onChange={onAcpHeightChange} value={acpHeight} />
          </div>
          <RangeField label="Глубина подложки, мм" max={100} min={30} onChange={onAcpDepthChange} step={5} value={acpDepth} />
          <small className="control-note">В развертке учитывается второй подворот 25 мм.</small>
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
        <div className="option-grid three">
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
        </div>
        <label className="public-upload">
          <Upload size={17} />
          {logoImage ? "Заменить логотип" : "Загрузить логотип"}
          <input accept="image/png,image/jpeg,image/webp" onChange={onLogoChange} type="file" />
        </label>
        <small className="control-note">PNG, JPG или WebP · до 2 МБ</small>
        <RangeField label="Масштаб логотипа" max={130} min={45} onChange={onLogoScaleChange} value={logoScale} />
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
  image,
  shape,
  sideColor,
  faceColor,
  imageScale,
  imageX,
  imageY,
  sceneMode,
  size,
}: {
  image: string;
  shape: PanelShape;
  sideColor: string;
  faceColor: string;
  imageScale: number;
  imageX: number;
  imageY: number;
  sceneMode: SceneMode;
  size: number;
}) {
  const markup = createPanelSvgMarkup({ image, shape, sideColor, faceColor, imageScale, imageX, imageY, sceneMode, size });
  return <div className="panel-svg-render" dangerouslySetInnerHTML={{ __html: markup.replace(/<\?xml[^>]*\?>\s*/, "") }} />;
}

function LettersPreview({
  acpColor,
  acpDepth,
  depth,
  faceColor,
  font,
  frameProfile,
  glowMode,
  haloBackerColor,
  haloBackerEnabled,
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
  textBox,
  onTextBoxChange,
}: {
  acpColor: string;
  acpDepth?: number;
  depth: number;
  faceColor: string;
  font: string;
  frameProfile: FrameProfile;
  glowMode: GlowMode;
  haloBackerColor: string;
  haloBackerEnabled: boolean;
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
  textBox: SvgBox | null;
  onTextBoxChange: (box: SvgBox) => void;
}) {
  const svgRef = useRef<HTMLDivElement>(null);
  const label = text.trim() || "Вывеска";
  const svg = createLettersSvgMarkup({
    acpColor, acpDepth, depth, faceColor, font, glowMode, haloBackerColor,
    haloBackerEnabled, height, layout, letterOutlineEnabled,
    logoImage, logoOutlineEnabled, logoShape, mountMode, outlineColor,
    sceneMode, sideColor, text,
  }).replace(/^<\?xml[^>]*\?>\s*/, "");

  useLayoutEffect(() => {
    let active = true;
    let latestBox = textBox;
    const measure = () => {
      const node = svgRef.current?.querySelector<SVGTextElement>("[data-letter-measure]");
      if (!active || !node) return;
      const nextBox = normalizeSvgBox(node.getBBox());
      if (!areSvgBoxesClose(nextBox, latestBox)) {
        latestBox = nextBox;
        onTextBoxChange(nextBox);
      }
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      active = false;
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [
    font, label, layout.fontSize, layout.textBaseline, layout.textX,
    letterOutlineEnabled, onTextBoxChange, textBox,
  ]);

  return (
    <div className={"letters-scene mount-" + mountMode + (haloBackerEnabled ? " with-halo-backer" : "")}>
      <div
        className="letters-svg-render"
        dangerouslySetInnerHTML={{ __html: svg }}
        ref={svgRef}
      />
      <div className="preview-dimension">
        h {height} мм · борт {depth} мм
        {mountMode === "frame" ? " · профиль " + frameProfile + "x" + frameProfile + " · рама " + Math.round(layout.railWidth) + " мм" : ""}
      </div>
    </div>
  );
}

function AcpPreviewPanel({ layout }: { layout: AcpLayout }) {
  return (
    <div className="acp-preview-panel" aria-hidden="true">
      {Array.from({ length: Math.max(0, layout.sheetsX - 1) }).map((_, index) => (
        <i
          className="acp-preview-seam vertical"
          key={`x-${index}`}
          style={{ left: `${((index + 1) * ACP_SHEET_WIDTH_MM / layout.faceWidth) * 100}%` }}
        />
      ))}
      {Array.from({ length: Math.max(0, layout.sheetsY - 1) }).map((_, index) => (
        <i
          className="acp-preview-seam horizontal"
          key={`y-${index}`}
          style={{ top: `${((index + 1) * ACP_SHEET_HEIGHT_MM / layout.faceHeight) * 100}%` }}
        />
      ))}
    </div>
  );
}

function AcpLayoutCard({ layout }: { layout: AcpLayout }) {
  const secondX = (layout.secondReturn / layout.unfoldedWidth) * 100;
  const secondY = (layout.secondReturn / layout.unfoldedHeight) * 100;
  const faceX = ((layout.secondReturn + layout.depth) / layout.unfoldedWidth) * 100;
  const faceY = ((layout.secondReturn + layout.depth) / layout.unfoldedHeight) * 100;
  const faceW = (layout.faceWidth / layout.unfoldedWidth) * 100;
  const faceH = (layout.faceHeight / layout.unfoldedHeight) * 100;
  const faceRight = faceX + faceW;
  const faceBottom = faceY + faceH;

  return (
    <div className="summary-block acp-layout-summary">
      <span>Раскладка АКП 1.5 x 4 м</span>
      <strong>
        {layout.sheetCount} {pluralizeSheet(layout.sheetCount)} · развертка {layout.unfoldedWidth} x {layout.unfoldedHeight} мм
      </strong>
      <div className="acp-layout-diagram" style={{ aspectRatio: `${layout.unfoldedWidth} / ${layout.unfoldedHeight}` }}>
        <div className="acp-layout-face" style={rectStyle(faceX, faceY, faceW, faceH)}>
          {layout.faceWidth} x {layout.faceHeight}
        </div>
        <i className="acp-line red vertical" style={{ left: `${faceX}%` }} />
        <i className="acp-line red vertical" style={{ left: `${faceRight}%` }} />
        <i className="acp-line red horizontal" style={{ top: `${faceY}%` }} />
        <i className="acp-line red horizontal" style={{ top: `${faceBottom}%` }} />
        <i className="acp-line gray vertical" style={{ left: `${secondX}%` }} />
        <i className="acp-line gray vertical" style={{ right: `${secondX}%` }} />
        <i className="acp-line gray horizontal" style={{ top: `${secondY}%` }} />
        <i className="acp-line gray horizontal" style={{ bottom: `${secondY}%` }} />
        {Array.from({ length: Math.max(0, layout.sheetsX - 1) }).map((_, index) => (
          <i
            className="acp-line seam vertical"
            key={`layout-x-${index}`}
            style={{ left: `${((index + 1) * ACP_SHEET_WIDTH_MM / layout.unfoldedWidth) * 100}%` }}
          />
        ))}
        {Array.from({ length: Math.max(0, layout.sheetsY - 1) }).map((_, index) => (
          <i
            className="acp-line seam horizontal"
            key={`layout-y-${index}`}
            style={{ top: `${((index + 1) * ACP_SHEET_HEIGHT_MM / layout.unfoldedHeight) * 100}%` }}
          />
        ))}
        <b className="acp-corner top-left" />
        <b className="acp-corner top-right" />
        <b className="acp-corner bottom-left" />
        <b className="acp-corner bottom-right" />
      </div>
      <em>
        Глубина {layout.depth} мм, второй подворот {layout.secondReturn} мм
        {layout.sheetCount === 1 ? ", стыков нет" : ", стыки показаны пунктиром"}
      </em>
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
  value,
  onChange,
}: {
  label: string;
  min: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const max = label.startsWith("Ширина") ? 20000 : 10000;
  return (
    <label className="builder-field">
      <span>{label}</span>
      <input
        min={min}
        max={max}
        type="number"
        value={value}
        onChange={(event) => onChange(Math.min(max, readPositiveInteger(event.target.value, value, min)))}
      />
    </label>
  );
}

function createLettersSvgLayout(config: LettersSvgLayoutConfig): LettersSvgLayout {
  const normalizedHeight = clamp(config.height, 120, 1200);
  const margin = Math.max(80, normalizedHeight * 0.26);
  const logoSize = clamp(
    normalizedHeight * (config.logoScale / 100),
    normalizedHeight * 0.5,
    normalizedHeight * 1.16,
  );
  const gap = normalizedHeight * LETTER_GAP_FACTOR;
  const fontSize = normalizedHeight * 1.03;
  const label = config.text.trim() || "Вывеска";
  const estimatedTextWidth = Math.max(
    normalizedHeight * 0.9,
    label.length * normalizedHeight * LETTER_TEXT_WIDTH_FACTOR,
  );
  const estimatedContentWidth = Math.max(config.estimatedWidth, logoSize + gap + estimatedTextWidth);
  const panelRequired = config.mountMode === "acp";
  const baseWidth = panelRequired
    ? Math.max(config.acpLayout.faceWidth, estimatedContentWidth)
    : estimatedContentWidth;
  const baseHeight = panelRequired
    ? Math.max(config.acpLayout.faceHeight, normalizedHeight * 1.3)
    : normalizedHeight * 1.32;
  const initialViewWidth = Math.max(720, baseWidth + margin * 2);
  const initialViewHeight = Math.max(360, baseHeight + margin * 2);
  const panelBox = {
    height: config.acpLayout.faceHeight,
    width: config.acpLayout.faceWidth,
    x: margin,
    y: (initialViewHeight - config.acpLayout.faceHeight) / 2,
  };
  const contentX = panelRequired
    ? panelBox.x + Math.max(0, (panelBox.width - estimatedContentWidth) / 2)
    : margin;
  const logoBox = {
    height: logoSize,
    width: logoSize,
    x: contentX,
    y: panelRequired
      ? panelBox.y + Math.max(0, (panelBox.height - logoSize) / 2)
      : (initialViewHeight - logoSize) / 2,
  };
  const textX = logoBox.x + logoBox.width + gap;
  const textBaseline = logoBox.y + logoBox.height * 0.76;
  const fallbackTextBox = {
    height: logoBox.height * 0.76,
    width: estimatedTextWidth,
    x: textX,
    y: logoBox.y + logoBox.height * 0.12,
  };
  const measuredTextBox = config.textBox || fallbackTextBox;
  const outlinePadding = config.letterOutlineEnabled ? Math.max(4, normalizedHeight * 0.035) : 0;
  const paddedTextBox = {
    height: measuredTextBox.height + outlinePadding * 2,
    width: measuredTextBox.width + outlinePadding * 2,
    x: measuredTextBox.x - outlinePadding,
    y: measuredTextBox.y - outlinePadding,
  };
  const signBox = unionSvgBoxes(logoBox, paddedTextBox);
  const railHeight = config.frameProfile;
  const railTopPercent = clamp(config.frameTopPosition, 6, 92) / 100;
  const railBottomPercent = 1 - clamp(config.frameBottomPosition, 6, 92) / 100;
  let railTopY = signBox.y + signBox.height * railTopPercent;
  let railBottomY = signBox.y + signBox.height * railBottomPercent;

  if (railBottomY < railTopY) {
    [railTopY, railBottomY] = [railBottomY, railTopY];
  }

  const minRailGap = railHeight * 3.2;
  if (railBottomY - railTopY < minRailGap) {
    const centerY = (railTopY + railBottomY) / 2;
    railTopY = centerY - minRailGap / 2;
    railBottomY = centerY + minRailGap / 2;
  }

  const railShapeAwareLeft = config.logoShape === "circle"
    ? Math.max(getLogoRailLeft(logoBox, railTopY), getLogoRailLeft(logoBox, railBottomY))
    : signBox.x;
  const frameInset = clamp(Math.max(config.frameEdgeInset, railHeight * 0.45), 0, signBox.width * 0.38);
  const railX = railShapeAwareLeft + frameInset;
  const railRight = signBox.x + signBox.width - frameInset;
  const railWidth = Math.max(railHeight * 2, railRight - railX);

  const haloPaddingX = normalizedHeight * 0.16;
  const haloPaddingY = normalizedHeight * 0.11;
  const haloBackerBox = {
    height: signBox.height + haloPaddingY * 2,
    width: signBox.width + haloPaddingX * 2,
    x: signBox.x - haloPaddingX,
    y: signBox.y - haloPaddingY,
  };
  const requiredRight = Math.max(
    initialViewWidth,
    signBox.x + signBox.width + margin,
    haloBackerBox.x + haloBackerBox.width + margin,
  );
  const requiredBottom = Math.max(
    initialViewHeight,
    signBox.y + signBox.height + margin,
    haloBackerBox.y + haloBackerBox.height + margin,
  );

  return {
    fontSize,
    haloBackerBox,
    haloBackerRadius: Math.min(normalizedHeight * 0.28, haloBackerBox.height / 2),
    logoBox,
    logoCornerRadius: logoSize * 0.16,
    panelBox,
    panelCornerRadius: Math.min(70, config.acpLayout.faceHeight * 0.08),
    railBottomY,
    railHeight,
    railTopY,
    railWidth,
    railX,
    seamXs: Array.from({ length: Math.max(0, config.acpLayout.sheetsX - 1) }, (_, index) =>
      panelBox.x + ((index + 1) * ACP_SHEET_WIDTH_MM / config.acpLayout.faceWidth) * panelBox.width,
    ),
    seamYs: Array.from({ length: Math.max(0, config.acpLayout.sheetsY - 1) }, (_, index) =>
      panelBox.y + ((index + 1) * ACP_SHEET_HEIGHT_MM / config.acpLayout.faceHeight) * panelBox.height,
    ),
    signBox,
    textBaseline,
    textX,
    viewHeight: requiredBottom,
    viewWidth: requiredRight,
  };
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
  const faceLit = night && config.glowMode !== "halo";
  const sideLit = night && config.glowMode === "faceSide";
  const haloLit = night && hasHaloGlow(config.glowMode);
  const n = roundSvg;
  const label = escapeXml(config.text.trim() || "Вывеска");
  const textStrokeWidth = config.letterOutlineEnabled ? Math.max(5, config.height * 0.035) : 0;
  const logoStrokeWidth = config.logoOutlineEnabled ? Math.max(6, config.height * 0.035) : 0;
  const extrusionX = Math.max(6, config.depth * 0.42);
  const extrusionY = Math.max(4, config.depth * 0.28);
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
  const face = night && !faceLit ? mix(config.faceColor, "#08101c", 0.83) : config.faceColor;
  const side = sideLit ? mix(config.sideColor, "#ffffff", 0.32)
    : night ? mix(config.sideColor, "#08101c", 0.6) : config.sideColor;
  const logoGeometry = (fill: string, stroke = "none", strokeWidth = 0) => config.logoShape === "circle"
    ? '<circle cx="' + n(layout.logoBox.x + layout.logoBox.width / 2) + '" cy="' + n(layout.logoBox.y + layout.logoBox.height / 2) + '" r="' + n(layout.logoBox.width / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />'
    : '<rect x="' + n(layout.logoBox.x) + '" y="' + n(layout.logoBox.y) + '" width="' + n(layout.logoBox.width) + '" height="' + n(layout.logoBox.height) + '" rx="' + (config.logoShape === "rounded" ? n(layout.logoCornerRadius) : 0) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + n(strokeWidth) + '" />';
  const textGeometry = (fill: string, stroke = "none", strokeWidth = 0, measure = false) =>
    '<text' + (measure ? ' data-letter-measure="true"' : "") +
    ' x="' + n(layout.textX) + '" y="' + n(layout.textBaseline) + '" font-family="' +
    escapeXml(config.font) + '" font-size="' + n(layout.fontSize) +
    '" font-weight="900" fill="' + fill + '" stroke="' + stroke +
    '" stroke-width="' + n(strokeWidth) +
    '" stroke-linejoin="round" paint-order="stroke fill">' + label + "</text>";
  const silhouette = (fill: string) => logoGeometry(fill) + textGeometry(fill);
  const steps = Math.max(5, Math.min(12, Math.ceil(config.depth / 12)));
  const sideMarkup = Array.from({ length: steps }, (_, index) => {
    const ratio = (steps - index) / steps;
    const layerColor = sideLit ? side : mix(side, "#02060c", ratio * 0.3);
    return '<g transform="translate(' + n(extrusionX * ratio) + " " +
      n(extrusionY * ratio) + ')" fill="' + layerColor + '">' + silhouette(layerColor) + "</g>";
  }).join("\n");
  const imageMarkup = config.logoImage
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
      '<rect x="' + n(layout.panelBox.x + panelDepth * 0.35) + '" y="' +
      n(layout.panelBox.y + panelDepth * 0.22) + '" width="' + n(layout.panelBox.width) +
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
        '" height="' + n(layout.railHeight) + '" rx="1.5" fill="url(#letters-steel)" />' +
        '<line x1="' + n(layout.railX + layout.railHeight * 0.25) + '" x2="' +
        n(layout.railX + layout.railWidth - layout.railHeight * 0.25) + '" y1="' +
        n(railY - layout.railHeight * 0.25) + '" y2="' + n(railY - layout.railHeight * 0.25) +
        '" stroke="' + (night ? "#8896a7" : "#e1e5e9") + '" opacity="0.55" stroke-width="1.5" /></g>',
      ).join("") + "</g>"
    : "";
  const haloMarkup = haloLit
    ? '<g id="sign-halo" transform="translate(' + n(extrusionX * 0.8) + " " +
      n(extrusionY * 0.8) + ')" filter="url(#letters-halo)" opacity="0.78">' +
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
    '<stop offset="0" stop-color="' + mix(face, "#ffffff", faceLit ? 0.2 : 0.07) +
    '" /><stop offset="0.52" stop-color="' + face + '" /><stop offset="1" stop-color="' +
    mix(face, "#02060c", faceLit ? 0.03 : 0.12) + '" /></linearGradient>' +
    '<linearGradient id="letters-acp-material" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + (night ? mix(config.acpColor, "#091524", 0.62) : mix(config.acpColor, "#ffffff", 0.12)) +
    '" /><stop offset="1" stop-color="' + mix(config.acpColor, "#091524", night ? 0.79 : 0.12) + '" /></linearGradient>' +
    '<linearGradient id="letters-steel" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + (night ? "#516173" : "#a1aab2") + '" />' +
    '<stop offset="0.5" stop-color="' + (night ? "#263440" : "#6c7782") + '" />' +
    '<stop offset="1" stop-color="' + (night ? "#0c1722" : "#44515d") + '" /></linearGradient>' +
    '<filter id="letters-cast-shadow" x="-25%" y="-40%" width="160%" height="200%">' +
    '<feDropShadow dx="' + n(extrusionX * 0.42) + '" dy="' + n(extrusionY * 0.7) +
    '" stdDeviation="' + n(Math.max(3, config.depth * 0.12)) +
    '" flood-color="#020711" flood-opacity="' + (night ? "0.5" : "0.23") + '" /></filter>' +
    '<filter id="letters-face-light" x="-40%" y="-60%" width="180%" height="220%">' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.014) +
    '" flood-color="' + escapeXml(config.faceColor) + '" flood-opacity="0.85" />' +
    '<feDropShadow dx="0" dy="0" stdDeviation="' + n(config.height * 0.045) +
    '" flood-color="' + escapeXml(config.faceColor) + '" flood-opacity="0.38" /></filter>' +
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
    "</g>\n</svg>";
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

function pluralizeSheet(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return "лист";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return "листа";
  return "листов";
}
