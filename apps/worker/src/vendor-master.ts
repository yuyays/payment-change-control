import type { Vendor } from "@pcc/domain";

/** Keys are vendor IDs. Only trusted master-data tooling may write this namespace. */
export async function readVendorMaster(master: KVNamespace, vendorId: string): Promise<Vendor> {
  const value = await master.get(vendorId, "json");
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    value.id !== vendorId ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("registeredDomain" in value) ||
    typeof value.registeredDomain !== "string" ||
    !("phoneOnFile" in value) ||
    typeof value.phoneOnFile !== "string" ||
    !("bankAccount" in value) ||
    typeof value.bankAccount !== "object" ||
    value.bankAccount === null ||
    !("bankName" in value.bankAccount) ||
    typeof value.bankAccount.bankName !== "string" ||
    !("iban" in value.bankAccount) ||
    typeof value.bankAccount.iban !== "string" ||
    !("lastBankChangeAt" in value) ||
    !(
      value.lastBankChangeAt === null ||
      (typeof value.lastBankChangeAt === "number" && Number.isFinite(value.lastBankChangeAt))
    )
  ) {
    throw new Error("Vendor master missing or invalid");
  }
  return {
    id: vendorId,
    name: value.name,
    registeredDomain: value.registeredDomain,
    phoneOnFile: value.phoneOnFile,
    bankAccount: { bankName: value.bankAccount.bankName, iban: value.bankAccount.iban },
    lastBankChangeAt: value.lastBankChangeAt,
  };
}
