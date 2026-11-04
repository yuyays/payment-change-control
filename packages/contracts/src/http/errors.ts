import { Schema } from "effect";

export class UsersListError extends Schema.TaggedError<UsersListError>()("UsersListError", {
  message: Schema.String,
}) {}
