import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Vendor } from "@pcc/domain";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected ctx: DurableObjectState,
      protected env: unknown,
    ) {}
  },
}));

import { ChangeRequestDO } from "./ChangeRequestDO.js";
import type { Env } from "./index.js";

const vendor: Vendor = {
  id: "v1",
  name: "Vendor",
  registeredDomain: "vendor.example",
  phoneOnFile: "+1234",
  bankAccount: { bankName: "Bank", iban: "ABC" },
  lastBankChangeAt: null,
};

function harness() {
  const records = new Map<string, unknown>();
  const events: { type: string; payload: unknown }[] = [];
  const setAlarm = vi.fn<(at: number) => Promise<void>>();
  const get = vi.fn<(id: string, format: "json") => Promise<unknown>>().mockResolvedValue(vendor);
  const ctx = {
    blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
    storage: {
      get: async (key: string) => records.get(key),
      put: async (key: string, value: unknown) => {
        records.set(key, value);
      },
      setAlarm,
      transaction: async (fn: () => Promise<unknown>) => fn(),
      sql: {
        exec: (sql: string, ...args: unknown[]) => {
          if (sql.startsWith("INSERT"))
            events.push({ type: String(args[1]), payload: JSON.parse(String(args[2])) });
        },
      },
    },
  };
  const object = new ChangeRequestDO(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test double implements only the storage methods exercised by this DO.
    ctx as unknown as DurableObjectState,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Other bindings are unused by the lifecycle under test.
    { VENDOR_MASTER: { get }, COOLING_OFF_SECONDS: "1" } as unknown as Env,
  );
  const intake = () =>
    object.fetch(
      new Request("https://do/intake", {
        method: "POST",
        body: JSON.stringify({
          vendor,
          request: {
            id: "r1",
            vendorId: vendor.id,
            receivedAt: Date.now(),
            rawBody: "ABC",
            extraction: {
              fromAddress: "a@vendor.example",
              replyTo: null,
              claims: [
                {
                  field: "iban",
                  value: "ABC",
                  citation: { field: "iban", start: 0, end: 3, quote: "ABC" },
                },
              ],
            },
          },
        }),
      }),
    );
  const approve = (approverId: string) =>
    object.fetch(
      new Request("https://do/approve", {
        method: "POST",
        body: JSON.stringify({ approverId }),
      }),
    );
  return { object, intake, approve, records, events, get, setAlarm };
}

describe("cooling-off master revalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches and audits unchanged data, leaving the intake snapshot intact", async () => {
    const h = harness();
    await h.intake();
    vi.advanceTimersByTime(1000);
    await h.object.alarm();
    expect(h.get).toHaveBeenCalledWith("v1", "json");
    expect(h.records.get("state")).toMatchObject({ status: "ready_for_review", vendor });
    expect(h.events).toContainEqual({
      type: "vendor.revalidated",
      payload: { vendorId: "v1", changedFields: [] },
    });
    await h.object.alarm();
    expect(h.get).toHaveBeenCalledTimes(1);
    await h.approve("one");
    expect((await h.approve("two")).status).toBe(200);
    await h.object.alarm();
    expect(h.records.get("state")).toMatchObject({ status: "approved" });
  });

  it.each([
    { bankAccount: { bankName: "Other", iban: "ABC" } },
    { bankAccount: { bankName: "Bank", iban: "OTHER" } },
    { registeredDomain: "other.example" },
    { phoneOnFile: "+5678" },
  ])("invalidates on critical change %j and cannot be approved", async (change) => {
    const h = harness();
    await h.intake();
    h.get.mockResolvedValue({ ...vendor, ...change });
    vi.advanceTimersByTime(1000);
    await h.object.alarm();
    expect(h.records.get("state")).toMatchObject({
      status: "invalidated",
      invalidationReason: "vendor.changed_mid_flow",
      vendor,
    });
    expect(h.events.some((e) => e.type === "vendor.changed_mid_flow")).toBe(true);
    expect((await h.approve("one")).status).toBe(409);
    expect((await h.approve("two")).status).toBe(409);
    await h.object.alarm();
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it("does not release requests merely because the clock elapsed", async () => {
    const h = harness();
    await h.intake();
    vi.advanceTimersByTime(1000);
    expect((await h.approve("one")).status).toBe(409);
    expect((await h.approve("two")).status).toBe(409);
  });

  it.each([null, { id: "wrong" }, { ...vendor, bankAccount: null }])(
    "fails closed on missing/invalid master %j and retries",
    async (value) => {
      const h = harness();
      await h.intake();
      h.get.mockResolvedValue(value);
      vi.advanceTimersByTime(1000);
      await h.object.alarm();
      expect(h.records.get("state")).toMatchObject({ status: "cooling_off" });
      expect(h.events.at(-1)?.type).toBe("vendor.revalidation_failed");
      expect(h.setAlarm).toHaveBeenLastCalledWith(71_000);
      h.get.mockResolvedValue(vendor);
      await h.object.alarm();
      expect(h.records.get("state")).toMatchObject({ status: "ready_for_review" });
    },
  );

  it("keeps pending on master I/O failure", async () => {
    const h = harness();
    await h.intake();
    vi.advanceTimersByTime(1000);
    h.get.mockRejectedValue(new Error("unavailable"));
    await h.object.alarm();
    expect(h.records.get("state")).toMatchObject({ status: "cooling_off" });
  });
});
