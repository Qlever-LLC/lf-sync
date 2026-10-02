import { assertEquals } from "jsr:@std/assert@1.0.14";
import { classifySubmitFailure } from "./retry_policy.ts";

Deno.test("classifySubmitFailure retries transient Trellis and timeout failures", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  const decision = classifySubmitFailure(new Error("Trellis could not complete the request."), 1, now);
  assertEquals(decision.retryable, true);
  assertEquals(decision.classification, "transient");
  assertEquals(decision.retryAt instanceof Date, true);
});

Deno.test("classifySubmitFailure retries temporary capability reachability failures", () => {
  const decision = classifySubmitFailure(new Error("Trellis could not reach the requested capability."), 1);
  assertEquals(decision.retryable, true);
  assertEquals(decision.classification, "transient");
});

Deno.test("classifySubmitFailure does not retry configuration or permission failures", () => {
  const decision = classifySubmitFailure(new Error("Access denied [9013]"), 1);
  assertEquals(decision.retryable, false);
  assertEquals(decision.classification, "permanent");
});
