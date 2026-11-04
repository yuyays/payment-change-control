import { queryOptions } from "@tanstack/react-query";
import { Effect } from "effect";
import { apiClient } from "./api-client.js";

export const usersQueryOptions = queryOptions({
  queryKey: ["users"],
  queryFn: () => Effect.runPromise(apiClient.users.list({})),
});
