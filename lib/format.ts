import type { CartStatus } from "@/lib/types";

export function statusText(status: CartStatus) {
  if (status === "CHECKED_OUT") return "Paid & Completed";
  if (status === "PAYMENT_PENDING") return "Payment Pending at Counter";
  if (status === "BILL_GENERATED") return "Bill Generated";
  if (status === "FLAGGED_MISMATCH") return "Weight Mismatch";
  return "Shopping Active";
}

export function inr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function grams(value: number) {
  return `${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 1,
  }).format(value)} g`;
}

export function clock(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function fullDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
