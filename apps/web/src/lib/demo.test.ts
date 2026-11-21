import { afterEach, expect, it, vi } from "vite-plus/test";
import { seedAll } from "./demo.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads existing demo requests and surfaces other intake conflicts", async () => {
  const seed = vi.fn<typeof fetch>(async () =>
    Response.json({ error: "request_already_exists" }, { status: 409 }),
  );
  vi.stubGlobal("fetch", seed);

  await expect(seedAll()).resolves.toBeUndefined();
  expect(seed).toHaveBeenCalledTimes(6);

  seed.mockImplementation(async () =>
    Response.json({ error: "different_conflict" }, { status: 409 }),
  );
  await expect(seedAll()).rejects.toThrow("different_conflict");
});
