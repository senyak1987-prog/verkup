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
  responsible: string;
  startDate: string;
  expectedFinishDate: string;
  createdDate: string;
  stageName: string;
  bitrixUrl: string;
};

export type DealStageCode = "launch" | "production";

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
