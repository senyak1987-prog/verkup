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
  installationAddress?: string;
  installationClientName?: string;
  installationClientPhone?: string;
  installationComment?: string;
  installationFiles?: BitrixDealFile[];
};

export type BitrixDealFile = {
  id: string;
  name: string;
  url: string;
  downloadUrl?: string;
  type?: "image" | "file";
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
  | "installationChief"
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

export type ProductionWorkerStatus =
  | "new"
  | "inWork"
  | "photosAdded"
  | "reviewPending"
  | "checked"
  | "needsRevision";

export type ProductionPhotoKind = "lit" | "unlit" | "packed";

export type ProductionPhoto = {
  id?: string;
  assignmentId?: string;
  dealId?: string;
  dealNumber?: string;
  dealTitle?: string;
  employeeId?: string;
  kind: ProductionPhotoKind;
  name: string;
  originalName?: string;
  dataUrl?: string;
  url?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  size?: number;
  uploadedBy?: string;
  techSpecItemId?: string;
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
  workerStatus?: ProductionWorkerStatus;
  assignedAt: string;
  assignedBy: string;
  notificationText: string;
  startedAt?: string;
  submittedAt?: string;
  readyForShipmentAt?: string;
  photosAddedAt?: string;
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

export type ProductionNotificationType =
  | "started"
  | "photosAdded"
  | "completed"
  | "checked"
  | "needsRevision";

export type ProductionNotification = {
  id: string;
  type: ProductionNotificationType;
  dealId: string;
  dealNumber?: string;
  dealTitle?: string;
  message: string;
  actor?: string;
  actorId?: string;
  actorName?: string;
  createdAt: string;
  readBy?: string[];
  readAt?: string;
};

export type StoredProduction = {
  generatedAt: string;
  employees: ProductionEmployee[];
  registrations: ProductionRegistrationRequest[];
  registrationLinks: ProductionRegistrationLink[];
  assignments: ProductionAssignment[];
  payouts: ProductionPayout[];
  notifications?: ProductionNotification[];
};

export type InstallationStatus =
  | "not_scheduled"
  | "scheduled"
  | "assigned"
  | "in_progress"
  | "arrived"
  | "review_pending"
  | "completed"
  | "needs_revision"
  | "canceled"
  | "no_installation";

export type InstallationPhotoType = "before" | "process" | "after" | "issue";

export type InstallationPhoto = {
  id: string;
  installationId: string;
  dealId: string;
  url: string;
  thumbnailUrl?: string;
  originalName: string;
  mimeType?: string;
  size?: number;
  type: InstallationPhotoType;
  uploadedAt: string;
  uploadedBy?: string;
  uploadedById?: string;
};

export type InstallationHistoryEventType =
  | "created"
  | "assigned"
  | "updated"
  | "started"
  | "arrived"
  | "photoAdded"
  | "completed"
  | "approved"
  | "returned"
  | "canceled"
  | "noInstallation";

export type InstallationHistoryEvent = {
  id: string;
  type: InstallationHistoryEventType;
  at: string;
  actor?: string;
  actorId?: string;
  note?: string;
};

export type InstallationLocation = {
  accuracy?: number;
  capturedAt: string;
  lat: number;
  lon: number;
  source: "browser";
};

export type Installation = {
  id: string;
  dealId: string;
  dealNumber?: string;
  dealTitle?: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  address: string;
  installerId: string;
  installerName: string;
  status: InstallationStatus;
  clientName?: string;
  clientPhone?: string;
  comment?: string;
  resultComment?: string;
  returnComment?: string;
  addressEdited?: boolean;
  addressSource?: "bitrix" | "manual";
  sourceFiles?: BitrixDealFile[];
  photos: InstallationPhoto[];
  history: InstallationHistoryEvent[];
  createdAt: string;
  createdBy?: string;
  updatedAt: string;
  startedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  installerLocation?: InstallationLocation;
};

export type InstallationNotificationType =
  | "assigned"
  | "started"
  | "arrived"
  | "photoAdded"
  | "completed"
  | "approved"
  | "needsRevision"
  | "problem";

export type InstallationNotification = {
  id: string;
  type: InstallationNotificationType;
  installationId: string;
  dealId: string;
  dealNumber?: string;
  dealTitle?: string;
  message: string;
  actor?: string;
  actorId?: string;
  targetEmployeeId?: string;
  createdAt: string;
  readBy?: string[];
  readAt?: string;
};

export type StoredInstallations = {
  generatedAt: string;
  installations: Installation[];
  notifications?: InstallationNotification[];
};

export type StockTransactionType = "receipt" | "issue" | "adjustment" | "reserve" | "release";

export type StockReceiptStatus = "draft" | "parsed" | "needs_review" | "approved" | "posted" | "canceled";

export type StockDocumentType = "invoice_photo" | "invoice_pdf" | "invoice_excel";

export type StockDocumentStatus = "uploaded" | "parsing" | "parsed" | "needs_review" | "error";

export type StockReceiptItemStatus = "matched" | "unmatched" | "needs_review" | "approved";

export type PriceUpdateProposalStatus = "pending" | "approved" | "rejected";

export type MaterialStockStatus = "ok" | "low" | "empty";

export type MaterialStockItem = {
  materialId: string;
  materialName: string;
  category?: string;
  unit: string;
  quantityOnHand: number;
  reservedQuantity: number;
  availableQuantity: number;
  averagePrice: number;
  lastPurchasePrice: number;
  lastPurchaseDate?: string;
  minQuantity: number;
  supplier?: string;
  updatedAt: string;
};

export type StockTransaction = {
  id: string;
  type: StockTransactionType;
  materialId: string;
  materialName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  dealId?: string;
  documentId?: string;
  receiptId?: string;
  supplier?: string;
  comment?: string;
  createdAt: string;
  createdBy?: string;
};

export type StockReceiptItem = {
  id: string;
  materialId?: string;
  rawName: string;
  matchedMaterialName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  vat?: number;
  confidence?: number;
  status: StockReceiptItemStatus;
};

export type StockReceipt = {
  id: string;
  date: string;
  supplier?: string;
  documentNumber?: string;
  documentDate?: string;
  sourceFileId?: string;
  totalAmount: number;
  status: StockReceiptStatus;
  items: StockReceiptItem[];
  createdAt: string;
  createdBy?: string;
  postedAt?: string;
};

export type StockIssue = {
  id: string;
  date: string;
  dealId?: string;
  items: StockReceiptItem[];
  createdAt: string;
  createdBy?: string;
  comment?: string;
};

export type StockDocument = {
  id: string;
  type: StockDocumentType;
  originalName: string;
  url: string;
  size?: number;
  mimeType?: string;
  uploadedAt: string;
  uploadedBy?: string;
  processingStatus: StockDocumentStatus;
  parseError?: string;
  linkedReceiptId?: string;
};

export type PriceUpdateProposal = {
  id: string;
  materialId: string;
  materialName: string;
  oldPrice: number;
  newPrice: number;
  differencePercent: number;
  sourceReceiptId?: string;
  sourceDocumentId?: string;
  status: PriceUpdateProposalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type MaterialPriceHistory = {
  id: string;
  materialId: string;
  oldPrice: number;
  newPrice: number;
  source: "manual" | "invoice" | "stock_receipt";
  sourceDocumentId?: string;
  changedAt: string;
  changedBy?: string;
};

export type MaterialAlias = {
  id: string;
  rawName: string;
  materialId: string;
  materialName: string;
  supplier?: string;
  createdAt: string;
  createdBy?: string;
};

export type StoredWarehouse = {
  generatedAt: string;
  items: MaterialStockItem[];
  transactions: StockTransaction[];
  receipts: StockReceipt[];
  issues: StockIssue[];
  documents: StockDocument[];
  priceProposals: PriceUpdateProposal[];
  materialAliases: MaterialAlias[];
  priceHistory: MaterialPriceHistory[];
};
