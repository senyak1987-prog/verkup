import { FileText, ImageIcon, Maximize2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";

const POINT_TO_MM = 25.4 / 72;
const POINT_TO_CSS_PIXEL = 96 / 72;
const PX_TO_MM = 25.4 / 96;
const MM_PER_INCH = 25.4;
const MIN_ZOOM = 0.03;
const MAX_ZOOM = 6;
const ZOOM_STEP = 0.1;
const FIT_PADDING = 48;
const NUMBER_PATTERN = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const PDF_BOXES = ["CropBox", "MediaBox"] as const;
const SIGN_FONTS = [
  { label: "Arial Black", value: "Arial Black, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "Times New Roman, Times, serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
] as const;
const ORACAL_COLORS = [
  { name: "Красный 031", value: "#e2251b" },
  { name: "Белый 010", value: "#ffffff" },
  { name: "Черный 070", value: "#111827" },
  { name: "Синий 049", value: "#1565c0" },
  { name: "Желтый 021", value: "#ffd21f" },
  { name: "Зеленый 061", value: "#0f8a4b" },
  { name: "Оранжевый 034", value: "#f36b21" },
  { name: "Серебро 090", value: "#c8ced6" },
] as const;
const BACKING_COLORS = [
  { name: "Белая подложка", value: "#ffffff" },
  { name: "Черная подложка", value: "#111827" },
  { name: "Серый композит", value: "#d6dce6" },
  { name: "Прозрачная", value: "transparent" },
] as const;

type PdfBoxName = (typeof PDF_BOXES)[number] | "SVG" | "Image";
type LayoutKind = "pdf" | "svg" | "image";

type PdfDimensions = {
  boxName: PdfBoxName;
  rotation: number;
  userUnit: number;
  widthPoints: number;
  heightPoints: number;
  widthMm: number;
  heightMm: number;
  widthCssPixels: number;
  heightCssPixels: number;
};

type UploadedPdf = {
  kind: "pdf";
  fileName: string;
  fileSize: number;
  data: Uint8Array;
  dimensions: PdfDimensions;
};

type UploadedVisualLayout = {
  kind: "svg" | "image";
  fileName: string;
  fileSize: number;
  dataUrl: string;
  dimensions: PdfDimensions;
};

type UploadedLayout = UploadedPdf | UploadedVisualLayout;

type ParsedPdfBox = {
  name: (typeof PDF_BOXES)[number];
  values: [number, number, number, number];
};

type ContentBounds = {
  leftPercent: number;
  rightPercent: number;
  topPercent: number;
  bottomPercent: number;
  widthMm: number;
  heightMm: number;
};

type PixelBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ParsedVectorLength = {
  value: number;
  unit: "mm" | "px" | "svg";
};

type ZoomMode = "fit" | "manual";
type SignBaseType = "frame" | "backing";

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (source: { data: Uint8Array }) => PdfLoadingTask;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy?: () => Promise<void>;
};

type PdfDocument = {
  destroy?: () => Promise<void>;
  getPage: (pageNumber: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => PdfRenderTask;
};

type PdfViewport = {
  width: number;
  height: number;
};

type PdfRenderTask = {
  cancel?: () => void;
  promise: Promise<void>;
};

let pdfJsPromise: Promise<PdfJsModule> | undefined;

export function SignConfigurator({ topTabs }: { topTabs: ReactNode }) {
  const [layout, setLayout] = useState<UploadedLayout | null>(null);
  const [contentBounds, setContentBounds] = useState<ContentBounds | null>(null);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [signText, setSignText] = useState("ЦВЕТЫ");
  const [signFont, setSignFont] = useState<string>(SIGN_FONTS[0].value);
  const [faceColor, setFaceColor] = useState<string>(ORACAL_COLORS[0].value);
  const [backingColor, setBackingColor] = useState<string>(BACKING_COLORS[0].value);
  const [baseType, setBaseType] = useState<SignBaseType>("backing");
  const [signWidthMm, setSignWidthMm] = useState(1850);
  const [signHeightMm, setSignHeightMm] = useState(372);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const layoutKindLabel = layout ? getLayoutKindLabel(layout.kind) : "";

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measuredWorkspace = workspace;

    function updateWorkspaceSize() {
      setWorkspaceSize({
        width: measuredWorkspace.clientWidth,
        height: measuredWorkspace.clientHeight,
      });
    }

    updateWorkspaceSize();
    const observer = new ResizeObserver(updateWorkspaceSize);
    observer.observe(measuredWorkspace);
    window.addEventListener("resize", updateWorkspaceSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateWorkspaceSize);
    };
  }, []);

  const measuredDimensions = contentBounds
    ? { widthMm: contentBounds.widthMm, heightMm: contentBounds.heightMm }
    : layout?.dimensions;
  const signAreaM2 = (signWidthMm * signHeightMm) / 1_000_000;
  const previewFontSize = Math.max(34, Math.min(132, 920 / Math.max(6, signText.length)));
  const previewStyle = {
    "--sign-face-color": faceColor,
    "--sign-backing-color": backingColor,
    "--sign-font-family": signFont,
    "--sign-font-size": `${previewFontSize}px`,
    aspectRatio: `${Math.max(1, signWidthMm)} / ${Math.max(1, signHeightMm)}`,
  } as CSSProperties;

  useEffect(() => {
    if (!contentBounds) return;
    setSignWidthMm(Math.max(1, Math.round(contentBounds.widthMm)));
    setSignHeightMm(Math.max(1, Math.round(contentBounds.heightMm)));
  }, [contentBounds]);

  const fitZoom = useMemo(() => {
    if (!layout || !workspaceSize.width || !workspaceSize.height) return 1;

    const availableWidth = Math.max(1, workspaceSize.width - FIT_PADDING * 2);
    const availableHeight = Math.max(1, workspaceSize.height - FIT_PADDING * 2);
    const nextZoom = Math.min(
      availableWidth / layout.dimensions.widthCssPixels,
      availableHeight / layout.dimensions.heightCssPixels,
    );

    return clamp(roundZoom(nextZoom), MIN_ZOOM, MAX_ZOOM);
  }, [layout, workspaceSize.height, workspaceSize.width]);

  useEffect(() => {
    if (!layout || zoomMode !== "fit") return;
    setZoom((current) => (Math.abs(current - fitZoom) > 0.001 ? fitZoom : current));
  }, [fitZoom, layout, zoomMode]);

  const pageStyle = useMemo(() => {
    if (!layout) return undefined;

    return {
      "--pdf-width": `${layout.dimensions.widthCssPixels * zoom}px`,
      "--pdf-height": `${layout.dimensions.heightCssPixels * zoom}px`,
    } as CSSProperties;
  }, [layout, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!layout || layout.kind !== "pdf" || !canvas) return;
    const activePdf = layout;
    const activeCanvas = canvas;

    let canceled = false;
    let loadingTask: PdfLoadingTask | undefined;
    let renderTask: PdfRenderTask | undefined;

    async function renderPdf() {
      setRendering(true);
      setError("");

      try {
        const pdfjs = await loadPdfJs();
        loadingTask = pdfjs.getDocument({ data: activePdf.data.slice() });
        const document = await loadingTask.promise;
        const page = await document.getPage(1);
        const context = activeCanvas.getContext("2d");

        if (!context) {
          throw new Error("Не удалось подготовить canvas для PDF.");
        }

        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: POINT_TO_CSS_PIXEL * zoom * pixelRatio });
        activeCanvas.width = Math.max(1, Math.ceil(viewport.width));
        activeCanvas.height = Math.max(1, Math.ceil(viewport.height));
        context.clearRect(0, 0, activeCanvas.width, activeCanvas.height);

        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        await document.destroy?.();

        if (canceled) return;
        setContentBounds(boundsToMeasurement(findVisibleContentBounds(context), activeCanvas, activePdf.dimensions));
      } catch (caughtError) {
        if (canceled || String(caughtError).includes("RenderingCancelledException")) return;
        setError(caughtError instanceof Error ? caughtError.message : "Не удалось отрисовать PDF.");
      } finally {
        if (!canceled) setRendering(false);
      }
    }

    renderPdf();

    return () => {
      canceled = true;
      renderTask?.cancel?.();
      loadingTask?.destroy?.().catch(() => undefined);
    };
  }, [layout, zoom]);

  async function handleLayoutUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setContentBounds(null);
    setError("");
    setRendering(false);

    try {
      const uploadedLayout = await fileToLayout(file);
      setLayout(uploadedLayout);
      if (uploadedLayout.kind !== "pdf") {
        setContentBounds(fullContentBounds(uploadedLayout.dimensions));
      }
      setZoomMode("fit");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Не удалось прочитать размер макета.");
    } finally {
      event.target.value = "";
    }
  }

  function adjustZoom(delta: number) {
    setZoomMode("manual");
    setZoom((current) => clamp(roundZoom(current + delta), MIN_ZOOM, MAX_ZOOM));
  }

  function fitToView() {
    setZoomMode("fit");
    setZoom(fitZoom);
  }

  return (
    <main className="pdf-calculator">
      <div className="toolbar calculator-toolbar">
        <div>
          {topTabs}
          <p>{layout ? `${layout.fileName} · ${layoutKindLabel} · ${formatFileSize(layout.fileSize)}` : "Макет не выбран"}</p>
        </div>
        <div className="toolbar-actions calculator-actions">
          <label className="secondary calculator-upload" title="Загрузить PDF, SVG или изображение">
            <Upload size={18} />
            Макет
            <input accept="application/pdf,.pdf,image/svg+xml,.svg,image/*" onChange={handleLayoutUpload} type="file" />
          </label>
          <button
            className="icon-button"
            disabled={!layout || zoom <= MIN_ZOOM}
            onClick={() => adjustZoom(-ZOOM_STEP)}
            title="Уменьшить"
            type="button"
          >
            <ZoomOut size={18} />
          </button>
          <strong className="zoom-pill">{Math.round(zoom * 100)}%</strong>
          <button
            className="icon-button"
            disabled={!layout || zoom >= MAX_ZOOM}
            onClick={() => adjustZoom(ZOOM_STEP)}
            title="Увеличить"
            type="button"
          >
            <ZoomIn size={18} />
          </button>
          <button
            className={zoomMode === "fit" ? "icon-button active" : "icon-button"}
            disabled={!layout}
            onClick={fitToView}
            title="Уместить в окно"
            type="button"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

      {layout && (
        <section className="kpis calculator-kpis">
          <Metric
            label="Размер"
            value={`${formatMeasureMm(measuredDimensions?.widthMm || layout.dimensions.widthMm)} × ${formatMeasureMm(
              measuredDimensions?.heightMm || layout.dimensions.heightMm,
            )} мм`}
          />
          <Metric
            label={layout.kind === "pdf" ? "Лист PDF" : "Холст макета"}
            value={`${formatMeasureMm(layout.dimensions.widthMm)} × ${formatMeasureMm(layout.dimensions.heightMm)} мм`}
          />
          <Metric label="Тип" value={layoutKindLabel} />
          <Metric label="Область" value={layout.dimensions.boxName} />
        </section>
      )}

      {error && (
        <div className="calculator-error" role="alert">
          <FileText size={18} />
          {error}
        </div>
      )}

      <section className="sign-configurator-grid">
        <div className="sign-config-panel">
          <div className="section-title compact">
            <h3>Макет вывески</h3>
            <span>{formatAreaM2(signAreaM2)} м² пленки</span>
          </div>
          <label className="sign-field sign-field-wide">
            <span>Текст</span>
            <input value={signText} onChange={(event) => setSignText(event.target.value)} />
          </label>
          <label className="sign-field">
            <span>Шрифт</span>
            <select value={signFont} onChange={(event) => setSignFont(event.target.value)}>
              {SIGN_FONTS.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sign-size-grid">
            <label className="sign-field">
              <span>Ширина, мм</span>
              <input
                min={1}
                type="number"
                value={signWidthMm}
                onChange={(event) => setSignWidthMm(readPositiveNumber(event.target.value, signWidthMm))}
              />
            </label>
            <label className="sign-field">
              <span>Высота, мм</span>
              <input
                min={1}
                type="number"
                value={signHeightMm}
                onChange={(event) => setSignHeightMm(readPositiveNumber(event.target.value, signHeightMm))}
              />
            </label>
          </div>
          <div className="sign-field sign-field-wide">
            <span>Основа</span>
            <div className="sign-mode-tabs">
              <button
                className={baseType === "backing" ? "active" : ""}
                onClick={() => setBaseType("backing")}
                type="button"
              >
                Подложка
              </button>
              <button
                className={baseType === "frame" ? "active" : ""}
                onClick={() => setBaseType("frame")}
                type="button"
              >
                Рама
              </button>
            </div>
          </div>
          <div className="sign-field sign-field-wide">
            <span>Лицо: пленка Oracal</span>
            <div className="sign-swatch-grid">
              {ORACAL_COLORS.map((color) => (
                <button
                  className={faceColor === color.value ? "active" : ""}
                  key={color.value}
                  onClick={() => setFaceColor(color.value)}
                  title={color.name}
                  type="button"
                >
                  <i style={{ background: color.value }} />
                  {color.name}
                </button>
              ))}
            </div>
          </div>
          <div className="sign-field sign-field-wide">
            <span>Цвет основы</span>
            <div className="sign-swatch-grid compact">
              {BACKING_COLORS.map((color) => (
                <button
                  className={backingColor === color.value ? "active" : ""}
                  key={color.value}
                  onClick={() => setBackingColor(color.value)}
                  title={color.name}
                  type="button"
                >
                  <i style={{ background: color.value }} />
                  {color.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sign-preview-panel">
          <div className="section-title compact">
            <h3>Визуал</h3>
            <span>{baseType === "frame" ? "рама" : "подложка"}</span>
          </div>
          <div className="sign-preview-stage">
            <div className={`sign-preview-board ${baseType}`} style={previewStyle}>
              <div className="sign-preview-copy">{signText || " "}</div>
            </div>
          </div>
          <div className="sign-preview-meta">
            <span>{formatMeasureMm(signWidthMm)} × {formatMeasureMm(signHeightMm)} мм</span>
            <strong>{formatAreaM2(signAreaM2)} м²</strong>
          </div>
        </div>
      </section>

      <section className="pdf-workspace" ref={workspaceRef}>
        {layout && pageStyle ? (
          <div className="pdf-preview-scroll">
            <div className="pdf-page-frame" style={pageStyle}>
              {layout.kind === "pdf" ? (
                <canvas aria-label={layout.fileName} className="pdf-render-canvas" ref={canvasRef} />
              ) : (
                <img alt={layout.fileName} className="pdf-render-image" src={layout.dataUrl} />
              )}
              {contentBounds && (
                <DimensionOverlay
                  bounds={contentBounds}
                  heightMm={contentBounds.heightMm}
                  widthMm={contentBounds.widthMm}
                />
              )}
              {rendering && <div className="pdf-rendering">Отрисовываю PDF...</div>}
            </div>
          </div>
        ) : (
          <div className="pdf-empty">
            <ImageIcon size={38} />
            <strong>Макет не выбран</strong>
          </div>
        )}
      </section>
    </main>
  );
}

function DimensionOverlay({
  bounds,
  widthMm,
  heightMm,
}: {
  bounds: ContentBounds;
  widthMm: number;
  heightMm: number;
}) {
  const horizontalY = bounds.topPercent > 10 ? bounds.topPercent - 7 : bounds.topPercent + 7;
  const verticalX = bounds.leftPercent > 8 ? bounds.leftPercent - 4 : bounds.leftPercent + 4;
  const horizontalLabelX = (bounds.leftPercent + bounds.rightPercent) / 2;
  const verticalLabelY = (bounds.topPercent + bounds.bottomPercent) / 2;

  return (
    <div aria-hidden="true" className="pdf-measure-layer">
      <svg className="pdf-measure-svg" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line
          className="pdf-measure-line"
          vectorEffect="non-scaling-stroke"
          x1={bounds.leftPercent}
          x2={bounds.rightPercent}
          y1={horizontalY}
          y2={horizontalY}
        />
        <line
          className="pdf-measure-extension"
          vectorEffect="non-scaling-stroke"
          x1={bounds.leftPercent}
          x2={bounds.leftPercent}
          y1={horizontalY}
          y2={bounds.topPercent}
        />
        <line
          className="pdf-measure-extension"
          vectorEffect="non-scaling-stroke"
          x1={bounds.rightPercent}
          x2={bounds.rightPercent}
          y1={horizontalY}
          y2={bounds.topPercent}
        />
        <line
          className="pdf-measure-line"
          vectorEffect="non-scaling-stroke"
          x1={verticalX}
          x2={verticalX}
          y1={bounds.topPercent}
          y2={bounds.bottomPercent}
        />
        <line
          className="pdf-measure-extension"
          vectorEffect="non-scaling-stroke"
          x1={verticalX}
          x2={bounds.leftPercent}
          y1={bounds.topPercent}
          y2={bounds.topPercent}
        />
        <line
          className="pdf-measure-extension"
          vectorEffect="non-scaling-stroke"
          x1={verticalX}
          x2={bounds.leftPercent}
          y1={bounds.bottomPercent}
          y2={bounds.bottomPercent}
        />
      </svg>
      <span
        className="pdf-measure-label pdf-measure-label-width"
        style={{ left: `${horizontalLabelX}%`, top: `${horizontalY}%` }}
      >
        {formatMeasureMm(widthMm)} мм
      </span>
      <span
        className="pdf-measure-label pdf-measure-label-height"
        style={{ left: `${verticalX}%`, top: `${verticalLabelY}%` }}
      >
        {formatMeasureMm(heightMm)} мм
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fileToLayout(file: File): Promise<UploadedLayout> {
  const fileName = file.name || "Макет";
  const lowerName = fileName.toLowerCase();
  const fileType = file.type || "";

  if (fileType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    return {
      kind: "pdf",
      fileName,
      fileSize: file.size,
      data: new Uint8Array(buffer),
      dimensions: extractPdfDimensions(buffer),
    };
  }

  if (fileType === "image/svg+xml" || lowerName.endsWith(".svg")) {
    const text = await file.text();
    const dimensions = extractSvgDimensions(text);
    return {
      kind: "svg",
      fileName,
      fileSize: file.size,
      dataUrl: svgTextToDataUrl(text),
      dimensions,
    };
  }

  if (fileType.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) {
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await extractImageDimensions(dataUrl);
    return {
      kind: "image",
      fileName,
      fileSize: file.size,
      dataUrl,
      dimensions,
    };
  }

  throw new Error("Поддерживаются PDF, SVG, PNG, JPG, WEBP и GIF.");
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}

async function extractImageDimensions(dataUrl: string): Promise<PdfDimensions> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Не удалось прочитать размер изображения."));
    nextImage.src = dataUrl;
  });

  const widthPixels = image.naturalWidth || image.width;
  const heightPixels = image.naturalHeight || image.height;

  if (!widthPixels || !heightPixels) {
    throw new Error("В изображении не найден размер.");
  }

  return dimensionsFromPixels(widthPixels, heightPixels, "Image");
}

function normalizeSvgText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (/<svg\b[^>]*\sxmlns\s*=/i.test(trimmed)) return trimmed;
  return trimmed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function svgTextToDataUrl(text: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizeSvgText(text))}`;
}

function extractSvgDimensions(text: string): PdfDimensions {
  const openTag = normalizeSvgText(text).match(/<svg\b[^>]*>/i)?.[0] || "";
  if (!openTag) throw new Error("Файл не похож на SVG.");

  const width = parseVectorLength(getXmlAttribute(openTag, "width"));
  const height = parseVectorLength(getXmlAttribute(openTag, "height"));

  if (width && height) {
    return dimensionsFromMm(vectorLengthToMm(width), vectorLengthToMm(height), "SVG");
  }

  const viewBoxDimensions = parseSvgViewBoxDimensions(openTag);
  if (viewBoxDimensions) {
    return dimensionsFromMm(viewBoxDimensions.widthMm, viewBoxDimensions.heightMm, "SVG");
  }

  throw new Error("В SVG не найден размер: укажите width/height или viewBox.");
}

function getXmlAttribute(openTag: string, attribute: string) {
  const doubleQuoted = openTag.match(new RegExp(`${attribute}\\s*=\\s*"([^"]+)"`, "i"));
  if (doubleQuoted?.[1]) return doubleQuoted[1];
  const singleQuoted = openTag.match(new RegExp(`${attribute}\\s*=\\s*'([^']+)'`, "i"));
  return singleQuoted?.[1] || "";
}

function parseVectorLength(value: string): ParsedVectorLength | null {
  const normalized = value.trim().replace(",", ".").replace(/\s+/g, "");
  if (!normalized || normalized.includes("%")) return null;
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)(mm|cm|m|in|pt|pc|px)?$/i);
  if (!match) return null;

  const numberValue = Number(match[1]);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  const unit = (match[2] || "").toLowerCase();

  switch (unit) {
    case "mm":
      return { value: numberValue, unit: "mm" };
    case "cm":
      return { value: numberValue * 10, unit: "mm" };
    case "m":
      return { value: numberValue * 1000, unit: "mm" };
    case "in":
      return { value: numberValue * MM_PER_INCH, unit: "mm" };
    case "pt":
      return { value: (numberValue * MM_PER_INCH) / 72, unit: "mm" };
    case "pc":
      return { value: (numberValue * MM_PER_INCH) / 6, unit: "mm" };
    case "px":
      return { value: numberValue, unit: "px" };
    default:
      return { value: numberValue, unit: "svg" };
  }
}

function vectorLengthToMm(length: ParsedVectorLength) {
  if (length.unit === "px") return length.value * PX_TO_MM;
  return length.value;
}

function parseSvgViewBoxDimensions(openTag: string) {
  const viewBox = getXmlAttribute(openTag, "viewBox");
  const parts = viewBox
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(Number);

  if (parts.length < 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { widthMm: width, heightMm: height };
}

function dimensionsFromPixels(widthPixels: number, heightPixels: number, boxName: PdfBoxName): PdfDimensions {
  return dimensionsFromMm(widthPixels * PX_TO_MM, heightPixels * PX_TO_MM, boxName, {
    widthCssPixels: widthPixels,
    heightCssPixels: heightPixels,
  });
}

function dimensionsFromMm(
  widthMm: number,
  heightMm: number,
  boxName: PdfBoxName,
  cssSize?: { widthCssPixels: number; heightCssPixels: number },
): PdfDimensions {
  const widthPoints = widthMm / POINT_TO_MM;
  const heightPoints = heightMm / POINT_TO_MM;

  return {
    boxName,
    rotation: 0,
    userUnit: 1,
    widthPoints,
    heightPoints,
    widthMm,
    heightMm,
    widthCssPixels: cssSize?.widthCssPixels || widthPoints * POINT_TO_CSS_PIXEL,
    heightCssPixels: cssSize?.heightCssPixels || heightPoints * POINT_TO_CSS_PIXEL,
  };
}

function fullContentBounds(dimensions: PdfDimensions): ContentBounds {
  return {
    leftPercent: 0,
    rightPercent: 100,
    topPercent: 0,
    bottomPercent: 100,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
  };
}

function getLayoutKindLabel(kind: LayoutKind) {
  if (kind === "pdf") return "PDF";
  if (kind === "svg") return "SVG";
  return "Изображение";
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(/* @vite-ignore */ `${import.meta.env.BASE_URL}vendor/pdfjs/pdf.mjs`).then(
      (module) => {
        const pdfjs = module as PdfJsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          `${import.meta.env.BASE_URL}vendor/pdfjs/pdf.worker.mjs`,
          window.location.origin,
        ).href;
        return pdfjs;
      },
    );
  }

  return pdfJsPromise;
}

function findVisibleContentBounds(context: CanvasRenderingContext2D): PixelBounds | null {
  const { width, height } = context.canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const background = sampleBackground(imageData.data, width, height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (!isContentPixel(imageData.data, index, background)) continue;

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }

  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function boundsToMeasurement(
  bounds: PixelBounds | null,
  canvas: HTMLCanvasElement,
  dimensions: PdfDimensions,
): ContentBounds {
  const safeBounds = bounds || {
    left: 0,
    top: 0,
    right: canvas.width,
    bottom: canvas.height,
  };
  const widthRatio = (safeBounds.right - safeBounds.left) / canvas.width;
  const heightRatio = (safeBounds.bottom - safeBounds.top) / canvas.height;

  return {
    leftPercent: clamp((safeBounds.left / canvas.width) * 100, 0, 100),
    rightPercent: clamp((safeBounds.right / canvas.width) * 100, 0, 100),
    topPercent: clamp((safeBounds.top / canvas.height) * 100, 0, 100),
    bottomPercent: clamp((safeBounds.bottom / canvas.height) * 100, 0, 100),
    widthMm: dimensions.widthMm * widthRatio,
    heightMm: dimensions.heightMm * heightRatio,
  };
}

function sampleBackground(data: Uint8ClampedArray, width: number, height: number) {
  const sampleSize = Math.max(2, Math.min(12, Math.floor(Math.min(width, height) / 12)));
  const samples: Array<[number, number]> = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (const [startX, startY] of samples) {
    for (let y = startY; y < startY + sampleSize; y += 1) {
      for (let x = startX; x < startX + sampleSize; x += 1) {
        const index = (y * width + x) * 4;
        red += data[index];
        green += data[index + 1];
        blue += data[index + 2];
        count += 1;
      }
    }
  }

  return {
    red: red / count,
    green: green / count,
    blue: blue / count,
  };
}

function isContentPixel(
  data: Uint8ClampedArray,
  index: number,
  background: { red: number; green: number; blue: number },
) {
  const alpha = data[index + 3];
  if (alpha < 16) return false;

  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const maxDistance = Math.max(
    Math.abs(red - background.red),
    Math.abs(green - background.green),
    Math.abs(blue - background.blue),
  );

  return maxDistance > 24;
}

export function extractPdfDimensions(buffer: ArrayBuffer): PdfDimensions {
  const text = new TextDecoder("iso-8859-1").decode(buffer);
  if (!text.includes("%PDF")) {
    throw new Error("Файл не похож на PDF.");
  }

  const pageObject = findFirstPageObject(text);
  const contexts = [pageObject, text].filter(Boolean);
  const parsedBox = findPdfBox(text, contexts);

  if (!parsedBox) {
    throw new Error("В PDF не найден размер страницы: нет CropBox или MediaBox.");
  }

  const userUnit = Math.max(findNumberInContexts(contexts, "UserUnit") || 1, 0.01);
  const rotation = normalizeRotation(findNumberInContexts(contexts, "Rotate") || 0);
  const [left, bottom, right, top] = parsedBox.values;
  const boxWidth = Math.abs(right - left) * userUnit;
  const boxHeight = Math.abs(top - bottom) * userUnit;
  const isSideways = rotation === 90 || rotation === 270;
  const widthPoints = isSideways ? boxHeight : boxWidth;
  const heightPoints = isSideways ? boxWidth : boxHeight;

  return {
    boxName: parsedBox.name,
    rotation,
    userUnit,
    widthPoints,
    heightPoints,
    widthMm: widthPoints * POINT_TO_MM,
    heightMm: heightPoints * POINT_TO_MM,
    widthCssPixels: widthPoints * POINT_TO_CSS_PIXEL,
    heightCssPixels: heightPoints * POINT_TO_CSS_PIXEL,
  };
}

function findFirstPageObject(text: string) {
  const objectPattern = /\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(text))) {
    const body = match[1];
    if (/\/Type\s*\/Page(?!s)\b/.test(body)) return body;
  }

  return "";
}

function findPdfBox(text: string, contexts: string[]): ParsedPdfBox | null {
  for (const context of contexts) {
    for (const name of PDF_BOXES) {
      const directBox = parseDirectBox(context, name);
      if (directBox) return { name, values: directBox };

      const indirectBox = parseIndirectBox(text, context, name);
      if (indirectBox) return { name, values: indirectBox };
    }
  }

  return null;
}

function parseDirectBox(context: string, name: PdfBoxName) {
  const match = context.match(new RegExp(`\\/${name}\\s*\\[([^\\]]+)\\]`));
  return match ? parseBoxNumbers(match[1]) : null;
}

function parseIndirectBox(text: string, context: string, name: PdfBoxName) {
  const match = context.match(new RegExp(`\\/${name}\\s+(\\d+)\\s+(\\d+)\\s+R`));
  if (!match) return null;

  const objectBody = findObjectBody(text, Number(match[1]), Number(match[2]));
  return objectBody ? parseBoxNumbers(objectBody) : null;
}

function findObjectBody(text: string, objectNumber: number, generation: number) {
  const match = text.match(
    new RegExp(`\\b${objectNumber}\\s+${generation}\\s+obj\\b([\\s\\S]*?)\\bendobj\\b`),
  );
  return match?.[1] || "";
}

function parseBoxNumbers(value: string): [number, number, number, number] | null {
  const numbers = value.match(new RegExp(NUMBER_PATTERN, "g"))?.map(Number) || [];
  if (numbers.length < 4 || numbers.slice(0, 4).some((number) => !Number.isFinite(number))) {
    return null;
  }

  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

function findNumberInContexts(contexts: string[], name: string) {
  for (const context of contexts) {
    const match = context.match(new RegExp(`\\/${name}\\s+(${NUMBER_PATTERN})`));
    if (!match) continue;

    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }

  return null;
}

function normalizeRotation(value: number) {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

function roundZoom(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readPositiveNumber(value: string, fallback: number) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : fallback;
}

function formatMeasureMm(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
    useGrouping: false,
  }).format(value);
}

function formatAreaM2(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

function formatFileSize(value: number) {
  if (value >= 1024 * 1024) {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} МБ`;
  }

  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value / 1024)} КБ`;
}
