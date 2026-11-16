import { describe, expect, it } from "vite-plus/test";
import { vendorChanges } from "./vendor-revalidation.js";
import type { Vendor } from "./types.js";

const vendor: Vendor = {
  id: "v1",
  name: "Vendor",
  registeredDomain: "vendor.example",
  phoneOnFile: "+1234",
  bankAccount: { bankName: "Bank", iban: "ABC" },
  lastBankChangeAt: null,
};

describe("vendorChanges", () => {
  it("ignores non-critical metadata", () => {
    expect(vendorChanges(vendor, { ...vendor, name: "New name", lastBankChangeAt: 123 })).toEqual(
      [],
    );
  });
  it("reports all critical changes without exposing account values", () => {
    expect(
      vendorChanges(vendor, {
        ...vendor,
        registeredDomain: "new.example",
        phoneOnFile: "+5678",
        bankAccount: { bankName: "Other", iban: "DEF" },
      }),
    ).toEqual(["bankAccount", "registeredDomain", "phoneOnFile"]);
  });
  it("compares conservatively rather than silently normalizing changes", () => {
    expect(vendorChanges(vendor, { ...vendor, registeredDomain: "VENDOR.example" })).toEqual([
      "registeredDomain",
    ]);
  });
});
