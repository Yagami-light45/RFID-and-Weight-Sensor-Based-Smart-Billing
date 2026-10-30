import type { CartStatus } from "@/lib/types";

export function statusText(status: CartStatus) {
  if (status === "CHECKED_OUT") return "Checked out";
  if (status === "FLAGGED_MISMATCH") return "Flagged";
  return "Active";
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
