import assert from "node:assert/strict";
import { mergeAnalysisProposals } from "@/lib/chat/chat-work-intent-merge";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("fallback from extracted text yields five proposals", () => {
  const text = `02.12 - 06.12
11.12 - 13.12
18.12 - 21.12
23.12 - 27.12
27.12 - 01.01`;
  const { proposals } = mergeAnalysisProposals({
    aiProposals: [{ proposalId: "p1", kind: "task", confidence: 0.3 } as never],
    detectedItems: [],
    documentType: "reservation_schedule",
    extractedTextPreview: text,
    referenceDate: new Date("2026-10-25"),
  });
  assert.equal(proposals.length, 5);
  assert.equal(proposals[4]!.scheduledEndDate, "2027-01-01");
});
