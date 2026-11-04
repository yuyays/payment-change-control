import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import { UsersResponse } from "../schemas/user.js";
import { UsersListError } from "./errors.js";

export { UsersListError } from "./errors.js";

export const HealthResponse = Schema.Struct({
  ok: Schema.Boolean,
  service: Schema.Literal("api"),
});

export type HealthResponse = typeof HealthResponse.Type;

export class HealthApi extends HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("get", "/health", { success: HealthResponse }),
) {}

export class UsersApi extends HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("list", "/users", {
    success: UsersResponse,
    error: UsersListError.pipe(HttpApiSchema.status(500)),
  }),
) {}

export class StarterApi extends HttpApi.make("starter-api")
  .add(HealthApi)
  .add(UsersApi)
  .prefix("/api") {}
