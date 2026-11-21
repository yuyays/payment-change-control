import { expect, it } from "vite-plus/test";

it("uppercases the Caldero trial marker", () => {
  expect("caldero-ci-trial".toUpperCase()).toBe("CALDERO-CI-TRIAL");
});
