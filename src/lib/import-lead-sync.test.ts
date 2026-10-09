import assert from "node:assert/strict";
import { hasPersistedTypeOverride, readTypeOverride } from "@/lib/leads/lead-type-fields";
import { resolveEffectiveInquiryType } from "@/lib/leads/lead-inquiry-type";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("type_override wins over import row typ", () => {
  const t = resolveEffectiveInquiryType(
    { typ: "Obecná poptávka" },
    { type_override: "Montované domy", source_type: "Obecná poptávka" }
  );
  assert.equal(t, "Montované domy");
});

test("legacy inquiryTypeManual + typ_poptavky still works", () => {
  assert.equal(
    readTypeOverride({ inquiryTypeManual: true, typ_poptavky: "Pergoly" }),
    "Pergoly"
  );
});

test("hasPersistedTypeOverride detects override", () => {
  assert.equal(hasPersistedTypeOverride({ type_override: "Garáže" }), true);
  assert.equal(hasPersistedTypeOverride({ source_type: "Obecné" }), false);
});
