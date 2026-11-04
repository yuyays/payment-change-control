import { describe, expect, it } from "vite-plus/test";
import { usersQueryOptions } from "./users.js";

describe("users query", () => {
  it("keeps a stable cache key for route prefetching", () => {
    expect(usersQueryOptions.queryKey).toEqual(["users"]);
  });
});
