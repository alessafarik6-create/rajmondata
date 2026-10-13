import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePresenceState, PRESENCE_ONLINE_MS, PRESENCE_IDLE_MS } from "@/lib/analytics-realtime/presence-eval";

describe("presence-eval", () => {
  it("online within threshold", () => {
    const now = 1_000_000;
    assert.equal(resolvePresenceState(now - 10_000, now - 10_000, now), "online");
  });

  it("idle after online window", () => {
    const now = 1_000_000;
    const seen = now - PRESENCE_ONLINE_MS - 1_000;
    assert.equal(resolvePresenceState(seen, seen, now), "idle");
  });

  it("offline when stale", () => {
    const now = 1_000_000;
    const seen = now - PRESENCE_IDLE_MS - 60_000;
    assert.equal(resolvePresenceState(seen, seen, now), "offline");
  });
});
