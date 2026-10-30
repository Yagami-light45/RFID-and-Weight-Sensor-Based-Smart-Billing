export type CartOperationalStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";

export type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

export type CartStatus = "ACTIVE" | "CHECKED_OUT" | "FLAGGED_MISMATCH";

export type ScanAction = "ADD" | "REMOVE";

export type ScanResult = "SUCCESS" | "MISMATCH" | "UNKNOWN_TAG" | "DUPLICATE";

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
  reference: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  discount: number;
  finalTotal: number;
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

export type OverviewPayload = {
  totalRevenue: number;
  activeSessions: number;
  flaggedCarts: number;
  carts: CartPayload[];
};

export type PaymentMethod = "UPI" | "CARD";
