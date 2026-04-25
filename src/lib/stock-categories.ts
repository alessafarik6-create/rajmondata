export type StockCategoryDoc = {
  id: string;
  companyId: string;
  name: string;
  order: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
};

export const DEFAULT_STOCK_CATEGORIES: { name: string; order: number }[] = [
  { name: "Pergoly", order: 10 },
  { name: "Zasklení", order: 20 },
  { name: "Příslušenství", order: 30 },
  { name: "Materiál", order: 40 },
  { name: "Spojovací materiál", order: 50 },
  { name: "Ostatní", order: 60 },
];

