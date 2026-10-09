import assert from "node:assert/strict";
import { computeOrganizationActivityScore } from "./activity-score";
import { DEFAULT_PORTAL_ANALYTICS_SETTINGS } from "./settings";
import { mapPathToAnalyticsModule, isPortalAnalyticsEventName } from "./event-types";
import { portalAnalyticsDedupeKey } from "./pseudonym";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("mapPathToAnalyticsModule jobs", () => {
  assert.equal(mapPathToAnalyticsModule("/portal/jobs/abc"), "jobs");
  assert.equal(mapPathToAnalyticsModule("/portal/leads"), "leads");
});

test("event name whitelist", () => {
  assert.equal(isPortalAnalyticsEventName("module_opened"), true);
  assert.equal(isPortalAnalyticsEventName("password"), false);
});

test("dedupe key stable", () => {
  const a = portalAnalyticsDedupeKey({
    organizationId: "org1",
    userHash: "abc",
    event: "module_opened",
    moduleId: "jobs",
    minuteBucket: "2026-01-01T10:00",
  });
  const b = portalAnalyticsDedupeKey({
    organizationId: "org1",
    userHash: "abc",
    event: "module_opened",
    moduleId: "jobs",
    minuteBucket: "2026-01-01T10:00",
  });
  assert.equal(a, b);
});

test("activity score favors per-user not only size", () => {
  const settings = DEFAULT_PORTAL_ANALYTICS_SETTINGS;
  const small = computeOrganizationActivityScore(
    {
      userAccounts: 3,
      activeDays30: 20,
      activeUsers30: 3,
      logins30: 40,
      moduleOpens30: 120,
      businessOps30: 30,
      periodDays: 30,
    },
    settings
  );
  const largeIdle = computeOrganizationActivityScore(
    {
      userAccounts: 80,
      activeDays30: 2,
      activeUsers30: 5,
      logins30: 10,
      moduleOpens30: 40,
      businessOps30: 5,
      periodDays: 30,
    },
    settings
  );
  assert.ok(small.score > largeIdle.score);
  assert.ok(small.score >= settings.activityScore.mediumMin);
  assert.ok(largeIdle.score < small.score);
});
