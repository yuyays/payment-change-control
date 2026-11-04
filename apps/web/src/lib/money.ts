import type { Money } from "./api.js";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function formatMoney(money: Money): string {
  const digits = ZERO_DECIMAL.has(money.currency) ? 0 : 2;
  const value = money.minor / 10 ** digits;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
