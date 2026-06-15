export type Item = {
  itemNo: string;
  description: string;
  description2?: string;
  barcode: string;
  baseUom?: string;
  stock?: number;
};

export type LedgerEntry = {
  entryNo: number;
  postingDate?: string;
  entryType?: string;
  documentType?: string;
  documentNo?: string;
  externalDocNo?: string;
  itemNo: string;
  description?: string;
  lotNo: string;
  expirationDate?: string;
  locationCode: string;
  quantity: number;
  remainingQuantity: number;
  uom?: string;
};

export type TransferLine = {
  itemNo: string;
  description?: string;
  quantity: number;
  lotNo: string;
  expirationDate?: string;
  uom?: string;
  alreadyExp: boolean; // true if this lot is already at 60008-EXP
};

export type Transfer = {
  id: string;
  externalDocNo?: string;
  storeFrom: string;
  locationFrom: string;
  storeTo: string;
  locationTo: string;
  createdAt: string;
  closedAt?: string;
  closed: boolean;
  cartonNo?: string;
  note?: string;
  lines: TransferLine[];
};

export type StockSummary = {
  itemNo: string;
  description?: string;
  barcode?: string;
  lots: Array<{
    lotNo: string;
    expirationDate?: string;
    locationCode: string;
    remaining: number;
    uom?: string;
  }>;
};
