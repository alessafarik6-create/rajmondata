import assert from "node:assert/strict";
import {
  enrichProposalCompletion,
  matchCustomerForProposal,
} from "@/lib/chat/chat-work-intent-matching";
import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

const customers = [
  {
    id: "c1",
    companyName: "Novák s.r.o.",
    email: "novak@example.cz",
    phone: "+420 777 123 456",
  },
  { id: "c2", firstName: "Jan", lastName: "Svoboda", phone: "608111222" },
];

test("matchCustomerForProposal by email", () => {
  const p: ChatWorkIntentProposal = {
    proposalId: "p1",
    kind: "new_job",
    confidence: 0.9,
    jobTitle: "Pergola",
    customerName: null,
    companyName: null,
    phone: null,
    email: "novak@example.cz",
    address: null,
    description: null,
    budgetText: null,
    scheduledDate: null,
    scheduledTime: null,
    dateNeedsConfirmation: false,
    assignedEmployeeHint: null,
    missingFields: [],
    sourceQuote: null,
  };
  const m = matchCustomerForProposal(p, customers);
  assert.equal(m?.customerId, "c1");
  assert.equal(m?.matchReason, "shoda e-mailu");
});

test("enrichProposalCompletion marks missing fields", () => {
  const p: ChatWorkIntentProposal = {
    proposalId: "p2",
    kind: "new_job",
    confidence: 0.8,
    jobTitle: "Oprava",
    customerName: "Neznámý",
    companyName: null,
    phone: null,
    email: null,
    address: null,
    description: null,
    budgetText: null,
    scheduledDate: null,
    scheduledTime: null,
    dateNeedsConfirmation: false,
    assignedEmployeeHint: null,
    missingFields: [],
    sourceQuote: null,
  };
  const enriched = enrichProposalCompletion(p, true);
  assert.equal(enriched.completionStatus, "needs_input");
  assert.ok(enriched.missingFields.length > 0);
});
