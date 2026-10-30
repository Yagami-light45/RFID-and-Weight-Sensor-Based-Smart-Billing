export type CartStatus = "ACTIVE" | "CHECKED_OUT" | "FLAGGED_MISMATCH";

export type CartItemPayload = {
  id: string;
  productId: string;
  rfidTag: string;
  name: string;
  unitPrice: number;
  expectedWeight: number;
  weightTolerance: number;
  quantity: number;
  subtotal: number;
  lineWeight: number;
};

export type CartPayload = {
  cartId: string;
  status: CartStatus;
  totalPrice: number;
  totalExpectedWeight: number;
  currentMeasuredWeight: number;
  hasMismatch: boolean;
  updatedAt: string;
  itemCount: number;
  items: CartItemPayload[];
};

export type OverviewPayload = {
  totalRevenue: number;
  activeSessions: number;
  flaggedCarts: number;
  carts: CartPayload[];
};

export type PaymentMethod = "UPI" | "CARD";
