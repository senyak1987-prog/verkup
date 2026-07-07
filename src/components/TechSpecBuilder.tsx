import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  ImagePlus,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, ReactNode, RefObject } from "react";
import type {
  AttachmentDimensions,
  BitrixDealFile,
  CostPosition,
  Deal,
  DealTechSpec,
  LayoutAttachment,
  TechSpecDraft,
  TechSpecItem,
  TemplateId,
} from "../types";
import { formatMoney, positionQuantity, positionTotal } from "../lib/costing";
import { defaultSaveApiUrl, loadBitrixDealFiles } from "../lib/saveApi";
import {
  hydrateResponsibleCard,
  responsibleForDraft,
  responsibleInternalPhoneFromCard,
  responsiblePhoneForTechSpec,
  responsiblePhoneFromCard,
} from "../lib/responsible";
import { EmployeeCard } from "./EmployeeCard";

type FieldKind = "text" | "number" | "select" | "textarea";

type FieldConfig = {
  id: string;
  label: string;
  kind?: FieldKind;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  wide?: boolean;
};

type ProductTemplate = {
  id: TemplateId;
  title: string;
  shortTitle: string;
  summary: string;
  defaultName: string;
  fields: FieldConfig[];
  defaults: Record<string, string>;
  checklist: string[];
  hints: string[];
};

const STORAGE_KEY = "verkup-tech-spec-builder";
const ATTACHMENT_ACCEPT = "image/*,.svg,.pdf,.ai,.cdr,.eps";
const IMAGE_EXPORT_SCALE = 2;
const JPEG_CANVAS_WIDTH = 1800;
const JPEG_MARGIN = 48;
const JPEG_CONTENT_WIDTH = JPEG_CANVAS_WIDTH - JPEG_MARGIN * 2;
const JPEG_GRID_GAP = 14;
const JPEG_BODY_GAP = 18;
const JPEG_MEDIA_WIDTH = Math.round(JPEG_CONTENT_WIDTH / 3);
const JPEG_TABLE_WIDTH = JPEG_CONTENT_WIDTH - JPEG_MEDIA_WIDTH - JPEG_BODY_GAP;
const JPEG_ATTACHMENT_TILE_HEIGHT = 430;
const EMPTY_COST_POSITIONS: CostPosition[] = [];

const commonFields: FieldConfig[] = [
  { id: "name", label: "Название изделия", required: true, placeholder: "Вывеска, короб, табличка" },
  { id: "quantity", label: "Количество", placeholder: "1 шт" },
  { id: "size", label: "Габариты", required: true, placeholder: "например 1500 x 500 x 60 мм" },
  { id: "layout", label: "Макет / файлы", placeholder: "макет приложен, фото фасада, замер" },
  {
    id: "installPlace",
    label: "Место / монтаж",
    placeholder: "улица, интерьер, стекло, фасад, подвес",
    wide: true,
  },
];

const lightOptions = ["ЛИЦЕВОЕ", "КОНТРАЖУР", "ЛИЦЕВОЕ+ТОРЦЕВОЕ", "ТОРЦЕВОЕ", "НЕТ"];
const glowOptions = ["НЕЙТРАЛЬНОЕ", "ТЕПЛОЕ", "ХОЛОДНОЕ", "RGB/цветное", "НЕТ"];
const psuOptions = ["УЛИЧНЫЙ", "ИНТЕРЬЕРНЫЙ", "НЕТ", "ОТДАТЬ ОТДЕЛЬНО", "УТОЧНИТЬ"];
const yesNoOptions = ["НЕТ", "ДА", "УТОЧНИТЬ"];
const wireOptions = [
  "ПОСЕРЕДИНЕ",
  "СНИЗУ ПОСЕРЕДИНЕ",
  "СВЕРХУ ПОСЕРЕДИНЕ",
  "СНИЗУ СЛЕВА",
  "СНИЗУ СПРАВА",
  "СВЕРХУ СЛЕВА",
  "СВЕРХУ СПРАВА",
  "ПО МЕСТУ",
  "НЕТ",
];

const productTemplates: ProductTemplate[] = [
  {
    id: "letters",
    title: "Объемные буквы / логотип",
    shortTitle: "Вывеска",
    summary: "Стандартная таблица для световых и несветовых букв, логотипов и подложек.",
    defaultName: "Вывеска",
    fields: [
      {
        id: "constructionType",
        label: "Тип конструкции",
        kind: "select",
        required: true,
        options: [
          "ОБЪЕМНЫЕ СВЕТОВЫЕ БУКВЫ",
          "ОБЪЕМНЫЕ СВЕТОВЫЕ БУКВЫ+ЛОГОТИП",
          "ОБЪЕМНЫЕ НЕ СВЕТОВЫЕ БУКВЫ",
          "ПЛОСКИЕ БУКВЫ НА ПОДЛОЖКЕ",
        ],
      },
      { id: "lightingType", label: "Тип свечения", kind: "select", required: true, options: lightOptions },
      { id: "glowColor", label: "Свечение", kind: "select", required: true, options: glowOptions },
      { id: "faceMaterial", label: "Материал лица", required: true, placeholder: "молочный акрил 3 мм" },
      { id: "faceFilm", label: "Пленка / печать на лицо", placeholder: "Oracal 8500-010, УФ печать" },
      { id: "sideMaterial", label: "Борт материал", placeholder: "алюминий, ПВХ, полистирол" },
      { id: "sideFilm", label: "Пленка на борт", placeholder: "Oracal 641-070м, белый алюминий" },
      { id: "returnSide", label: "Подворот на борт", kind: "select", options: yesNoOptions },
      { id: "depth", label: "Глубина букв", required: true, placeholder: "50 мм, 60 мм, 120 мм" },
      { id: "backMaterial", label: "Задник", placeholder: "ПВХ Strong 6 мм" },
      {
        id: "mountType",
        label: "Тип крепления",
        kind: "select",
        options: ["НА РАМЕ", "НА ОБЪЕМНОЙ ПОДЛОЖКЕ", "ОТДЕЛЬНОСТОЯЩИЕ", "НА ПЛОСКОЙ ПОДЛОЖКЕ", "ДИСТАНЦИОННИКИ"],
      },
      { id: "backingDepth", label: "Глубина подложки", placeholder: "30 мм, 50 мм" },
      { id: "frameColor", label: "Цвет рамы / подложки", placeholder: "641-070м, RAL, покрас" },
      { id: "wireExit", label: "Вывод провода", kind: "select", options: wireOptions },
      { id: "psu", label: "Блок питания", kind: "select", options: psuOptions },
      { id: "cableLength", label: "Длина вывода", placeholder: "3 метра" },
      { id: "kit", label: "Комплектация", placeholder: "тросы, клемники, коробки, гофра, шаблон", wide: true },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      constructionType: "ОБЪЕМНЫЕ СВЕТОВЫЕ БУКВЫ",
      lightingType: "ЛИЦЕВОЕ",
      glowColor: "НЕЙТРАЛЬНОЕ",
      faceMaterial: "Молочный акрил 3 мм",
      sideMaterial: "Алюминий",
      backMaterial: "ПВХ Strong 6 мм",
      depth: "60 мм",
      returnSide: "НЕТ",
      mountType: "НА РАМЕ",
      wireExit: "ПОСЕРЕДИНЕ",
      psu: "УЛИЧНЫЙ",
      cableLength: "3 метра",
    },
    checklist: [
      "Разделить буквы и логотип, если материалы или крепление отличаются.",
      "Указать цвет пленки на лицо и на борт с серией Oracal/RAL.",
      "Отдельно указать раму, подложку, ступеньки на задниках и шаблон для монтажа.",
      "Если доставка в регион - добавить упаковку, фото/видео проверки и блок питания.",
    ],
    hints: ["База из листа Excel БУКВЫ и частых ТЗ: Smoking Shop, Спа, Котлеточка, КанцПарк."],
  },
  {
    id: "lightbox",
    title: "Световой короб",
    shortTitle: "Короб",
    summary: "Короба с лицевым, торцевым или комбинированным свечением.",
    defaultName: "Короб",
    fields: [
      {
        id: "constructionType",
        label: "Тип конструкции",
        kind: "select",
        required: true,
        options: ["ОБЪЕМНЫЙ СВЕТОВОЙ", "ОБЪЕМНЫЙ НЕ СВЕТОВОЙ", "СВЕТОВОЙ КОРОБ", "ТКАНЕВЫЙ КОРОБ"],
      },
      { id: "lightingType", label: "Тип свечения", kind: "select", required: true, options: lightOptions },
      { id: "glowColor", label: "Свечение", kind: "select", required: true, options: glowOptions },
      { id: "clickFrame", label: "Клик рамка", kind: "select", options: yesNoOptions },
      { id: "faceMaterial", label: "Лицо", required: true, placeholder: "молочный акрил 3 мм, баннерная ткань, ПВХ" },
      { id: "faceFilm", label: "Пленка / печать на лицо", placeholder: "641-070, полноцветная печать, УФ на прозрачке" },
      { id: "sideMaterial", label: "Борт материал", placeholder: "ПВХ, алюминий, акрил" },
      { id: "depth", label: "Глубина короба", required: true, placeholder: "60 мм, 80 мм, 100 мм" },
      { id: "sideFilm", label: "Пленка на борт", placeholder: "белая, черная, Oracal 641" },
      { id: "backMaterial", label: "Задник", placeholder: "ПВХ 3/5/6 мм, АКП" },
      {
        id: "mountType",
        label: "Тип крепления",
        kind: "select",
        options: ["К СТЕНЕ", "НА ПОДВЕСАХ", "НА РАМЕ", "К ФАСАДУ САМОРЕЗАМИ", "ПО МЕСТУ"],
      },
      { id: "wireExit", label: "Вывод провода", kind: "select", options: wireOptions },
      { id: "psu", label: "Блок питания", kind: "select", options: psuOptions },
      { id: "cableLength", label: "Длина вывода", placeholder: "3 метра" },
      { id: "powerReserve", label: "Запас по мощности", placeholder: "не менее 30%, 50%" },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      constructionType: "ОБЪЕМНЫЙ СВЕТОВОЙ",
      lightingType: "ЛИЦЕВОЕ",
      glowColor: "НЕЙТРАЛЬНОЕ",
      clickFrame: "НЕТ",
      faceMaterial: "Молочный акрил 3 мм",
      sideMaterial: "ПВХ",
      backMaterial: "ПВХ Strong 6 мм",
      depth: "60 мм",
      mountType: "К СТЕНЕ",
      wireExit: "СВЕРХУ ПОСЕРЕДИНЕ",
      psu: "УЛИЧНЫЙ",
      cableLength: "3 метра",
      powerReserve: "не менее 30%",
    },
    checklist: [
      "Проверить лицевую часть: пленка, УФ печать, бэклит или ткань.",
      "Уточнить задник, ответный борт, крышку, клик-рамку и способ доступа внутрь.",
      "Для подвесных коробов указать тросы, зажимы и точки крепления.",
      "Для региональной доставки добавить упаковку и проверку свечения.",
    ],
    hints: ["База из листа Excel КОРОБ и примеров: Пилатес, Чашечка, Все детали, Музей."],
  },
  {
    id: "panelBracket",
    title: "Панель Кронштейн",
    shortTitle: "Панель Кронштейн",
    summary: "Двусторонние консоли и лайтбоксы на кронштейне.",
    defaultName: "Панель Кронштейн",
    fields: [
      {
        id: "constructionType",
        label: "Тип конструкции",
        kind: "select",
        required: true,
        options: ["СВЕТОВОЙ ДВУСТОРОННИЙ", "НЕСВЕТОВОЙ ДВУСТОРОННИЙ", "ОДНОСТОРОННИЙ"],
      },
      { id: "lightingType", label: "Тип свечения", kind: "select", required: true, options: lightOptions },
      { id: "glowColor", label: "Свечение", kind: "select", required: true, options: glowOptions },
      { id: "faceFilm", label: "Пленка / печать на лицо", required: true, placeholder: "8500-010, полноцветная печать в два слоя" },
      { id: "sideFilm", label: "Пленка / материал на борт", placeholder: "641-070м, нержавейка, порошковая покраска" },
      { id: "depth", label: "Глубина ПК", required: true, placeholder: "130 мм, 150 мм, 200 мм" },
      { id: "frameMaterial", label: "Каркас / кронштейн", placeholder: "рама, труба 20x20, плита" },
      { id: "bracketSize", label: "Размер кронштейна", placeholder: "вылет, длина ног, труба" },
      { id: "mountType", label: "Тип крепления ПК", kind: "select", options: ["НА РАМЕ", "К СТЕНЕ", "НА ПЛИТЕ", "ПО МЕСТУ"] },
      { id: "frameColor", label: "Цвет рамы / подложки", placeholder: "черный матовый, RAL" },
      { id: "wireExit", label: "Вывод провода", kind: "select", options: wireOptions },
      { id: "psu", label: "Блок питания", kind: "select", options: psuOptions },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      constructionType: "СВЕТОВОЙ ДВУСТОРОННИЙ",
      lightingType: "ЛИЦЕВОЕ",
      glowColor: "НЕЙТРАЛЬНОЕ",
      faceFilm: "Полноцветная печать",
      sideFilm: "641-070м",
      depth: "130 мм",
      mountType: "НА РАМЕ",
      frameColor: "черный матовый",
      psu: "УЛИЧНЫЙ",
    },
    checklist: [
      "Указать обе стороны, если лицевая и задняя отличаются.",
      "Отдельно прописать кронштейн: профиль, вылет, плита, покраска.",
      "Проверить вывод провода по ноге или нижнему креплению.",
    ],
    hints: ["База из листа Excel ПАНЕЛЬ-КРОНШТЕЙН и примеров АМ Салон, Нотариус, Водолей."],
  },
  {
    id: "plate",
    title: "Табличка / стенд",
    shortTitle: "Табличка/Стенд",
    summary: "ПВХ, АКП, акрил, стекло, режимники, карманы и указатели.",
    defaultName: "Табличка/Стенд",
    fields: [
      { id: "baseMaterial", label: "Материал основы", kind: "select", required: true, options: ["ПВХ", "АКП", "ПРОЗРАЧНЫЙ АКРИЛ", "МОЛОЧНЫЙ АКРИЛ", "ПОЛИСТИРОЛ", "ДРУГОЕ"] },
      { id: "baseThickness", label: "Толщина основы", required: true, placeholder: "3 мм, 5 мм, 6 мм" },
      { id: "imageType", label: "Изображение", kind: "select", required: true, options: ["Печать", "Плоттер", "УФ печать", "Печать+ламинация", "Без печати"] },
      { id: "printDetails", label: "Печать / пленка", placeholder: "матовая ламинация, 641-070, УФ на прозрачке" },
      { id: "returnSide", label: "Подворот", kind: "select", options: yesNoOptions },
      {
        id: "mountType",
        label: "Тип крепления",
        kind: "select",
        options: ["ДВУСТОРОННИЙ СКОТЧ", "САМОРЕЗЫ", "ДИСТАНЦИОННЫЕ ДЕРЖАТЕЛИ", "МАГНИТЫ", "БЕЗ КРЕПЛЕНИЯ", "ПО МЕСТУ"],
      },
      { id: "holes", label: "Отверстия", placeholder: "4 отверстия по углам, отступ 10 мм" },
      { id: "glassSide", label: "Монтаж на стекло", kind: "select", options: ["НЕТ", "С ВНЕШНЕЙ СТОРОНЫ", "С ВНУТРЕННЕЙ СТОРОНЫ", "В ЗЕРКАЛЕ"] },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      baseMaterial: "ПВХ",
      baseThickness: "3 мм",
      imageType: "Печать",
      returnSide: "НЕТ",
      mountType: "ДВУСТОРОННИЙ СКОТЧ",
      glassSide: "НЕТ",
    },
    checklist: [
      "Указать материал и толщину основы.",
      "Отдельно прописать ламинацию, зеркальность, монтажную пленку и обрезку.",
      "Для саморезов указать отверстия, отступы и цвет шляпок.",
      "Для стекла проверить сторону монтажа и зеркалить ли макет.",
    ],
    hints: ["База из листа Excel ТАБЛИЧКА и примеров режимников, РЖД, НБМЦ, Пинки."],
  },
  {
    id: "sticker",
    title: "Печать / плоттерка",
    shortTitle: "Печать/Плоттерка",
    summary: "Печать на пленке, плоттерная резка, переноска и наклейки на стекло.",
    defaultName: "Печать/Плоттерка",
    fields: [
      { id: "film", label: "Материал / пленка", required: true, placeholder: "Oracal 641, 8500, прозрачная глянцевая, матовая" },
      { id: "printType", label: "Тип печати", kind: "select", options: ["Полноцветная печать", "УФ печать", "Сольвент", "Плоттерная резка", "Без печати"] },
      { id: "lamination", label: "Ламинация", kind: "select", options: ["Нет", "Матовая", "Глянцевая", "Белая", "С печатью"] },
      { id: "contourCut", label: "Плоттерная резка", kind: "select", options: yesNoOptions },
      { id: "transferFilm", label: "Перенос на монтажную пленку", kind: "select", options: yesNoOptions },
      { id: "mirror", label: "Как делать", kind: "select", options: ["НЕ зеркалить", "Зеркалить", "Уточнить"] },
      { id: "mount", label: "Монтаж", kind: "select", options: ["С внешней стороны остекления", "С внутренней стороны остекления", "На поверхность", "Без монтажа"] },
      { id: "weed", label: "Выборка", kind: "select", options: ["Да", "Нет", "Только крупная", "Уточнить"] },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      film: "Oracal 641",
      printType: "Плоттерная резка",
      lamination: "Нет",
      contourCut: "Да",
      transferFilm: "Да",
      mirror: "НЕ зеркалить",
      mount: "На поверхность",
      weed: "Да",
    },
    checklist: [
      "Указать сторону стекла и зеркальность.",
      "Уточнить нужна ли выборка и монтажная пленка.",
      "Для нумерации и серийных наклеек прописать номера и упаковку.",
    ],
    hints: ["Частые ТЗ: плоттерка, Smoking Shop наклейки, РЖД пленка, QR."],
  },
  {
    id: "neon",
    title: "Неон",
    shortTitle: "Неон",
    summary: "Гибкий неон на подложке, держателях или подвесах.",
    defaultName: "Неоновая вывеска",
    fields: [
      { id: "substrate", label: "Подложка", kind: "select", required: true, options: ["ПРОЗРАЧНОЕ ОРГСТЕКЛО", "АКРИЛ", "ПВХ", "БЕЗ ПОДЛОЖКИ", "ДРУГОЕ"] },
      { id: "substrateThickness", label: "Толщина подложки", required: true, placeholder: "4 мм, 5 мм, 6 мм" },
      { id: "substrateFilm", label: "Пленка на подложку", placeholder: "нет, 641-070, светоблок" },
      { id: "neonThickness", label: "Толщина неона", required: true, placeholder: "6/12 мм, 8/16 мм" },
      { id: "neonColor", label: "Цвет неона", required: true, placeholder: "теплый белый, зеленый, мятный" },
      {
        id: "mountType",
        label: "Тип крепления",
        kind: "select",
        options: ["ДИСТАНЦИОННЫЕ ДЕРЖАТЕЛИ", "ТРОСИКИ", "ПОДВЕСЫ", "НА СКОТЧ", "ПО МЕСТУ"],
      },
      { id: "wireExit", label: "Вывод провода", kind: "select", options: wireOptions },
      { id: "cableLength", label: "Длина провода", placeholder: "1 м, 2 м, 3 м" },
      { id: "psu", label: "Блок питания", kind: "select", options: psuOptions },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      substrate: "ПРОЗРАЧНОЕ ОРГСТЕКЛО",
      substrateThickness: "4 мм",
      substrateFilm: "Нет",
      neonThickness: "6/12 мм",
      neonColor: "белый нейтральный",
      mountType: "ДИСТАНЦИОННЫЕ ДЕРЖАТЕЛИ",
      psu: "ИНТЕРЬЕРНЫЙ",
    },
    checklist: [
      "Проверить цвет и толщину неона.",
      "Указать вывод провода и длину до блока.",
      "Прописать крепление, адаптер, вилку, чехол или упаковку.",
    ],
    hints: ["База из листа Excel НЕОН и примеров Кофе хочешь, Рассусеки, Видентис."],
  },
  {
    id: "incrustation",
    title: "Инкрустация",
    shortTitle: "Инкрустация",
    summary: "Инкрустация в подложку с глубиной выборки и отдельным задником.",
    defaultName: "Инкрустация",
    fields: [
      { id: "constructionType", label: "Тип конструкции", kind: "select", required: true, options: ["ИНКРУСТАЦИЯ", "ИНКРУСТАЦИЯ С ПОДСВЕТКОЙ", "НЕСВЕТОВАЯ ИНКРУСТАЦИЯ"] },
      { id: "lightingType", label: "Тип свечения", kind: "select", options: lightOptions },
      { id: "glowColor", label: "Свечение", kind: "select", options: glowOptions },
      { id: "faceFilm", label: "Пленка / материал на лицо", required: true, placeholder: "композит, акрил, 641-010" },
      { id: "inlayDepth", label: "Глубина инкрустации", required: true, placeholder: "6 мм, 8 мм" },
      { id: "backingDepth", label: "Глубина подложки", required: true, placeholder: "40 мм, 50 мм" },
      { id: "backingColor", label: "Цвет подложки", placeholder: "белый, черный, RAL" },
      { id: "backingBack", label: "Задник подложки", placeholder: "АКП, ПВХ" },
      { id: "wireExit", label: "Вывод провода", kind: "select", options: wireOptions },
      { id: "psu", label: "Блок питания", kind: "select", options: psuOptions },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      constructionType: "ИНКРУСТАЦИЯ",
      lightingType: "ЛИЦЕВОЕ",
      glowColor: "НЕЙТРАЛЬНОЕ",
      inlayDepth: "8 мм",
      backingDepth: "50 мм",
      backingBack: "АКП",
    },
    checklist: [
      "Указать глубину выборки и глубину подложки отдельно.",
      "Прописать материал лица, задник и цвет подложки.",
      "Если есть свет - указать вывод провода и блок питания.",
    ],
    hints: ["База из листа Excel ИНКРУСТАЦИЯ и примера Шмуклер."],
  },
  {
    id: "milling",
    title: "Фрезеровка / шаблон",
    shortTitle: "Фрезеровка",
    summary: "Шаблоны, выборка пазов, раскрой акрила, ПВХ и композита.",
    defaultName: "Фрезеровка",
    fields: [
      { id: "material", label: "Материал", required: true, placeholder: "ПЭТ, ПВХ, акрил, композит, полистирол" },
      { id: "thickness", label: "Толщина", required: true, placeholder: "3 мм, 5 мм, 10 мм" },
      { id: "operation", label: "Операция", kind: "select", options: ["Фрезеровка по контуру", "Выборка паза", "Шаблон для монтажа", "Раскрой", "Отверстия"] },
      { id: "contour", label: "Контур / цвет линий", placeholder: "по красному контуру, внешний контур" },
      { id: "selectionDepth", label: "Глубина выборки", placeholder: "6,5 мм, 3-4 мм" },
      { id: "holes", label: "Отверстия / крепеж", placeholder: "зенковка, 4 мм, под саморезы" },
      { id: "packing", label: "Упаковка", placeholder: "упаковать, сфоткать, стрейч" },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      material: "ПВХ",
      operation: "Фрезеровка по контуру",
    },
    checklist: [
      "Указать материал и толщину.",
      "Для выборки прописать глубину и сторону.",
      "Для шаблона написать, что он идет в комплект на монтаж.",
    ],
    hints: ["Частые ТЗ: шаблон из ПЭТ, PROFILDOORS, Броня, кнопки, фрезеровка."],
  },
  {
    id: "metal",
    title: "Металлоконструкция",
    shortTitle: "Металлоконструкция",
    summary: "Каркасы, рамы, кронштейны, профили, уголки и покраска.",
    defaultName: "Металлоконструкция",
    fields: [
      { id: "profile", label: "Профиль / материал", required: true, placeholder: "20x20, 25x25x2, 40x20, полоса 25x3" },
      { id: "dimensions", label: "Размеры", required: true, placeholder: "длина, высота, вылет, номера кассет" },
      { id: "quantityDetail", label: "Количество деталей", placeholder: "4 палки, 26 уголков, 2 комплекта" },
      { id: "paint", label: "Покраска", placeholder: "черный матовый, RAL, грунт-эмаль" },
      { id: "plates", label: "Пластины / ноги / уголки", placeholder: "пластины, закладные, ноги 150 мм" },
      { id: "holes", label: "Отверстия / крепеж", placeholder: "просверлить, зенковка, саморезы" },
      { id: "welding", label: "Сварка / сборка", placeholder: "нарезать и сварить, положение по месту" },
      { id: "notes", label: "Примечание", kind: "textarea", wide: true },
    ],
    defaults: {
      profile: "20x20",
      paint: "покрасить в черный",
    },
    checklist: [
      "Указать профиль, толщину и количество деталей.",
      "Прописать покраску и что делать с остатком краски.",
      "Отдельно дать схемы кронштейнов, отверстия и крепеж.",
    ],
    hints: ["Частые ТЗ: Сербия, Косвик, Севас, рамы для композита."],
  },
];

const templateById = new Map(productTemplates.map((template) => [template.id, template]));

export function techSpecTemplateTitle(templateId: TemplateId) {
  return templateById.get(templateId)?.title || "Изделие";
}

export function techSpecFieldLabel(templateId: TemplateId, fieldId: string) {
  const template = templateById.get(templateId) ?? productTemplates[0];
  const field = [...commonFields, ...template.fields].find((item) => item.id === fieldId);
  return field?.label || humanizeTechSpecFieldId(fieldId);
}

export function orderedTechSpecFieldIds(item: TechSpecItem) {
  const template = templateById.get(item.templateId) ?? productTemplates[0];
  const configuredIds = [...commonFields, ...template.fields].map((field) => field.id);
  const seen = new Set<string>();
  return [
    ...configuredIds.filter((fieldId) => {
      if (seen.has(fieldId)) return false;
      seen.add(fieldId);
      return Object.prototype.hasOwnProperty.call(item.fields, fieldId);
    }),
    ...Object.keys(item.fields).filter((fieldId) => !seen.has(fieldId)),
  ];
}

function humanizeTechSpecFieldId(fieldId: string) {
  return fieldId
    .replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function dateValueFromDeal(value?: string) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const isoDate = rawValue.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;

  const parsedDate = new Date(rawValue);
  return Number.isNaN(parsedDate.getTime()) ? rawValue : parsedDate.toISOString().slice(0, 10);
}

function createItem(templateId: TemplateId): TechSpecItem {
  const template = templateById.get(templateId) ?? productTemplates[0];
  return {
    id: makeId(),
    templateId,
    attachments: [],
    workCostPositionIds: [],
    fields: {
      name: template.defaultName,
      quantity: "1 шт",
      ...template.defaults,
    },
  };
}

function createInitialDraft(): TechSpecDraft {
  return {
    dealNumber: "",
    projectName: "",
    manager: "",
    responsiblePhone: "",
    deadline: "",
    date: todayValue(),
    globalNote: "",
    items: [createItem("letters")],
  };
}

function createDraftForDeal(deal?: Deal): TechSpecDraft {
  const draft = createInitialDraft();
  if (!deal) return draft;
  const responsibleCard = hydrateResponsibleCard(deal.responsibleCard, deal.responsible);

  return {
    ...draft,
    dealNumber: deal.number || deal.id || "",
    projectName: deal.title || "",
    manager: responsibleForDraft(responsibleCard?.name || deal.responsible),
    responsiblePhone: responsiblePhoneForTechSpec(responsibleCard, deal.responsiblePhone),
    deadline: dateValueFromDeal(deal.expectedFinishDate),
  };
}

function normalizeTemplateId(value: unknown): TemplateId {
  return templateById.has(value as TemplateId) ? (value as TemplateId) : "letters";
}

function normalizeAttachmentDimensions(value: unknown): AttachmentDimensions | undefined {
  if (!value || typeof value !== "object") return undefined;
  const dimensions = value as Partial<AttachmentDimensions>;
  const unit = dimensions.unit;
  const source = dimensions.source;
  const width = dimensions.width;
  const height = dimensions.height;

  if (unit !== "mm" && unit !== "px" && unit !== "svg") return undefined;
  if (source !== "image" && source !== "svg" && source !== "eps" && source !== "pdf") return undefined;
  if (typeof width !== "number" || typeof height !== "number") return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width <= 0 || height <= 0) return undefined;

  return {
    width,
    height,
    unit,
    source,
  };
}

function normalizeAttachments(value: unknown): LayoutAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<LayoutAttachment[]>((result, attachment) => {
    if (!attachment || typeof attachment !== "object") return result;
    const candidate = attachment as Partial<LayoutAttachment>;
    if (!candidate.dataUrl || typeof candidate.dataUrl !== "string") return result;

    result.push({
      id: typeof candidate.id === "string" ? candidate.id : makeId(),
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name : "Макет",
      type: typeof candidate.type === "string" ? candidate.type : "",
      dataUrl: candidate.dataUrl,
      note: typeof candidate.note === "string" ? candidate.note : "",
      dimensions: normalizeAttachmentDimensions(candidate.dimensions),
    });

    return result;
  }, []);
}

function normalizeItem(value: unknown): TechSpecItem | null {
  if (!value || typeof value !== "object") return null;
  const rawItem = value as Partial<TechSpecItem>;
  const templateId = normalizeTemplateId(rawItem.templateId);
  const baseItem = createItem(templateId);

  return {
    ...baseItem,
    id: typeof rawItem.id === "string" ? rawItem.id : baseItem.id,
    fields: {
      ...baseItem.fields,
      ...(rawItem.fields && typeof rawItem.fields === "object" ? rawItem.fields : {}),
    },
    attachments: normalizeAttachments(rawItem.attachments),
    workCostPositionIds: Array.isArray(rawItem.workCostPositionIds)
      ? rawItem.workCostPositionIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function normalizeDraft(value: unknown, fallback = createInitialDraft()): TechSpecDraft {
  if (!value || typeof value !== "object") return fallback;
  const parsed = value as Partial<TechSpecDraft>;
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) return fallback;
  const normalizedItems = parsed.items.map(normalizeItem).filter((item): item is TechSpecItem => Boolean(item));
  if (!normalizedItems.length) return fallback;
  const stringOrFallback = (value: unknown, fallbackValue: string) =>
    typeof value === "string" && value.trim() ? value : fallbackValue;

  return {
    ...fallback,
    ...parsed,
    dealNumber: stringOrFallback(parsed.dealNumber, fallback.dealNumber),
    projectName: stringOrFallback(parsed.projectName, fallback.projectName),
    manager: responsibleForDraft(stringOrFallback(parsed.manager, fallback.manager)),
    responsiblePhone: stringOrFallback(parsed.responsiblePhone, fallback.responsiblePhone),
    deadline: stringOrFallback(parsed.deadline, fallback.deadline),
    date: typeof parsed.date === "string" ? parsed.date : fallback.date,
    globalNote: typeof parsed.globalNote === "string" ? parsed.globalNote : fallback.globalNote,
    items: normalizedItems,
  };
}

function hydrateDraftFromDeal(current: TechSpecDraft, fallback: TechSpecDraft): TechSpecDraft {
  const valueOrFallback = (value: string, fallbackValue: string) =>
    value && value.trim() ? value : fallbackValue;

  return {
    ...current,
    dealNumber: valueOrFallback(current.dealNumber, fallback.dealNumber),
    projectName: valueOrFallback(current.projectName, fallback.projectName),
    manager: valueOrFallback(responsibleForDraft(current.manager), responsibleForDraft(fallback.manager)),
    responsiblePhone: valueOrFallback(current.responsiblePhone, fallback.responsiblePhone),
    deadline: valueOrFallback(current.deadline, fallback.deadline),
  };
}

function readStoredDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialDraft();
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return createInitialDraft();
  }
}

function getRequiredMissing(item: TechSpecItem) {
  const template = templateById.get(item.templateId) ?? productTemplates[0];
  const required = [...commonFields, ...template.fields].filter((field) => field.required);

  return required.filter((field) => !String(item.fields[field.id] || "").trim()).map((field) => field.label);
}

function renderFieldValue(item: TechSpecItem, field: FieldConfig) {
  return String(item.fields[field.id] || "").trim();
}

function getItemTemplate(item: TechSpecItem) {
  return templateById.get(item.templateId) ?? productTemplates[0];
}

function getItemFields(item: TechSpecItem) {
  return [...commonFields, ...getItemTemplate(item).fields];
}

function getItemName(item: TechSpecItem) {
  const template = getItemTemplate(item);
  return renderFieldValue(item, { id: "name", label: "Название изделия" }) || template.defaultName || template.title;
}

type PrintableField = {
  label: string;
  value: string;
};

type WorkCostOption = {
  id: string;
  title: string;
  amount: number;
  quantityText: string;
  unit: string;
  sectionLabel: string;
  note?: string;
};

const WORK_COST_SECTIONS = new Set(["assembly", "mounting", "subcontract"]);

const WORK_COST_SECTION_LABELS: Record<string, string> = {
  assembly: "Стоимость сборки",
  milling: "Фрезеровка",
  mounting: "Монтаж",
  subcontract: "Подряд",
};

function formatQuantityText(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function buildWorkCostOptions(positions: CostPosition[] = []): WorkCostOption[] {
  return positions
    .filter((position) => WORK_COST_SECTIONS.has(position.section))
    .map((position) => ({
      id: position.id,
      title: position.title || "Работа",
      amount: positionTotal(position),
      quantityText: formatQuantityText(positionQuantity(position)),
      unit: position.unit || "шт",
      sectionLabel: WORK_COST_SECTION_LABELS[position.section] || "Работа",
      note: position.note,
    }))
    .filter((option) => option.amount > 0);
}

function getSelectedWorkCost(item: TechSpecItem, workCostOptions: WorkCostOption[]) {
  const selectedIds = new Set(item.workCostPositionIds || []);
  const selected = workCostOptions.filter((option) => selectedIds.has(option.id));
  return {
    selected,
    total: selected.reduce((sum, option) => sum + option.amount, 0),
  };
}

function getPrintableFields(item: TechSpecItem, workCostOptions: WorkCostOption[] = []): PrintableField[] {
  const fields = getItemFields(item)
    .map((field) => ({ label: field.label, value: renderFieldValue(item, field) }))
    .filter((field): field is PrintableField => Boolean(field.value));

  const workCost = getSelectedWorkCost(item, workCostOptions);
  if (workCost.total > 0) {
    fields.push({ label: "Оплата сборки", value: formatMoney(workCost.total) });
  }

  return fields;
}

function isImageAttachment(attachment: LayoutAttachment) {
  return (
    attachment.type.startsWith("image/") ||
    attachment.dataUrl.startsWith("data:image/") ||
    /\.(png|jpe?g|webp|gif|svg)$/i.test(attachment.name)
  );
}

const SVG_DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";
const MM_PER_INCH = 25.4;

type ParsedVectorLength = {
  value: number;
  unit: AttachmentDimensions["unit"];
};

function isSvgAttachment(attachment: LayoutAttachment) {
  return (
    attachment.type === "image/svg+xml" ||
    attachment.dataUrl.startsWith("data:image/svg+xml") ||
    /\.svg$/i.test(attachment.name)
  );
}

function formatDimensionNumber(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace(".", ",");
}

function formatAttachmentDimensions(dimensions?: AttachmentDimensions) {
  if (!dimensions) return "";
  const unitLabels: Record<AttachmentDimensions["unit"], string> = {
    mm: "мм",
    px: "px",
    svg: "ед. SVG",
  };
  const sourceLabels: Record<AttachmentDimensions["source"], string> = {
    image: "изображение",
    svg: "SVG",
    eps: "EPS/AI",
    pdf: "PDF/AI",
  };

  return `${formatDimensionNumber(dimensions.width)} x ${formatDimensionNumber(dimensions.height)} ${
    unitLabels[dimensions.unit]
  } (${sourceLabels[dimensions.source]})`;
}

function getAttachmentSizeText(attachment: LayoutAttachment) {
  return formatAttachmentDimensions(attachment.dimensions);
}

function getAttachmentExtension(attachment: LayoutAttachment) {
  const match = attachment.name.match(/\.([a-z0-9]+)$/i);
  if (match?.[1]) return match[1].toUpperCase();
  if (attachment.type.includes("pdf")) return "PDF";
  if (attachment.type.includes("postscript")) return "EPS";
  if (isSvgAttachment(attachment)) return "SVG";
  return "FILE";
}

function isVectorAttachment(attachment: LayoutAttachment) {
  return (
    isSvgAttachment(attachment) ||
    attachment.type.includes("pdf") ||
    attachment.type.includes("postscript") ||
    /\.(pdf|eps|ai|cdr|dxf)$/i.test(attachment.name)
  );
}

function getAttachmentKindLabel(attachment: LayoutAttachment) {
  if (isVectorAttachment(attachment)) return "Векторный макет";
  if (isImageAttachment(attachment)) return "Изображение";
  return "Файл макета";
}

function getAttachmentDimensionHint(attachment: LayoutAttachment) {
  const sizeText = getAttachmentSizeText(attachment);
  if (sizeText) return `Размер: ${sizeText}`;
  return isVectorAttachment(attachment) ? "Размер не определен автоматически" : "";
}

function getAttachmentSummary(attachment: LayoutAttachment) {
  const sizeText = getAttachmentSizeText(attachment);
  return [attachment.name, sizeText ? `размер ${sizeText}` : "", attachment.note].filter(Boolean).join(" - ");
}

function getAutoSizeFromAttachments(attachments: LayoutAttachment[]) {
  return attachments
    .map((attachment) =>
      attachment.dimensions?.source === "svg" ||
      attachment.dimensions?.source === "eps" ||
      attachment.dimensions?.source === "pdf"
        ? formatAttachmentDimensions(attachment.dimensions)
        : "",
    )
    .find(Boolean);
}

function normalizeSvgText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (/<svg\b[^>]*\sxmlns\s*=/i.test(trimmed)) return trimmed;
  return trimmed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function svgTextToDataUrl(text: string) {
  return `${SVG_DATA_URL_PREFIX}${encodeURIComponent(normalizeSvgText(text))}`;
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

function parseSvgViewBox(openTag: string): AttachmentDimensions | undefined {
  const viewBox = getXmlAttribute(openTag, "viewBox");
  const parts = viewBox
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(Number);

  if (parts.length < 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return undefined;
  return { width, height, unit: "svg", source: "svg" };
}

function parseSvgDimensions(text: string): AttachmentDimensions | undefined {
  const openTag = normalizeSvgText(text).match(/<svg\b[^>]*>/i)?.[0] || "";
  if (!openTag) return undefined;

  const width = parseVectorLength(getXmlAttribute(openTag, "width"));
  const height = parseVectorLength(getXmlAttribute(openTag, "height"));
  if (width && height && width.unit === height.unit) {
    return { width: width.value, height: height.value, unit: width.unit, source: "svg" };
  }

  return parseSvgViewBox(openTag);
}

function parsePostscriptDimensions(text: string): AttachmentDimensions | undefined {
  const match =
    text.match(/%%HiResBoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i) ||
    text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i);

  if (!match) return undefined;
  const left = Number(match[1]);
  const bottom = Number(match[2]);
  const right = Number(match[3]);
  const top = Number(match[4]);
  const width = Math.abs(right - left) * (MM_PER_INCH / 72);
  const height = Math.abs(top - bottom) * (MM_PER_INCH / 72);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { width, height, unit: "mm", source: "eps" };
}

function parsePdfDimensions(text: string): AttachmentDimensions | undefined {
  const match =
    text.match(/\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/i) ||
    text.match(/\/CropBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/i);

  if (!match) return undefined;
  const left = Number(match[1]);
  const bottom = Number(match[2]);
  const right = Number(match[3]);
  const top = Number(match[4]);
  const width = Math.abs(right - left) * (MM_PER_INCH / 72);
  const height = Math.abs(top - bottom) * (MM_PER_INCH / 72);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { width, height, unit: "mm", source: "pdf" };
}

function sanitizeFilePart(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "new"
  );
}

function techSpecTitle(draft: TechSpecDraft) {
  return ["ТЗ", draft.dealNumber, draft.projectName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function getExportFilename(draft: TechSpecDraft, extension: "txt" | "jpg") {
  return `${sanitizeFilePart(techSpecTitle(draft) || "TZ")}.${extension}`;
}

function getItemExportFilename(draft: TechSpecDraft, item: TechSpecItem, index: number, total: number, extension: "jpg") {
  const mainName = sanitizeFilePart(techSpecTitle(draft) || "TZ");
  if (total <= 1) return `${mainName}.${extension}`;

  const itemName = sanitizeFilePart(getItemName(item));
  return `${mainName} - ${index + 1}${itemName ? ` ${itemName}` : ""}.${extension}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

const EXPORT_DOCUMENT_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f6; color: #111827; font-family: Arial, Helvetica, sans-serif; }
  .tech-spec-document { width: 100%; max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; }
  .tech-spec-doc-page { border: 1px solid #d7dde7; border-radius: 8px; background: #fff; padding: 22px; break-after: page; page-break-after: always; }
  .tech-spec-doc-page:last-child { break-after: auto; page-break-after: auto; }
  .tech-spec-doc-title { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #111827; padding-bottom: 14px; }
  .tech-spec-doc-title span, .tech-spec-doc-item-head span { display: block; color: #667085; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .tech-spec-doc-title h2 { margin: 3px 0 0; color: #111827; font-size: 34px; line-height: 1.05; }
  .tech-spec-doc-meta { display: grid; gap: 5px; min-width: 240px; color: #344054; font-size: 13px; text-align: right; }
  .tech-spec-doc-note { margin-top: 14px; border: 1px solid #ffd2a8; border-left: 5px solid #f79009; background: #fff7ed; padding: 10px 12px; color: #7a2e0e; font-size: 14px; line-height: 1.4; }
  .tech-spec-doc-item { margin-top: 18px; break-inside: avoid; border: 1px solid #d7dde7; border-radius: 8px; overflow: hidden; }
  .tech-spec-doc-item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; background: #f7fafc; border-bottom: 1px solid #d7dde7; padding: 12px 14px; }
  .tech-spec-doc-item-head h3 { margin: 3px 0 0; color: #101828; font-size: 22px; line-height: 1.15; }
  .tech-spec-doc-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .tech-spec-doc-chips span { border: 1px solid #ccd5df; border-radius: 999px; background: #fff; padding: 5px 9px; color: #1f2937; font-size: 12px; font-weight: 700; text-transform: none; }
  .tech-spec-doc-item-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); align-items: stretch; }
  .tech-spec-doc-item-body.no-media { display: block; }
  .tech-spec-doc-media-grid { display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px; border-right: 1px solid #d7dde7; }
  .tech-spec-doc-media-grid figure, .tech-spec-doc-file, .tech-spec-doc-empty { margin: 0; border: 1px solid #d7dde7; border-radius: 7px; background: #f8fafc; padding: 8px; }
  .tech-spec-media-frame { position: relative; display: grid; place-items: center; min-height: 320px; overflow: hidden; border: 1px solid #d7dde7; border-radius: 7px; background: linear-gradient(135deg, #e9eef5 0%, #f8fafc 100%); }
  .tech-spec-media-frame img { display: block; width: 100%; height: 100%; max-height: 520px; object-fit: contain; padding: 8px; }
  .tech-spec-size-badge { display: none; }
  .tech-spec-file-tile { display: grid; align-content: center; justify-items: center; gap: 7px; min-height: 150px; border: 1px solid #d7dde7; border-radius: 7px; background: #fff; padding: 14px; text-align: center; }
  .tech-spec-file-tile.vector { background: linear-gradient(135deg, #ecfdf3 0%, #f8fafc 100%); }
  .tech-spec-file-extension { display: inline-grid; min-width: 58px; place-items: center; border-radius: 6px; background: #111827; padding: 7px 10px; color: #fff; font-size: 18px; font-weight: 800; line-height: 1; }
  .tech-spec-file-kind { color: #344054; font-size: 12px; font-weight: 700; }
  .tech-spec-file-dimensions { color: #0f766e; font-size: 11px; font-weight: 800; line-height: 1.25; }
  .tech-spec-file-dimensions.missing { color: #b54708; }
  .tech-spec-doc-file, .tech-spec-doc-empty { color: #344054; font-size: 12px; line-height: 1.35; }
  .tech-spec-doc-media-grid figcaption { display: none; }
  .tech-spec-doc-file { display: grid; gap: 6px; align-content: start; }
  .tech-spec-doc-file strong { display: block; color: #111827; }
  .tech-spec-doc-file small { color: #667085; }
  .tech-spec-doc-empty { padding: 14px; color: #667085; }
  .tech-spec-doc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tech-spec-doc-table th, .tech-spec-doc-table td { border-top: 1px solid #d7dde7; padding: 8px 10px; vertical-align: top; text-align: left; }
  .tech-spec-doc-table th { width: 260px; background: #fbfcfd; color: #475467; font-weight: 700; }
  .tech-spec-doc-table td { color: #111827; white-space: pre-wrap; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print {
    body { background: #fff; }
    .tech-spec-document { max-width: none; width: 100%; display: block; }
    .tech-spec-doc-page { border: 0; border-radius: 0; padding: 0; break-after: page; page-break-after: always; }
    .tech-spec-doc-page:last-child { break-after: auto; page-break-after: auto; }
  }
`;

function buildAttachmentImageHtml(attachment: LayoutAttachment) {
  return `<div class="tech-spec-media-frame"><img alt="${escapeHtml(attachment.name)}" src="${escapeHtml(
    attachment.dataUrl,
  )}" /></div>`;
}

function buildAttachmentFileHtml(attachment: LayoutAttachment) {
  return `<div class="tech-spec-doc-file tech-spec-doc-file-card">
    <span class="tech-spec-file-extension">${escapeHtml(getAttachmentExtension(attachment))}</span>
    <strong>${escapeHtml(getAttachmentKindLabel(attachment))}</strong>
  </div>`;
}

function buildPrintableHeader(draft: TechSpecDraft, metaHtml: string) {
  return `
    <div class="tech-spec-doc-title">
      <div>
        <span>ТЗ для производства</span>
        <h2>${escapeHtml(techSpecTitle(draft) || "ТЗ без номера")}</h2>
      </div>
      <div class="tech-spec-doc-meta">${metaHtml}</div>
    </div>
    ${draft.globalNote ? `<div class="tech-spec-doc-note">${escapeHtml(draft.globalNote)}</div>` : ""}`;
}

function buildPrintableBody(draft: TechSpecDraft, workCostOptions: WorkCostOption[] = []) {
  const meta = [
    draft.deadline ? ["Срок сдачи", draft.deadline] : null,
    draft.manager ? ["Ответственный", draft.manager] : null,
    draft.responsiblePhone ? ["Телефон", draft.responsiblePhone] : null,
  ].filter((item): item is [string, string] => Boolean(item));

  const metaHtml = meta
    .map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`)
    .join("");

  const itemsHtml = draft.items
    .map((item, index) => {
      const template = getItemTemplate(item);
      const quantity = renderFieldValue(item, { id: "quantity", label: "Количество" });
      const size = renderFieldValue(item, { id: "size", label: "Габариты" });
      const chips = [template.shortTitle, quantity, size].filter(Boolean);
      const attachments = item.attachments || [];

      const mediaHtml = attachments.length
        ? `<div class="tech-spec-doc-media-grid">${attachments
            .map((attachment) => {
              if (!isImageAttachment(attachment)) {
                return buildAttachmentFileHtml(attachment);
              }

              return `<figure>${buildAttachmentImageHtml(attachment)}</figure>`;
            })
            .join("")}</div>`
        : `<div class="tech-spec-doc-empty">Макет не приложен. Добавьте изображение, SVG или файл схемы перед передачей в цех.</div>`;

      const tableRows = getPrintableFields(item, workCostOptions)
        .map(
          ({ label, value }) =>
            `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("");

      return `
        <section class="tech-spec-doc-page">
          ${buildPrintableHeader(draft, metaHtml)}
          <section class="tech-spec-doc-item">
            <div class="tech-spec-doc-item-head">
              <div>
                <span>Изделие ${index + 1} / ${escapeHtml(template.title)}</span>
                <h3>${escapeHtml(getItemName(item))}</h3>
              </div>
              <div class="tech-spec-doc-chips">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>
            </div>
            <div class="tech-spec-doc-item-body${attachments.length ? "" : " no-media"}">
              ${mediaHtml}
              <table class="tech-spec-doc-table"><tbody>${tableRows}</tbody></table>
            </div>
          </section>
        </section>`;
    })
    .join("");

  return `
    <section class="tech-spec-document">
      ${itemsHtml}
    </section>`;
}

function buildPrintableDocument(draft: TechSpecDraft, workCostOptions: WorkCostOption[] = []) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8" /><title>${escapeHtml(
    techSpecTitle(draft) || "ТЗ",
  )}</title><style>${EXPORT_DOCUMENT_CSS}</style></head><body>${buildPrintableBody(draft, workCostOptions)}</body></html>`;
}

function buildSpecText(draft: TechSpecDraft, workCostOptions: WorkCostOption[] = []) {
  const header = [
    techSpecTitle(draft) || "ТЗ",
    draft.deadline ? `Срок сдачи: ${draft.deadline}` : "",
    draft.manager ? `Ответственный: ${draft.manager}` : "",
    draft.responsiblePhone ? `Телефон: ${draft.responsiblePhone}` : "",
    draft.globalNote ? `Общее примечание: ${draft.globalNote}` : "",
  ].filter(Boolean);

  const itemBlocks = draft.items.map((item, index) => {
    const template = getItemTemplate(item);
    const lines = getPrintableFields(item, workCostOptions).map(({ label, value }) => `${label}: ${value}`);

    return [`${index + 1}. ${template.title}`, ...lines].join("\n");
  });

  return [...header, ...itemBlocks].join("\n\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось подготовить файл ТЗ"));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });
}

function setCanvasFont(context: CanvasRenderingContext2D, size: number, weight = 400) {
  context.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
}

function splitCanvasWord(context: CanvasRenderingContext2D, word: string, maxWidth: number) {
  const parts: string[] = [];
  let part = "";

  for (const char of Array.from(word)) {
    const candidate = `${part}${char}`;
    if (part && context.measureText(candidate).width > maxWidth) {
      parts.push(part);
      part = char;
    } else {
      part = candidate;
    }
  }

  if (part) parts.push(part);
  return parts;
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = String(text || "").split(/\r?\n/);

  paragraphs.forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      return;
    }

    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        return;
      }

      if (line) lines.push(line);

      if (context.measureText(word).width > maxWidth) {
        const parts = splitCanvasWord(context, word, maxWidth);
        lines.push(...parts.slice(0, -1));
        line = parts[parts.length - 1] || "";
      } else {
        line = word;
      }
    });

    if (line) lines.push(line);
  });

  return lines.length ? lines : [""];
}

function measureWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  lineHeight: number,
) {
  return Math.max(lineHeight, wrapCanvasText(context, text, maxWidth).length * lineHeight);
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines?: number,
) {
  const lines = wrapCanvasText(context, text, maxWidth);
  const visibleLines = typeof maxLines === "number" ? lines.slice(0, maxLines) : lines;

  visibleLines.forEach((line, index) => {
    const suffix = maxLines && lines.length > maxLines && index === maxLines - 1 ? "..." : "";
    context.fillText(`${line}${suffix}`, x, y + index * lineHeight);
  });

  return y + visibleLines.length * lineHeight;
}

function drawCanvasBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke = "#d7dde7",
) {
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = stroke;
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось загрузить макет для JPEG."));
    image.src = src;
  });
}

async function loadCanvasAttachmentImages(draft: TechSpecDraft) {
  const images = new Map<string, HTMLImageElement>();
  const attachments = draft.items.flatMap((item) => item.attachments || []);

  await Promise.all(
    attachments.map(async (attachment) => {
      if (!isImageAttachment(attachment)) return;

      try {
        images.set(attachment.id, await loadCanvasImage(attachment.dataUrl));
      } catch {
        images.delete(attachment.id);
      }
    }),
  );

  return images;
}

function measureJpegAttachments(item: TechSpecItem) {
  if (!item.attachments.length) return 140;

  return (
    24 +
    item.attachments.length * JPEG_ATTACHMENT_TILE_HEIGHT +
    Math.max(0, item.attachments.length - 1) * JPEG_GRID_GAP +
    24
  );
}

function measureJpegTable(
  context: CanvasRenderingContext2D,
  item: TechSpecItem,
  workCostOptions: WorkCostOption[] = [],
) {
  const labelWidth = 330;
  const valueWidth = JPEG_TABLE_WIDTH - labelWidth;
  const fields = getPrintableFields(item, workCostOptions);
  if (!fields.length) return 64;

  return fields.reduce((height, { label, value }) => {
    setCanvasFont(context, 18, 700);
    const labelHeight = measureWrappedText(context, label, labelWidth - 24, 22);
    setCanvasFont(context, 19, 400);
    const valueHeight = measureWrappedText(context, value, valueWidth - 24, 24);
    return height + Math.max(46, labelHeight, valueHeight) + 16;
  }, 0);
}

function measureJpegItem(
  context: CanvasRenderingContext2D,
  item: TechSpecItem,
  workCostOptions: WorkCostOption[] = [],
) {
  return 72 + Math.max(measureJpegAttachments(item), measureJpegTable(context, item, workCostOptions));
}

function measureJpegPageHeight(
  context: CanvasRenderingContext2D,
  draft: TechSpecDraft,
  item: TechSpecItem,
  workCostOptions: WorkCostOption[] = [],
) {
  let height = JPEG_MARGIN + 118;

  if (draft.globalNote) {
    setCanvasFont(context, 20, 400);
    height += measureWrappedText(context, draft.globalNote, JPEG_CONTENT_WIDTH - 28, 25) + 26;
  }

  height += measureJpegItem(context, item, workCostOptions) + 24;

  return Math.max(980, Math.ceil(height + JPEG_MARGIN));
}

function drawJpegHeader(context: CanvasRenderingContext2D, draft: TechSpecDraft) {
  const title = techSpecTitle(draft) || "ТЗ без номера";
  context.fillStyle = "#111827";
  setCanvasFont(context, 54, 700);
  context.fillText(title, JPEG_MARGIN, JPEG_MARGIN);

  context.fillStyle = "#667085";
  setCanvasFont(context, 19, 700);
  context.fillText("ТЗ для производства", JPEG_MARGIN, JPEG_MARGIN + 62);

  const meta = [
    draft.deadline ? `Срок сдачи: ${draft.deadline}` : "",
    draft.manager ? `Ответственный: ${draft.manager}` : "",
    draft.responsiblePhone ? `Телефон: ${draft.responsiblePhone}` : "",
  ].filter(Boolean);

  setCanvasFont(context, 20, 400);
  context.fillStyle = "#344054";
  meta.forEach((line, index) => {
    const textWidth = context.measureText(line).width;
    context.fillText(line, JPEG_CANVAS_WIDTH - JPEG_MARGIN - textWidth, JPEG_MARGIN + index * 28);
  });

  context.strokeStyle = "#111827";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(JPEG_MARGIN, JPEG_MARGIN + 94);
  context.lineTo(JPEG_CANVAS_WIDTH - JPEG_MARGIN, JPEG_MARGIN + 94);
  context.stroke();

  return JPEG_MARGIN + 118;
}

function drawJpegNote(context: CanvasRenderingContext2D, draft: TechSpecDraft, y: number) {
  if (!draft.globalNote) return y;

  setCanvasFont(context, 20, 400);
  const height = measureWrappedText(context, draft.globalNote, JPEG_CONTENT_WIDTH - 28, 25) + 24;
  drawCanvasBox(context, JPEG_MARGIN, y, JPEG_CONTENT_WIDTH, height, "#fff7ed", "#ffd2a8");
  context.fillStyle = "#7a2e0e";
  drawWrappedText(context, draft.globalNote, JPEG_MARGIN + 14, y + 12, JPEG_CONTENT_WIDTH - 28, 25);
  return y + height + 22;
}

function drawJpegAttachmentPlaceholder(
  context: CanvasRenderingContext2D,
  attachment: LayoutAttachment,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  drawCanvasBox(context, x, y, width, height, isVectorAttachment(attachment) ? "#ecfdf3" : "#eef2f6", "#d7dde7");

  context.fillStyle = "#344054";
  setCanvasFont(context, 17, 700);
  context.textAlign = "center";
  drawWrappedText(context, getAttachmentKindLabel(attachment), x + 16, y + 22, width - 32, 20, 2);

  const extension = getAttachmentExtension(attachment);
  setCanvasFont(context, 48, 800);
  const extensionWidth = context.measureText(extension).width;
  context.fillStyle = "#111827";
  context.fillText(extension, x + (width - extensionWidth) / 2, y + height / 2 + 16);

  const dimensionHint = getAttachmentDimensionHint(attachment);
  if (dimensionHint) {
    setCanvasFont(context, 15, 700);
    context.fillStyle = getAttachmentSizeText(attachment) ? "#0f766e" : "#b54708";
    drawWrappedText(context, dimensionHint, x + 16, y + height - 44, width - 32, 18, 2);
  }

  context.textAlign = "left";
}

function drawJpegAttachments(
  context: CanvasRenderingContext2D,
  item: TechSpecItem,
  images: Map<string, HTMLImageElement>,
  y: number,
  x: number,
  width: number,
) {
  if (!item.attachments.length) {
    drawCanvasBox(context, x, y, width, 140, "#f8fafc");
    context.fillStyle = "#667085";
    setCanvasFont(context, 20, 400);
    drawWrappedText(context, "Макет не приложен.", x + 16, y + 18, width - 32, 25);
    return y + 140;
  }

  let currentY = y + 24;

  item.attachments.forEach((attachment) => {
    const tileHeight = JPEG_ATTACHMENT_TILE_HEIGHT;
    drawCanvasBox(context, x, currentY, width, tileHeight, "#f8fafc");

    const imageX = x + 12;
    const imageY = currentY + 12;
    const imageAreaWidth = width - 24;
    const imageAreaHeight = tileHeight - 24;
    drawCanvasBox(context, imageX, imageY, imageAreaWidth, imageAreaHeight, "#eef2f6", "#d7dde7");

    const image = images.get(attachment.id);
    if (image) {
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      const maxWidth = imageAreaWidth - 12;
      const maxHeight = imageAreaHeight - 12;
      const ratio = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);
      const renderedWidth = naturalWidth * ratio;
      const renderedHeight = naturalHeight * ratio;
      context.drawImage(
        image,
        imageX + (imageAreaWidth - renderedWidth) / 2,
        imageY + (imageAreaHeight - renderedHeight) / 2,
        renderedWidth,
        renderedHeight,
      );
    } else {
      drawJpegAttachmentPlaceholder(context, attachment, imageX, imageY, imageAreaWidth, imageAreaHeight);
    }

    currentY += tileHeight + JPEG_GRID_GAP;
  });

  return currentY - JPEG_GRID_GAP + 24;
}

function drawJpegTable(
  context: CanvasRenderingContext2D,
  item: TechSpecItem,
  y: number,
  x: number,
  width: number,
  workCostOptions: WorkCostOption[] = [],
) {
  const labelWidth = 330;
  const valueWidth = width - labelWidth;
  let currentY = y;

  getPrintableFields(item, workCostOptions).forEach(({ label, value }) => {
    setCanvasFont(context, 18, 700);
    const labelHeight = measureWrappedText(context, label, labelWidth - 24, 22);
    setCanvasFont(context, 19, 400);
    const valueHeight = measureWrappedText(context, value, valueWidth - 24, 24);
    const rowHeight = Math.max(46, labelHeight, valueHeight) + 16;

    drawCanvasBox(context, x, currentY, labelWidth, rowHeight, "#fbfcfd");
    drawCanvasBox(context, x + labelWidth, currentY, valueWidth, rowHeight, "#ffffff");

    context.fillStyle = "#475467";
    setCanvasFont(context, 18, 700);
    drawWrappedText(context, label, x + 12, currentY + 12, labelWidth - 24, 22);

    context.fillStyle = "#111827";
    setCanvasFont(context, 19, 400);
    drawWrappedText(context, value, x + labelWidth + 12, currentY + 12, valueWidth - 24, 24);

    currentY += rowHeight;
  });

  return currentY;
}

function drawJpegItem(
  context: CanvasRenderingContext2D,
  item: TechSpecItem,
  index: number,
  y: number,
  images: Map<string, HTMLImageElement>,
  workCostOptions: WorkCostOption[] = [],
) {
  const template = getItemTemplate(item);
  const itemHeight = measureJpegItem(context, item, workCostOptions);
  drawCanvasBox(context, JPEG_MARGIN, y, JPEG_CONTENT_WIDTH, itemHeight, "#ffffff");
  drawCanvasBox(context, JPEG_MARGIN, y, JPEG_CONTENT_WIDTH, 72, "#f7fafc");

  context.fillStyle = "#667085";
  setCanvasFont(context, 17, 700);
  context.fillText(`Изделие ${index + 1} / ${template.title}`, JPEG_MARGIN + 16, y + 12);

  context.fillStyle = "#101828";
  setCanvasFont(context, 31, 700);
  context.fillText(getItemName(item), JPEG_MARGIN + 16, y + 34);

  const chips = [
    template.shortTitle,
    renderFieldValue(item, { id: "quantity", label: "Количество" }),
    renderFieldValue(item, { id: "size", label: "Габариты" }),
  ].filter(Boolean);

  setCanvasFont(context, 17, 700);
  let chipX = JPEG_CANVAS_WIDTH - JPEG_MARGIN - 16;
  chips
    .slice()
    .reverse()
    .forEach((chip) => {
      const chipWidth = context.measureText(chip).width + 26;
      chipX -= chipWidth;
      drawCanvasBox(context, chipX, y + 24, chipWidth, 30, "#ffffff", "#ccd5df");
      context.fillStyle = "#1f2937";
      context.fillText(chip, chipX + 13, y + 31);
      chipX -= 8;
    });

  const bodyY = y + 72;
  const mediaBottom = drawJpegAttachments(context, item, images, bodyY, JPEG_MARGIN, JPEG_MEDIA_WIDTH);
  const tableBottom = drawJpegTable(
    context,
    item,
    bodyY,
    JPEG_MARGIN + JPEG_MEDIA_WIDTH + JPEG_BODY_GAP,
    JPEG_TABLE_WIDTH,
    workCostOptions,
  );
  return Math.max(mediaBottom, tableBottom);
}

async function renderDraftItemToJpegBlob(
  draft: TechSpecDraft,
  item: TechSpecItem,
  index: number,
  images: Map<string, HTMLImageElement>,
  workCostOptions: WorkCostOption[] = [],
) {
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = JPEG_CANVAS_WIDTH;
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) throw new Error("Canvas недоступен.");

  const height = measureJpegPageHeight(measureContext, draft, item, workCostOptions);
  const canvas = document.createElement("canvas");
  canvas.width = JPEG_CANVAS_WIDTH * IMAGE_EXPORT_SCALE;
  canvas.height = height * IMAGE_EXPORT_SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas недоступен.");

  context.scale(IMAGE_EXPORT_SCALE, IMAGE_EXPORT_SCALE);
  context.textBaseline = "top";
  context.fillStyle = "#f2f5f9";
  context.fillRect(0, 0, JPEG_CANVAS_WIDTH, height);
  drawCanvasBox(context, 20, 20, JPEG_CANVAS_WIDTH - 40, height - 40, "#ffffff", "#d7dde7");

  let y = drawJpegHeader(context, draft);
  y = drawJpegNote(context, draft, y);
  drawJpegItem(context, item, index, y, images, workCostOptions);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("JPEG не сформирован."))), "image/jpeg", 0.92);
  });
}

async function renderDraftToJpegBlobs(draft: TechSpecDraft, workCostOptions: WorkCostOption[] = []) {
  const images = await loadCanvasAttachmentImages(draft);
  const blobs: Blob[] = [];

  for (const [index, item] of draft.items.entries()) {
    blobs.push(await renderDraftItemToJpegBlob(draft, item, index, images, workCostOptions));
  }

  return blobs;
}

async function renderDraftToJpegBlob(draft: TechSpecDraft, workCostOptions: WorkCostOption[] = []) {
  const [blob] = await renderDraftToJpegBlobs(draft, workCostOptions);
  if (!blob) throw new Error("JPEG не сформирован.");
  return blob;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function inferAttachmentType(file: File) {
  if (file.type) return file.type;
  if (/\.svg$/i.test(file.name)) return "image/svg+xml";
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.(eps|ai)$/i.test(file.name)) return "application/postscript";
  return "application/octet-stream";
}

async function readImageDimensions(dataUrl: string): Promise<AttachmentDimensions | undefined> {
  try {
    const image = await loadCanvasImage(dataUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return undefined;
    return { width, height, unit: "px", source: "image" };
  } catch {
    return undefined;
  }
}

async function fileToAttachment(file: File): Promise<LayoutAttachment> {
  const name = file.name || "Макет из буфера";
  const type = inferAttachmentType(file);

  if (type === "image/svg+xml" || /\.svg$/i.test(name)) {
    const text = await readFileAsText(file);
    return {
      id: makeId(),
      name,
      type: "image/svg+xml",
      dataUrl: svgTextToDataUrl(text),
      note: "",
      dimensions: parseSvgDimensions(text),
    };
  }

  const dataUrl = await readFileAsDataUrl(file);
  let dimensions: AttachmentDimensions | undefined;

  if (type.startsWith("image/")) {
    dimensions = await readImageDimensions(dataUrl);
  } else if (/\.pdf$/i.test(name) || type === "application/pdf" || /\.(eps|ai)$/i.test(name)) {
    try {
      const text = await readFileAsText(file);
      dimensions = parsePdfDimensions(text) || parsePostscriptDimensions(text);
    } catch {
      dimensions = undefined;
    }
  }

  return {
    id: makeId(),
    name,
    type,
    dataUrl,
    note: "",
    dimensions,
  };
}

function svgTextToAttachment(text: string): LayoutAttachment {
  const normalizedText = normalizeSvgText(text);
  return {
    id: makeId(),
    name: "Макет из буфера.svg",
    type: "image/svg+xml",
    dataUrl: svgTextToDataUrl(normalizedText),
    note: "",
    dimensions: parseSvgDimensions(normalizedText),
  };
}

async function blobToAttachment(blob: Blob, name: string) {
  const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || "image/png" });
  return fileToAttachment(file);
}

function AttachmentImagePreview({
  attachment,
  showSize = true,
}: {
  attachment: LayoutAttachment;
  showSize?: boolean;
}) {
  const sizeText = showSize ? getAttachmentSizeText(attachment) : "";

  return (
    <div className="tech-spec-media-frame">
      <img alt={attachment.name} src={attachment.dataUrl} />
      {sizeText ? <span className="tech-spec-size-badge">{sizeText}</span> : null}
    </div>
  );
}

function AttachmentFilePreview({
  attachment,
  showDetails = true,
}: {
  attachment: LayoutAttachment;
  showDetails?: boolean;
}) {
  const dimensionHint = getAttachmentDimensionHint(attachment);
  const sizeText = getAttachmentSizeText(attachment);

  return (
    <div className={`tech-spec-file-tile ${isVectorAttachment(attachment) ? "vector" : ""}`}>
      <span className="tech-spec-file-extension">{getAttachmentExtension(attachment)}</span>
      <span className="tech-spec-file-kind">{getAttachmentKindLabel(attachment)}</span>
      {showDetails && dimensionHint ? (
        <span className={`tech-spec-file-dimensions ${sizeText ? "" : "missing"}`}>{dimensionHint}</span>
      ) : null}
    </div>
  );
}

function ProductionSpecDocument({
  draft,
  exportRef,
  workCostOptions,
}: {
  draft: TechSpecDraft;
  exportRef: RefObject<HTMLElement>;
  workCostOptions: WorkCostOption[];
}) {
  const meta = [
    draft.deadline ? ["Срок сдачи", draft.deadline] : null,
    draft.manager ? ["Ответственный", draft.manager] : null,
    draft.responsiblePhone ? ["Телефон", draft.responsiblePhone] : null,
  ].filter((item): item is [string, string] => Boolean(item));

  return (
    <section className="tech-spec-document" ref={exportRef}>
      {draft.items.map((item, index) => {
        const template = getItemTemplate(item);
        const quantity = renderFieldValue(item, { id: "quantity", label: "Количество" });
        const size = renderFieldValue(item, { id: "size", label: "Габариты" });
        const chips = [template.shortTitle, quantity, size].filter(Boolean);
        const attachments = item.attachments || [];
        const fields = getPrintableFields(item, workCostOptions);

        return (
          <section className="tech-spec-doc-page" key={item.id}>
            <div className="tech-spec-doc-title">
              <div>
                <span>ТЗ для производства</span>
                <h2>{techSpecTitle(draft) || "ТЗ без номера"}</h2>
              </div>
              <div className="tech-spec-doc-meta">
                {meta.map(([label, value]) => (
                  <div key={label}>
                    <strong>{label}:</strong> {value}
                  </div>
                ))}
              </div>
            </div>

            {draft.globalNote ? <div className="tech-spec-doc-note">{draft.globalNote}</div> : null}

            <section className="tech-spec-doc-item">
              <div className="tech-spec-doc-item-head">
                <div>
                  <span>
                    Изделие {index + 1} / {template.title}
                  </span>
                  <h3>{getItemName(item)}</h3>
                </div>
                <div className="tech-spec-doc-chips">
                  {chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </div>
              </div>

              <div className={`tech-spec-doc-item-body${attachments.length ? "" : " no-media"}`}>
                {attachments.length ? (
                  <div className="tech-spec-doc-media-grid">
                    {attachments.map((attachment) =>
                      isImageAttachment(attachment) || isSvgAttachment(attachment) ? (
                        <figure key={attachment.id}>
                          <AttachmentImagePreview attachment={attachment} showSize={false} />
                        </figure>
                      ) : (
                        <div className="tech-spec-doc-file" key={attachment.id}>
                          <AttachmentFilePreview attachment={attachment} showDetails={false} />
                        </div>
                      ),
                    )}
                  </div>
                ) : null}

                <table className="tech-spec-doc-table">
                  <tbody>
                    {fields.map(({ label, value }) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        );
      })}
    </section>
  );
}

type TechSpecBuilderProps = {
  topTabs?: ReactNode;
  deal?: Deal;
  storedSpec?: DealTechSpec;
  costNote?: string;
  costPositions?: CostPosition[];
  embedded?: boolean;
  onDraftChange?: (spec: DealTechSpec) => void;
  onUploadToBitrix?: (draft: TechSpecDraft, fileName: string, fileBase64: string) => Promise<void>;
};

function BitrixTechSpecSource({
  files,
  hasLocalSpec,
  onRefresh,
  state,
}: {
  files: BitrixDealFile[];
  hasLocalSpec: boolean;
  onRefresh?: () => void;
  state: "idle" | "loading" | "done" | "error";
}) {
  const preview = files.find((file) => file.type === "image") || files[0];

  if (!files.length && state === "done") return null;

  return (
    <section className={`tech-spec-bitrix-source${preview ? " has-files" : ""}`}>
      <div className="tech-spec-bitrix-source-head">
        <ClipboardList size={18} />
        <div>
          <strong>ТЗ из Bitrix</strong>
          <span>
            {preview
              ? hasLocalSpec
                ? "Найдено внешнее ТЗ, подготовленное не в форме сайта."
                : "Найдено ТЗ, подготовленное менеджером в Bitrix."
              : state === "loading"
                ? "Проверяю старую форму и файлы производства в Bitrix..."
                : "Файлы ТЗ из Bitrix пока не найдены."}
          </span>
        </div>
      </div>

      {preview ? (
        <div className="tech-spec-bitrix-source-body">
          {preview.type === "image" ? (
            <img alt={preview.name || "ТЗ из Bitrix"} decoding="async" loading="lazy" src={preview.url} />
          ) : (
            <div className="tech-spec-bitrix-source-file">
              <FileText size={22} />
              <span>{preview.type || "Файл"}</span>
            </div>
          )}
          <div className="tech-spec-bitrix-source-meta">
            <strong>{[preview.label, preview.name || "Файл ТЗ"].filter(Boolean).join(": ")}</strong>
            {files.length > 1 ? <span>Всего файлов из Bitrix: {files.length}</span> : null}
            <div className="tech-spec-bitrix-source-actions">
              <a href={preview.url} rel="noreferrer" target="_blank">
                <ExternalLink size={15} />
                Открыть
              </a>
              <a download={preview.name || "tech-spec-bitrix"} href={preview.downloadUrl || preview.url}>
                <Download size={15} />
                Сохранить
              </a>
              {onRefresh ? (
                <button disabled={state === "loading"} onClick={onRefresh} type="button">
                  <RotateCcw size={15} />
                  Обновить из Bitrix
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!preview && onRefresh ? (
        <div className="tech-spec-bitrix-source-actions">
          <button disabled={state === "loading"} onClick={onRefresh} type="button">
            <RotateCcw size={15} />
            {state === "loading" ? "Проверяю..." : "Проверить в Bitrix"}
          </button>
        </div>
      ) : null}

      {state === "error" ? <p>Не удалось подтянуть ТЗ из Bitrix. Попробуйте обновить страницу позже.</p> : null}
    </section>
  );
}

export function TechSpecBuilder({
  topTabs,
  deal,
  storedSpec,
  costNote,
  costPositions = EMPTY_COST_POSITIONS,
  embedded = false,
  onDraftChange,
  onUploadToBitrix,
}: TechSpecBuilderProps) {
  const [draft, setDraft] = useState<TechSpecDraft>(() =>
    storedSpec?.draft ? normalizeDraft(storedSpec.draft, createDraftForDeal(deal)) : deal ? createDraftForDeal(deal) : readStoredDraft(),
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("letters");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [exportState, setExportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [bitrixUploadState, setBitrixUploadState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [storageIssue, setStorageIssue] = useState("");
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [bitrixUploadError, setBitrixUploadError] = useState("");
  const exportRef = useRef<HTMLElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const cachedBitrixFiles = useMemo(
    () => (deal?.techSpecFiles?.length ? deal.techSpecFiles : deal?.installationFiles || []),
    [deal?.installationFiles, deal?.techSpecFiles],
  );
  const [loadedBitrixFiles, setLoadedBitrixFiles] = useState<BitrixDealFile[]>(cachedBitrixFiles);
  const [bitrixFilesState, setBitrixFilesState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const workCostOptions = useMemo(() => buildWorkCostOptions(costPositions), [costPositions]);
  const specText = useMemo(() => buildSpecText(draft, workCostOptions), [draft, workCostOptions]);
  const missingItems = useMemo(
    () =>
      draft.items.map((item) => ({
        itemId: item.id,
        name: item.fields.name || templateById.get(item.templateId)?.title || "Изделие",
        missing: getRequiredMissing(item),
      })),
    [draft.items],
  );
  const missingCount = missingItems.reduce((sum, item) => sum + item.missing.length, 0);
  const dealResponsibleCard = hydrateResponsibleCard(deal?.responsibleCard, deal?.responsible);
  const dealResponsiblePhone = responsiblePhoneFromCard(dealResponsibleCard, deal?.responsiblePhone);
  const dealResponsibleInternalPhone = responsibleInternalPhoneFromCard(dealResponsibleCard, deal?.responsiblePhone);
  const dealResponsibleContactPhone = responsiblePhoneForTechSpec(dealResponsibleCard, deal?.responsiblePhone);

  useEffect(() => {
    setLoadedBitrixFiles(cachedBitrixFiles);
    setBitrixFilesState("idle");
  }, [deal?.id, cachedBitrixFiles]);

  const refreshBitrixFiles = () => {
    if (!deal?.id || bitrixFilesState === "loading") return;
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) {
      setBitrixFilesState("error");
      return;
    }
    setBitrixFilesState("loading");
    void loadBitrixDealFiles({ apiUrl }, deal.id, { refresh: true })
      .then((result) => {
        const files = result.techSpecFiles?.length ? result.techSpecFiles : result.installationFiles || [];
        setLoadedBitrixFiles(files);
        setBitrixFilesState("done");
      })
      .catch(() => {
        setBitrixFilesState("error");
      });
  };

  useEffect(() => {
    if (!deal?.id || cachedBitrixFiles.length || bitrixFilesState !== "idle") return;
    const apiUrl = defaultSaveApiUrl();
    if (!apiUrl) return;

    let canceled = false;
    setBitrixFilesState("loading");
    void loadBitrixDealFiles({ apiUrl }, deal.id)
      .then((result) => {
        if (canceled) return;
        const files = result.techSpecFiles?.length ? result.techSpecFiles : result.installationFiles || [];
        setLoadedBitrixFiles(files);
        setBitrixFilesState("done");
      })
      .catch(() => {
        if (!canceled) setBitrixFilesState("error");
      });

    return () => {
      canceled = true;
    };
  }, [bitrixFilesState, cachedBitrixFiles.length, deal?.id]);

  useEffect(() => {
    const dealFallback = createDraftForDeal(deal);
    setDraft((current) => {
      if (storedSpec?.draft) {
        return normalizeDraft(storedSpec.draft, dealFallback);
      }

      if (!deal) {
        return readStoredDraft();
      }

      if (current.dealNumber && current.dealNumber === dealFallback.dealNumber) {
        return hydrateDraftFromDeal(current, dealFallback);
      }

      return dealFallback;
    });
    setSelectedTemplateId("letters");
    setBitrixUploadState("idle");
    setBitrixUploadError("");
  }, [
    deal?.id,
    deal?.number,
    deal?.title,
    deal?.responsible,
    deal?.responsiblePhone,
    deal?.responsibleCard,
    deal?.expectedFinishDate,
  ]);

  useEffect(() => {
    if (!dealResponsibleContactPhone) return;

    setDraft((current) => {
      if (String(current.responsiblePhone || "").trim()) return current;
      return { ...current, responsiblePhone: dealResponsibleContactPhone };
    });
  }, [dealResponsibleContactPhone]);

  useEffect(() => {
    if (deal?.id) {
      onDraftChange?.({
        dealId: deal.id,
        draft,
        updatedAt: new Date().toISOString(),
        bitrixFile: storedSpec?.bitrixFile,
      });
      setStorageIssue("");
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      setStorageIssue("");
    } catch {
      setStorageIssue("Макеты слишком большие для автосохранения. Экспорт работает, но черновик с файлами может не сохраниться.");
    }
  }, [draft, deal?.id]);

  useEffect(() => {
    if (!exportMenuOpen) return;

    function closeExportMenu(event: PointerEvent) {
      if (exportMenuRef.current?.contains(event.target as Node)) return;
      setExportMenuOpen(false);
    }

    function closeExportMenuByKey(event: KeyboardEvent) {
      if (event.key === "Escape") setExportMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeExportMenu);
    document.addEventListener("keydown", closeExportMenuByKey);

    return () => {
      document.removeEventListener("pointerdown", closeExportMenu);
      document.removeEventListener("keydown", closeExportMenuByKey);
    };
  }, [exportMenuOpen]);

  function updateDraftField(field: keyof TechSpecDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function addItem(templateId = selectedTemplateId) {
    setDraft((current) => ({ ...current, items: [createItem(templateId), ...current.items] }));
  }

  function addCostNote() {
    if (!costNote) return;
    setDraft((current) => {
      const existingNote = current.globalNote.trim();
      if (existingNote.includes(costNote)) return current;

      return {
        ...current,
        globalNote: [existingNote, costNote].filter(Boolean).join("\n"),
      };
    });
  }

  function removeItem(itemId: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((item) => item.id !== itemId),
    }));
  }

  function updateItemTemplate(itemId: string, templateId: TemplateId) {
    setSelectedTemplateId(templateId);
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;
        const nextItem = createItem(templateId);
        return {
          ...nextItem,
          id: item.id,
          attachments: item.attachments || [],
          workCostPositionIds: item.workCostPositionIds || [],
          fields: {
            ...nextItem.fields,
            name: item.fields.name || nextItem.fields.name,
            quantity: item.fields.quantity || nextItem.fields.quantity,
            size: item.fields.size || "",
            layout: item.fields.layout || "",
            installPlace: item.fields.installPlace || "",
          },
        };
      }),
    }));
  }

  function addAttachmentsToItem(itemId: string, attachments: LayoutAttachment[]) {
    if (!attachments.length) return;
    const autoSize = getAutoSizeFromAttachments(attachments);
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;
        const shouldApplySize = Boolean(autoSize && !String(item.fields.size || "").trim());

        return {
          ...item,
          fields: shouldApplySize ? { ...item.fields, size: autoSize || "" } : item.fields,
          attachments: [...item.attachments, ...attachments],
        };
      }),
    }));
  }

  async function addFilesToItem(itemId: string, files: FileList | File[]) {
    const fileList = Array.from(files).filter((file) => file.size > 0);
    if (!fileList.length) return;

    const attachments = await Promise.all(fileList.map(fileToAttachment));
    addAttachmentsToItem(itemId, attachments);
    setAttachmentNotice(`Добавлено файлов: ${attachments.length}`);
    window.setTimeout(() => setAttachmentNotice(""), 1800);
  }

  function removeAttachment(itemId: string, attachmentId: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? { ...item, attachments: item.attachments.filter((attachment) => attachment.id !== attachmentId) }
          : item,
      ),
    }));
  }

  function updateAttachmentNote(itemId: string, attachmentId: string, note: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              attachments: item.attachments.map((attachment) =>
                attachment.id === attachmentId ? { ...attachment, note } : attachment,
              ),
            }
          : item,
      ),
    }));
  }

  async function handleAttachmentPaste(event: ClipboardEvent<HTMLElement>, itemId: string) {
    const files = Array.from(event.clipboardData.files || []);
    const text = event.clipboardData.getData("text/plain");

    if (files.length) {
      event.preventDefault();
      await addFilesToItem(itemId, files);
      return;
    }

    if (text.trim().startsWith("<svg")) {
      event.preventDefault();
      addAttachmentsToItem(itemId, [svgTextToAttachment(text)]);
      setAttachmentNotice("SVG из буфера добавлен");
      window.setTimeout(() => setAttachmentNotice(""), 1800);
    }
  }

  async function pasteFromClipboard(itemId: string) {
    try {
      const attachments: LayoutAttachment[] = [];
      const clipboard = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };

      if (clipboard.read) {
        const clipboardItems = await clipboard.read();
        for (const clipboardItem of clipboardItems) {
          const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));
          if (imageType) {
            const blob = await clipboardItem.getType(imageType);
            attachments.push(await blobToAttachment(blob, `Макет из буфера.${imageType.split("/")[1] || "png"}`));
          }
        }
      }

      if (!attachments.length && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text.trim().startsWith("<svg")) attachments.push(svgTextToAttachment(text));
      }

      if (!attachments.length) {
        setAttachmentNotice("В буфере не найдено изображение или SVG. Можно нажать Ctrl+V в зоне макета.");
        return;
      }

      addAttachmentsToItem(itemId, attachments);
      setAttachmentNotice(`Из буфера добавлено: ${attachments.length}`);
      window.setTimeout(() => setAttachmentNotice(""), 2200);
    } catch {
      setAttachmentNotice("Браузер не дал доступ к буферу. Нажмите Ctrl+V в зоне макета или загрузите файл.");
    }
  }

  function selectTemplate(templateId: TemplateId) {
    if (draft.items.length === 1) {
      updateItemTemplate(draft.items[0].id, templateId);
      return;
    }

    setSelectedTemplateId(templateId);
  }

  function updateItemField(itemId: string, fieldId: string, value: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId ? { ...item, fields: { ...item.fields, [fieldId]: value } } : item,
      ),
    }));
  }

  function toggleItemWorkCost(itemId: string, positionId: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;

        const currentIds = item.workCostPositionIds || [];
        return {
          ...item,
          workCostPositionIds: checked
            ? Array.from(new Set([...currentIds, positionId]))
            : currentIds.filter((id) => id !== positionId),
        };
      }),
    }));
  }

  async function copySpec() {
    await navigator.clipboard.writeText(specText);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1400);
  }

  function resetDraft() {
    setDraft(deal ? createDraftForDeal(deal) : createInitialDraft());
    setSelectedTemplateId("letters");
  }

  function downloadSpec() {
    downloadText(getExportFilename(draft, "txt"), specText);
  }

  function exportPdf() {
    const printWindow = window.open("", "_blank", "width=1280,height=900");
    if (!printWindow) {
      setExportState("error");
      return;
    }

    setExportState("working");
    printWindow.document.open();
    printWindow.document.write(buildPrintableDocument(draft, workCostOptions));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      setExportState("done");
      window.setTimeout(() => setExportState("idle"), 1600);
    }, 350);
  }

  async function exportJpeg() {
    setExportState("working");

    try {
      const jpegBlobs = await renderDraftToJpegBlobs(draft, workCostOptions);
      jpegBlobs.forEach((jpegBlob, index) => {
        const item = draft.items[index];
        if (!item) return;
        downloadBlob(getItemExportFilename(draft, item, index, jpegBlobs.length, "jpg"), jpegBlob);
      });
      setExportState("done");
      window.setTimeout(() => setExportState("idle"), 1600);
    } catch {
      setExportState("error");
    }
  }

  async function uploadToBitrix() {
    if (!deal?.id || !onUploadToBitrix) return;

    setBitrixUploadState("working");
    setBitrixUploadError("");

    try {
      const jpegBlobs = await renderDraftToJpegBlobs(draft, workCostOptions);
      for (const [index, jpegBlob] of jpegBlobs.entries()) {
        const item = draft.items[index];
        if (!item) continue;
        await onUploadToBitrix(
          draft,
          getItemExportFilename(draft, item, index, jpegBlobs.length, "jpg"),
          await blobToBase64(jpegBlob),
        );
      }
      setBitrixUploadState("done");
      window.setTimeout(() => setBitrixUploadState("idle"), 2200);
    } catch (error) {
      setBitrixUploadState("error");
      setBitrixUploadError(error instanceof Error ? error.message : "Не удалось выгрузить ТЗ в Bitrix");
    }
  }

  return (
    <main className={`tech-spec-builder${embedded ? " embedded" : ""}`}>
      <div className="toolbar tech-spec-toolbar">
        <div className="toolbar-actions">{topTabs}</div>
        <div className="toolbar-actions tech-spec-actions">
          <button className="secondary compact" onClick={() => addItem()} type="button">
            <Plus size={16} />
            Изделие
          </button>
          <button className="secondary compact" onClick={copySpec} type="button">
            {copyState === "copied" ? <CheckCircle2 size={16} /> : <Copy size={16} />}
            {copyState === "copied" ? "Скопировано" : "Копировать"}
          </button>
          <div className="tech-spec-export-menu" ref={exportMenuRef}>
            <button
              aria-expanded={exportMenuOpen}
              className="primary compact"
              disabled={exportState === "working"}
              onClick={() => setExportMenuOpen((current) => !current)}
              type="button"
            >
              <Download size={16} />
              Сохранить как
            </button>
            {exportMenuOpen ? (
              <div className="tech-spec-export-popover" role="menu">
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    downloadSpec();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FileText size={16} />
                  TXT
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    exportPdf();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Printer size={16} />
                  PDF
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    void exportJpeg();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FileImage size={16} />
                  JPEG
                </button>
              </div>
            ) : null}
          </div>
          {deal && onUploadToBitrix ? (
            <button
              className="primary compact"
              disabled={bitrixUploadState === "working"}
              onClick={() => void uploadToBitrix()}
              type="button"
            >
              <Upload size={16} />
              {bitrixUploadState === "working" ? "Выгружаю..." : "В Bitrix"}
            </button>
          ) : null}
          <button className="icon-button" onClick={resetDraft} title="Сбросить форму" type="button">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <section className="tech-spec-hero">
        <div>
          <h1>{techSpecTitle(draft) || "ТЗ без номера"}</h1>
          <p>Шаблоны, макеты, изображения и экспорт в одном листе для передачи на сборку.</p>
        </div>
        <div className={missingCount ? "tech-spec-status warn" : "tech-spec-status is-ok"}>
          {missingCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{missingCount ? `Нужно заполнить: ${missingCount}` : "Обязательные поля заполнены"}</span>
        </div>
      </section>

      {deal ? (
        <BitrixTechSpecSource
          files={loadedBitrixFiles}
          state={bitrixFilesState}
          hasLocalSpec={Boolean(storedSpec)}
          onRefresh={refreshBitrixFiles}
        />
      ) : null}

      <section className="tech-spec-header">
        <label>
          <span>Номер сделки</span>
          <input
            onChange={(event) => updateDraftField("dealNumber", event.target.value)}
            placeholder="8634"
            value={draft.dealNumber}
          />
        </label>
        <label>
          <span>Ответственный</span>
          <input
            onChange={(event) => updateDraftField("manager", event.target.value)}
            placeholder="Фамилия"
            value={draft.manager}
          />
        </label>
        <label>
          <span>Телефон ответственного</span>
          <input
            onChange={(event) => updateDraftField("responsiblePhone", event.target.value)}
            placeholder="+7..."
            value={draft.responsiblePhone}
          />
        </label>
        <label>
          <span>Срок сдачи</span>
          <input
            onChange={(event) => updateDraftField("deadline", event.target.value)}
            type="date"
            value={draft.deadline}
          />
        </label>
        <label className="wide">
          <span>Общее примечание</span>
          <textarea
            onChange={(event) => updateDraftField("globalNote", event.target.value)}
            placeholder="Доставка в регион, срочность, упаковка, фото/видео проверки"
            value={draft.globalNote}
          />
        </label>
        {deal ? (
          <div className="tech-spec-contact-card">
            <EmployeeCard
              card={dealResponsibleCard}
              fallbackName={deal.responsible}
              fallbackPhone={deal.responsiblePhone}
              showPhone
            />
            {dealResponsibleContactPhone && draft.responsiblePhone !== dealResponsibleContactPhone ? (
              <button
                className="secondary compact"
                onClick={() => updateDraftField("responsiblePhone", dealResponsibleContactPhone)}
                type="button"
              >
                Взять телефон в ТЗ
              </button>
            ) : null}
            {!dealResponsiblePhone && dealResponsibleInternalPhone ? (
              <p className="tech-spec-contact-note">
                В Bitrix найден только внутренний номер: {dealResponsibleInternalPhone}. Полный телефон можно вписать вручную.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {storageIssue ||
      attachmentNotice ||
      exportState === "error" ||
      exportState === "done" ||
      bitrixUploadState === "done" ||
      bitrixUploadState === "error" ||
      storedSpec?.bitrixFile ? (
        <div className="tech-spec-notices">
          {storageIssue ? <span className="warn">{storageIssue}</span> : null}
          {attachmentNotice ? <span>{attachmentNotice}</span> : null}
          {exportState === "error" ? <span className="warn">Сохранение не сработало. Попробуйте PDF или уменьшите макеты.</span> : null}
          {exportState === "done" ? <span>Файл подготовлен.</span> : null}
          {bitrixUploadState === "done" ? <span>ТЗ выгружено в Bitrix.</span> : null}
          {bitrixUploadState === "error" ? <span className="warn">{bitrixUploadError}</span> : null}
          {storedSpec?.bitrixFile ? (
            <span>Последний файл в Bitrix: {storedSpec.bitrixFile.name}</span>
          ) : null}
        </div>
      ) : null}

      <div className="tech-spec-shell">
        <aside className="tech-spec-sidebar">
          <div className="tech-spec-panel">
            <div className="tech-spec-panel-head">
              <ClipboardList size={18} />
              <h2>Шаблоны</h2>
            </div>
            <div className="tech-spec-template-list">
              {productTemplates.map((template) => (
                <button
                  className={selectedTemplateId === template.id ? "active" : ""}
                  key={template.id}
                  onClick={() => selectTemplate(template.id)}
                  type="button"
                >
                  <strong>{template.shortTitle}</strong>
                  <span>{template.summary}</span>
                </button>
              ))}
            </div>
            <button className="secondary full" onClick={() => addItem(selectedTemplateId)} type="button">
              <Plus size={16} />
              Добавить выбранный шаблон
            </button>
          </div>

          <div className="tech-spec-panel">
            <div className="tech-spec-panel-head">
              <AlertTriangle size={18} />
              <h2>Контроль</h2>
            </div>
            {missingCount ? (
              <div className="tech-spec-missing-list">
                {missingItems
                  .filter((item) => item.missing.length)
                  .map((item) => (
                    <div key={item.itemId}>
                      <strong>{item.name}</strong>
                      <span>{item.missing.join(", ")}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="tech-spec-muted">Можно отдавать макетчику: базовые производственные поля заполнены.</p>
            )}
          </div>
        </aside>

        <section className="tech-spec-main">
          {draft.items.map((item, index) => {
            const template = templateById.get(item.templateId) ?? productTemplates[0];
            const fields = [...commonFields, ...template.fields];
            const missing = new Set(getRequiredMissing(item));
            const selectedWorkCost = getSelectedWorkCost(item, workCostOptions);

            return (
              <article className="tech-spec-item" key={item.id}>
                <div className="tech-spec-item-head">
                  <div>
                    <span>Изделие {index + 1}</span>
                    <h2>{template.title}</h2>
                  </div>
                  <div className="toolbar-actions">
                    <select
                      aria-label="Тип изделия"
                      onChange={(event) => updateItemTemplate(item.id, event.target.value as TemplateId)}
                      value={item.templateId}
                    >
                      {productTemplates.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      disabled={draft.items.length === 1}
                      onClick={() => removeItem(item.id)}
                      title="Удалить изделие"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="tech-spec-layout-box" onPaste={(event) => handleAttachmentPaste(event, item.id)}>
                  <div className="tech-spec-layout-head">
                    <div>
                      <h3>Макеты и схемы</h3>
                      <p>Изображение, SVG или файл вектора можно загрузить с диска либо вставить из буфера.</p>
                    </div>
                    <div className="toolbar-actions">
                      <label className="secondary compact tech-spec-upload-button">
                        <Upload size={16} />
                        Загрузить
                        <input
                          accept={ATTACHMENT_ACCEPT}
                          multiple
                          onChange={(event) => {
                            if (event.target.files) void addFilesToItem(item.id, event.target.files);
                            event.target.value = "";
                          }}
                          type="file"
                        />
                      </label>
                      <button className="secondary compact" onClick={() => void pasteFromClipboard(item.id)} type="button">
                        <ImagePlus size={16} />
                        Из буфера
                      </button>
                    </div>
                  </div>

                  {item.attachments.length ? (
                    <div className="tech-spec-attachments">
                      {item.attachments.map((attachment) => (
                        <div className="tech-spec-attachment-card" key={attachment.id}>
                          <button
                            aria-label="Удалить макет"
                            className="icon-button tech-spec-attachment-remove"
                            onClick={() => removeAttachment(item.id, attachment.id)}
                            title="Удалить макет"
                            type="button"
                          >
                            <X size={14} />
                          </button>
                          {isImageAttachment(attachment) || isSvgAttachment(attachment) ? (
                            <AttachmentImagePreview attachment={attachment} />
                          ) : (
                            <AttachmentFilePreview attachment={attachment} />
                          )}
                          <strong title={attachment.name}>{attachment.name}</strong>
                          <input
                            onChange={(event) => updateAttachmentNote(item.id, attachment.id, event.target.value)}
                            placeholder="Пометка: лицо, фасад, схема, 1 из 2"
                            value={attachment.note || ""}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tech-spec-layout-empty" tabIndex={0}>
                      <ImagePlus size={22} />
                      <span>Нажмите “Загрузить” или вставьте макет сюда через Ctrl+V</span>
                    </div>
                  )}
                </div>

                {workCostOptions.length ? (
                  <div className="tech-spec-work-cost-link">
                    <div>
                      <h3>Оплата сборки</h3>
                      <p>Выберите только позиции, которые идут макетчику за сборку этого изделия.</p>
                    </div>
                    <div className="tech-spec-work-cost-options">
                      {workCostOptions.map((option) => {
                        const checked = item.workCostPositionIds?.includes(option.id) ?? false;

                        return (
                          <label key={option.id}>
                            <input
                              checked={checked}
                              onChange={(event) => toggleItemWorkCost(item.id, option.id, event.target.checked)}
                              type="checkbox"
                            />
                            <span>
                              <strong>{option.title}</strong>
                              <small>
                                {option.sectionLabel} - {option.quantityText} {option.unit} - {formatMoney(option.amount)}
                              </small>
                              {option.note ? <em>{option.note}</em> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <strong className="tech-spec-work-cost-total">
                      {selectedWorkCost.total ? formatMoney(selectedWorkCost.total) : "Не выводить"}
                    </strong>
                  </div>
                ) : null}

                <div className="tech-spec-item-grid">
                  {fields.map((field) => {
                    const value = renderFieldValue(item, field);
                    const isMissing = field.required && missing.has(field.label);

                    return (
                      <label className={`${field.wide ? "wide" : ""} ${isMissing ? "missing" : ""}`} key={field.id}>
                        <span>
                          {field.label}
                          {field.required ? <b>*</b> : null}
                        </span>
                        {field.kind === "textarea" ? (
                          <textarea
                            onChange={(event) => updateItemField(item.id, field.id, event.target.value)}
                            placeholder={field.placeholder}
                            value={value}
                          />
                        ) : field.kind === "select" ? (
                          <select
                            onChange={(event) => updateItemField(item.id, field.id, event.target.value)}
                            value={value}
                          >
                            <option value="">Уточнить</option>
                            {(field.options || []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            onChange={(event) => updateItemField(item.id, field.id, event.target.value)}
                            placeholder={field.placeholder}
                            type={field.kind === "number" ? "number" : "text"}
                            value={value}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>

                <div className="tech-spec-checklist">
                  <div>
                    <h3>Что проверить</h3>
                    <ul>
                      {template.checklist.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>Основа шаблона</h3>
                    {template.hints.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="tech-spec-preview">
          <div className="tech-spec-panel">
            <div className="tech-spec-panel-head">
              <FileText size={18} />
              <h2>Лист для цеха</h2>
              <div className="toolbar-actions tech-spec-panel-actions">
                <button className="secondary compact" disabled={exportState === "working"} onClick={exportPdf} type="button">
                  <Printer size={16} />
                  PDF
                </button>
                <button className="secondary compact" disabled={exportState === "working"} onClick={exportJpeg} type="button">
                  <FileImage size={16} />
                  JPEG
                </button>
              </div>
            </div>
            <ProductionSpecDocument draft={draft} exportRef={exportRef} workCostOptions={workCostOptions} />
          </div>
        </aside>
      </div>
    </main>
  );
}
