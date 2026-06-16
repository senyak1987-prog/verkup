import { Moon, Sun, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";

type ProductId = "panel" | "letters";
type SceneMode = "day" | "night";
type PanelShape = "circle" | "square" | "rounded";
type LogoShape = "circle" | "square" | "rounded";

type ColorOption = {
  code: string;
  name: string;
  value: string;
};

type FontOption = {
  label: string;
  value: string;
};

const PANEL_SIZES = Array.from({ length: 7 }, (_, index) => 400 + index * 50);

const PRODUCTS: Array<{ id: ProductId; title: string; note: string }> = [
  {
    id: "panel",
    title: "Панель-кронштейн",
    note: "Круг, квадрат или квадрат со скруглением",
  },
  {
    id: "letters",
    title: "Объемные световые буквы",
    note: "Текст, логотип, лицо и борта",
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

const LETTER_FONTS: FontOption[] = [
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

export function SignProductConfigurator() {
  const [productId, setProductId] = useState<ProductId>("panel");
  const [sceneMode, setSceneMode] = useState<SceneMode>("day");
  const [panelShape, setPanelShape] = useState<PanelShape>("circle");
  const [panelSize, setPanelSize] = useState(500);
  const [panelImage, setPanelImage] = useState("");
  const [panelImageScale, setPanelImageScale] = useState(82);
  const [panelImageX, setPanelImageX] = useState(0);
  const [panelImageY, setPanelImageY] = useState(0);
  const [panelFaceColor, setPanelFaceColor] = useState<ColorOption>(ORACAL_8500_COLORS[1]);
  const [panelSideColor, setPanelSideColor] = useState<ColorOption>(ORACAL_641_COLORS[1]);
  const [lettersText, setLettersText] = useState("ЦВЕТЫ");
  const [letterFont, setLetterFont] = useState(LETTER_FONTS[0].value);
  const [letterHeight, setLetterHeight] = useState(420);
  const [letterDepth, setLetterDepth] = useState(80);
  const [letterFaceColor, setLetterFaceColor] = useState<ColorOption>(ORACAL_8500_COLORS[4]);
  const [letterSideColor, setLetterSideColor] = useState<ColorOption>(ORACAL_641_COLORS[1]);
  const [logoShape, setLogoShape] = useState<LogoShape>("rounded");
  const [logoImage, setLogoImage] = useState("");
  const [logoScale, setLogoScale] = useState(86);

  const activeProduct = PRODUCTS.find((product) => product.id === productId) || PRODUCTS[0];
  const currentFaceColor = productId === "panel" ? panelFaceColor : letterFaceColor;
  const currentSideColor = productId === "panel" ? panelSideColor : letterSideColor;
  const panelAreaM2 =
    panelShape === "circle"
      ? (Math.PI * (panelSize / 2) ** 2) / 1_000_000
      : (panelSize * panelSize) / 1_000_000;
  const lettersWidth = useMemo(() => Math.max(900, lettersText.trim().length * letterHeight * 0.64), [
    letterHeight,
    lettersText,
  ]);
  const lettersAreaM2 = (lettersWidth * letterHeight) / 1_000_000;

  const visualStyle = {
    "--face-color": currentFaceColor.value,
    "--side-color": currentSideColor.value,
    "--letter-font": letterFont,
    "--panel-image-scale": panelImageScale / 100,
    "--panel-image-x": `${panelImageX}%`,
    "--panel-image-y": `${panelImageY}%`,
    "--logo-scale": logoScale / 100,
  } as CSSProperties;

  async function handleImageUpload(
    event: ChangeEvent<HTMLInputElement>,
    onReady: (dataUrl: string) => void,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      onReady(await readImageFile(file));
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main className="public-sign-configurator" style={visualStyle}>
      <header className="public-sign-topbar">
        <div>
          <h1>Конфигуратор вывесок</h1>
          <p>{activeProduct.note}</p>
        </div>
        <div className="scene-switch" role="tablist" aria-label="Режим визуализации">
          <button
            aria-selected={sceneMode === "day"}
            className={sceneMode === "day" ? "active" : ""}
            onClick={() => setSceneMode("day")}
            role="tab"
            type="button"
          >
            <Sun size={17} />
            День
          </button>
          <button
            aria-selected={sceneMode === "night"}
            className={sceneMode === "night" ? "active" : ""}
            onClick={() => setSceneMode("night")}
            role="tab"
            type="button"
          >
            <Moon size={17} />
            Ночь
          </button>
        </div>
      </header>

      <section className="product-tabs" aria-label="Продукты">
        {PRODUCTS.map((product) => (
          <button
            className={productId === product.id ? "active" : ""}
            key={product.id}
            onClick={() => setProductId(product.id)}
            type="button"
          >
            <strong>{product.title}</strong>
            <span>{product.note}</span>
          </button>
        ))}
      </section>

      <section className="sign-builder-layout">
        <aside className="builder-controls" aria-label="Настройки вывески">
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
              depth={letterDepth}
              faceColor={letterFaceColor}
              font={letterFont}
              height={letterHeight}
              logoImage={logoImage}
              logoScale={logoScale}
              logoShape={logoShape}
              sideColor={letterSideColor}
              text={lettersText}
              onDepthChange={setLetterDepth}
              onFaceColorChange={setLetterFaceColor}
              onFontChange={setLetterFont}
              onHeightChange={setLetterHeight}
              onLogoChange={(event) => void handleImageUpload(event, setLogoImage)}
              onLogoScaleChange={setLogoScale}
              onLogoShapeChange={setLogoShape}
              onSideColorChange={setLetterSideColor}
              onTextChange={setLettersText}
            />
          )}
        </aside>

        <section className={`builder-preview ${sceneMode}`} aria-label="Визуализация">
          <div className="preview-wall">
            {productId === "panel" ? (
              <PanelPreview
                image={panelImage}
                shape={panelShape}
                sideColor={panelSideColor.value}
                size={panelSize}
              />
            ) : (
              <LettersPreview
                depth={letterDepth}
                height={letterHeight}
                logoImage={logoImage}
                logoShape={logoShape}
                text={lettersText}
              />
            )}
          </div>
        </section>

        <aside className="builder-summary" aria-label="Структура проекта">
          <div className="summary-block">
            <span>Продукт</span>
            <strong>{activeProduct.title}</strong>
          </div>
          <div className="summary-block">
            <span>Габарит</span>
            <strong>
              {productId === "panel"
                ? `${panelSize} x ${panelSize} мм`
                : `${Math.round(lettersWidth)} x ${letterHeight} мм`}
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
            <span>Площадь лица</span>
            <strong>{formatArea(productId === "panel" ? panelAreaM2 : lettersAreaM2)} м²</strong>
          </div>
          <div className="summary-block muted">
            <span>Следующий слой</span>
            <strong>Диоды, блоки, материалы, раскладка</strong>
          </div>
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
              className={shape === item.id ? "active" : ""}
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
              className={size === item ? "active" : ""}
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
          <input accept="image/*" onChange={onImageChange} type="file" />
        </label>
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
  depth,
  faceColor,
  font,
  height,
  logoImage,
  logoScale,
  logoShape,
  sideColor,
  text,
  onDepthChange,
  onFaceColorChange,
  onFontChange,
  onHeightChange,
  onLogoChange,
  onLogoScaleChange,
  onLogoShapeChange,
  onSideColorChange,
  onTextChange,
}: {
  depth: number;
  faceColor: ColorOption;
  font: string;
  height: number;
  logoImage: string;
  logoScale: number;
  logoShape: LogoShape;
  sideColor: ColorOption;
  text: string;
  onDepthChange: (value: number) => void;
  onFaceColorChange: (color: ColorOption) => void;
  onFontChange: (font: string) => void;
  onHeightChange: (value: number) => void;
  onLogoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onLogoScaleChange: (value: number) => void;
  onLogoShapeChange: (shape: LogoShape) => void;
  onSideColorChange: (color: ColorOption) => void;
  onTextChange: (value: string) => void;
}) {
  return (
    <>
      <ControlSection title="Надпись">
        <label className="builder-field">
          <span>Текст</span>
          <input value={text} onChange={(event) => onTextChange(event.target.value)} />
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
        </label>
        <RangeField label="Высота букв, мм" max={1200} min={120} onChange={onHeightChange} step={10} value={height} />
        <RangeField label="Глубина борта, мм" max={160} min={40} onChange={onDepthChange} step={5} value={depth} />
      </ControlSection>

      <ControlSection title="Логотип">
        <div className="option-grid three">
          {LOGO_SHAPES.map((item) => (
            <button
              className={logoShape === item.id ? "active" : ""}
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
          <input accept="image/*" onChange={onLogoChange} type="file" />
        </label>
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
  size,
}: {
  image: string;
  shape: PanelShape;
  sideColor: string;
  size: number;
}) {
  const previewSize = 270 + ((size - 400) / 300) * 180;

  return (
    <div className="panel-scene" style={{ "--panel-preview-size": `${previewSize}px` } as CSSProperties}>
      <div className="wall-bracket" />
      <div className={`panel-depth ${shape}`} style={{ background: sideColor }} />
      <div className={`panel-face ${shape}`}>
        {image ? (
          <img alt="" src={image} />
        ) : (
          <span>LOGO</span>
        )}
      </div>
      <div className="preview-dimension">{size} x {size} мм</div>
    </div>
  );
}

function LettersPreview({
  depth,
  height,
  logoImage,
  logoShape,
  text,
}: {
  depth: number;
  height: number;
  logoImage: string;
  logoShape: LogoShape;
  text: string;
}) {
  const limitedHeight = Math.min(1200, Math.max(120, height));
  const wordSize = 64 + (limitedHeight / 1200) * 118;
  const logoSize = 92 + (limitedHeight / 1200) * 128;

  return (
    <div
      className="letters-scene"
      style={
        {
          "--letter-preview-size": `${wordSize}px`,
          "--logo-preview-size": `${logoSize}px`,
        } as CSSProperties
      }
    >
      <div className={`letter-logo ${logoShape}`}>
        {logoImage ? <img alt="" src={logoImage} /> : <span>Лого</span>}
      </div>
      <div className="letter-word" data-text={text || "Вывеска"}>
        {text || "Вывеска"}
      </div>
      <div className="preview-dimension">h {height} мм · борт {depth} мм</div>
    </div>
  );
}

function ControlSection({ children, title }: { children: ReactNode; title: string }) {
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
