import { describe, expect, it } from "vite-plus/test";
import { Schema } from "effect";
import { UsersListError } from "../http/errors.js";
import { User, UserId } from "./user.js";

describe("User schema", () => {
  it("decodes a valid user", () => {
    const user = Schema.decodeUnknownSync(User)({
      id: "8c2f3558-1ec5-4b87-b7af-7ad83f8c7778",
      name: "Ada",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(user.name).toBe("Ada");
  });

  it("preserves UUID shape validation without requiring version or variant bits", () => {
    const user = Schema.decodeUnknownSync(User)({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Ada",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(user.id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it.each([
    "not-a-uuid",
    "00000000000000000000000000000001",
    "g0000000-0000-0000-0000-000000000001",
  ])("rejects malformed UUID %s", (id) => {
    expect(() => Schema.decodeUnknownSync(UserId)(id)).toThrow();
  });

  it("decodes the typed users list error", () => {
    const error = Schema.decodeUnknownSync(UsersListError)({
      _tag: "UsersListError",
      message: "Failed to list users",
    });

    expect(error).toBeInstanceOf(UsersListError);
    expect(error.message).toBe("Failed to list users");
  });
});
