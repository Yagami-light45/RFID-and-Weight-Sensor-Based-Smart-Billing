export type CartOperationalStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";

export type SessionStatus =
  | "ACTIVE"
  | "BILL_GENERATED"
  | "PAYMENT_PENDING"
  | "COMPLETED"
  | "ABANDONED";

export type CartStatus =
  | "ACTIVE"
  | "BILL_GENERATED"
  | "PAYMENT_PENDING"
  | "CHECKED_OUT"
  | "FLAGGED_MISMATCH";

export type ScanAction = "ADD" | "REMOVE";

export type ScanResult = "SUCCESS" | "MISMATCH" | "UNKNOWN_TAG" | "DUPLICATE";

export type PaymentMethod = "CASH" | "CARD" | "UPI";

export type PaymentStatus = "PENDING" | "PAID";

export type BillStatus = "PENDING" | "PAID" | "CANCELLED";

export type CartItemPayload = {
  id: string;
  productId: string;
  rfidUid: string;
  rfidTag: string; // compatibility alias for rfidUid
  name: string;
  unitPrice: number;
  expectedWeight: number;
  weightTolerance: number;
  quantity: number;
  subtotal: number;
  lineWeight: number;
};

export type TransactionPayload = {
  id: string;
  billNumber: string;
  subtotal: number;
  tax: number;
  discount: number;
  finalTotal: number;
  billStatus: BillStatus;
  paymentMethod?: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  reference?: string | null;
  cashierConfirmedAt?: string | null;
  createdAt?: string;
  timestamp: string;
};

export type CartPayload = {
  cartId: string;
  cartCode?: string;
  operationalStatus?: CartOperationalStatus;
  sessionId?: string;
  sessionStatus?: SessionStatus;
  startedAt?: string;
  completedAt?: string | null;
  status: CartStatus;
  totalPrice: number;
  totalExpectedWeight: number;
  currentMeasuredWeight: number;
  hasMismatch: boolean;
  updatedAt: string;
  itemCount: number;
  items: CartItemPayload[];
  transaction?: TransactionPayload | null;
};

export type BillHistoryItem = {
  id: string;
  billNumber: string;
  cartId: string;
  sessionId: string;
  finalTotal: number;
  paymentMethod: string;
  cashierConfirmedAt: string;
  itemCount: number;
};

export type OverviewPayload = {
  totalRevenue: number;
  activeSessions: number;
  pendingBills: number;
  flaggedCarts: number;
  carts: CartPayload[];
  pendingBillsList?: CartPayload[];
  completedHistory?: BillHistoryItem[];
};
