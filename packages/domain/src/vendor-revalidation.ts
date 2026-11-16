import type { Vendor } from "./types.js";

export type VendorChangeField = "bankAccount" | "registeredDomain" | "phoneOnFile";

/** Compare trusted master data, never values extracted from the email. */
export function vendorChanges(snapshot: Vendor, current: Vendor): ReadonlyArray<VendorChangeField> {
  const changed: VendorChangeField[] = [];
  if (
    snapshot.bankAccount.bankName !== current.bankAccount.bankName ||
    snapshot.bankAccount.iban !== current.bankAccount.iban
  ) {
    changed.push("bankAccount");
  }
  if (snapshot.registeredDomain !== current.registeredDomain) changed.push("registeredDomain");
  if (snapshot.phoneOnFile !== current.phoneOnFile) changed.push("phoneOnFile");
  return changed;
}
