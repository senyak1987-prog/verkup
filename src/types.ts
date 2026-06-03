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
  note?: string;
  calcMode?: CostCalcMode;
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
