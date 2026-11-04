import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { StarterApi } from "@pcc/contracts/http";
import { Effect } from "effect";

const baseUrl = import.meta.env.VITE_API_URL ?? "";

export const apiClient = Effect.runSync(
  HttpApiClient.make(StarterApi, { baseUrl }).pipe(Effect.provide(FetchHttpClient.layer)),
);
