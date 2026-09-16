/**
 * npx --yes tsx scripts/test-portal-assistant-registry.mjs
 */
import assert from "node:assert/strict";

import {
  buildPortalHelpRegistry,
  searchPortalHelpRegistry,
} from "../src/lib/portal-help-registry.ts";

const registry = buildPortalHelpRegistry();
assert.ok(registry.length >= 20);

const leads = searchPortalHelpRegistry("Kde jsou poptávky?", registry);
assert.ok(leads);
assert.equal(leads.route, "/portal/leads");

const jobs = searchPortalHelpRegistry("vícepráce zakázka", registry);
assert.ok(jobs);
assert.equal(jobs.module, "jobs");

console.log("test-portal-assistant-registry: OK");
