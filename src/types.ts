export type ResponsibleCard = {
  id: string;
  name: string;
  phone?: string;
  internalPhone?: string;
  email?: string;
  position?: string;
  department?: string;
  supervisor?: string;
  avatarUrl?: string;
  bitrixUrl?: string;
  chatUrl?: string;
  videoUrl?: string;
  lastSeenAt?: string;
  lastSeenText?: string;
};

export type Deal = {
  id: string;
  number: string;
  title: string;
  stageId?: string;
  stageCode?: DealStageCode;
  source: string;
  type: string;
  classification: string;
  saleAmount: number;
  installSaleAmount: number;
  responsibleId?: string;
  responsible: string;
  responsiblePhone?: string;
  responsibleCard?: ResponsibleCard;
  startDate: string;
  expectedFinishDate: string;
  createdDate: string;
  stageName: string;
  bitrixUrl: string;
};

export type DealStageCode = "tz" | "tzApproval" | "launch" | "production" | "defect";

export type CostSection =
  | "materials"
  | "lighting"
  | "assembly"
  | "consumables"
  | "subcontract"
  | "milling"
  | "print"
  | "plotter"
  | "mounting"
  | "defects"
  | "other";

export type CostCalcMode =
  | "manual"
  | "area"
  | "linear"
  | "milling"
  | "pieces"
  | "letterAssembly"
  | "hourly";

export type CostPosition = {
  id: string;
  section: CostSection;
  title: string;
  qty: number;
  unit: string;
  unitCost: number;
  minCost?: number;
  note?: string;
  catalogId?: string;
  calcMode?: CostCalcMode;
  baseUnitCost?: number;
  baseMinCost?: number;
  width?: number;
  height?: number;
  length?: number;
  thickness?: number;
  addons?: string[];
};

export type DealCalculation = {
  dealId: string;
  positions: CostPosition[];
  updatedAt: string;
};

export type CatalogItem = {
  id: string;
  section: CostSection;
  title: string;
  unit: string;
  unitCost: number;
  source: string;
  materialGroup?: string;
  materialFamily?: string;
  materialSubgroup?: string;
  materialGroupPath?: string;
  productCode?: string;
  productUrl?: string;
  imageUrl?: string;
  assemblySheet?: string;
  assemblyGroup?: string;
  assemblyOperation?: string;
  assemblyMinCost?: number;
  favorite?: boolean;
  favoriteOrder?: number;
};

export type AppData<T> = {
  generatedAt: string;
  items: T[];
};

export type StoredCalculations = {
  generatedAt: string;
  agentCostRatio: number;
  calculations: DealCalculation[];
};

export type TemplateId =
  | "letters"
  | "lightbox"
  | "panelBracket"
  | "plate"
  | "sticker"
  | "neon"
  | "incrustation"
  | "milling"
  | "metal";

export type AttachmentDimensions = {
  width: number;
  height: number;
  unit: "mm" | "px" | "svg";
  source: "image" | "svg" | "eps" | "pdf";
};

export type LayoutAttachment = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  note?: string;
  dimensions?: AttachmentDimensions;
};

export type TechSpecItem = {
  id: string;
  templateId: TemplateId;
  fields: Record<string, string>;
  attachments: LayoutAttachment[];
  workCostPositionIds?: string[];
};

export type TechSpecDraft = {
  dealNumber: string;
  projectName: string;
  manager: string;
  responsiblePhone: string;
  deadline: string;
  date: string;
  globalNote: string;
  items: TechSpecItem[];
};

export type DealTechSpec = {
  dealId: string;
  draft: TechSpecDraft;
  updatedAt: string;
  bitrixFile?: {
    field: string;
    name: string;
    uploadedAt: string;
  };
};

export type StoredTechSpecs = {
  generatedAt: string;
  specs: DealTechSpec[];
};

export type ProductionEmployeeRole = "maker" | "assembler";

export type ProductionAccessRole =
  | "none"
  | "leader"
  | "technologist"
  | "manager"
  | "shopChief"
  | "maker";

export type ProductionEmployee = {
  id: string;
  name: string;
  login?: string;
  avatarDataUrl?: string;
  pushSubscriptions?: ProductionPushSubscription[];
  role: ProductionEmployeeRole;
  accessRole: ProductionAccessRole;
  phone?: string;
  pinHash?: string;
  active: boolean;
  createdAt: string;
};

export type ProductionPushSubscription = {
  endpoint: string;
  keys?: {
    auth?: string;
    p256dh?: string;
  };
  subscribedAt: string;
  userAgent?: string;
};

export type ProductionRegistrationStatus = "pending" | "approved" | "rejected";

export type ProductionRegistrationRequest = {
  id: string;
  name: string;
  phone: string;
  note: string;
  status: ProductionRegistrationStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  employeeId?: string;
};

export type ProductionRegistrationLink = {
  id: string;
  token: string;
  createdAt: string;
  createdBy: string;
  active: boolean;
  usedAt?: string;
  usedByRegistrationId?: string;
};

export type ProductionAssignmentStatus =
  | "assigned"
  | "inProgress"
  | "submitted"
  | "readyForShipment";

export type ProductionPhotoKind = "lit" | "unlit" | "packed";

export type ProductionPhoto = {
  kind: ProductionPhotoKind;
  name: string;
  dataUrl: string;
  uploadedAt: string;
};

export type ProductionCompletion = {
  diodeCount: number;
  diodeCatalogId?: string;
  diodeCatalogTitle?: string;
  powerSupply: string;
  powerSupplyCatalogId?: string;
  powerSupplyCatalogTitle?: string;
  noPowerSupply: boolean;
  note: string;
  photos: ProductionPhoto[];
};

export type ProductionAssignmentEventType =
  | "assigned"
  | "started"
  | "submitted"
  | "readyForShipment";

export type ProductionAssignmentEvent = {
  id: string;
  type: ProductionAssignmentEventType;
  at: string;
  actor: string;
  note?: string;
};

export type ProductionAssignment = {
  id: string;
  dealId: string;
  techSpecItemId?: string;
  employeeId: string;
  status: ProductionAssignmentStatus;
  assignedAt: string;
  assignedBy: string;
  notificationText: string;
  startedAt?: string;
  submittedAt?: string;
  readyForShipmentAt?: string;
  completion?: ProductionCompletion;
  history: ProductionAssignmentEvent[];
};

export type ProductionPayout = {
  id: string;
  employeeId: string;
  amount: number;
  paidAt: string;
  paidBy: string;
  note?: string;
};

export type StoredProduction = {
  generatedAt: string;
  employees: ProductionEmployee[];
  registrations: ProductionRegistrationRequest[];
  registrationLinks: ProductionRegistrationLink[];
  assignments: ProductionAssignment[];
  payouts: ProductionPayout[];
};
