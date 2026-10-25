import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { ChatWorkIntentProposal } from "@/lib/chat/chat-work-intent-types";
import { normalizePhoneDigits } from "@/lib/job-create-customer-validation";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type CustomerRow = {
  id: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
};

function customerLabel(c: CustomerRow): string {
  return (
    String(c.companyName ?? "").trim() ||
    `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() ||
    c.id
  );
}

export async function loadCustomersForMatching(
  db: Firestore,
  companyId: string,
  limit = 400
): Promise<CustomerRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("customers")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as CustomerRow[];
}

export function matchCustomerForProposal(
  proposal: ChatWorkIntentProposal,
  customers: CustomerRow[]
): ChatWorkIntentProposal["customerMatch"] {
  const email = String(proposal.email ?? "").trim().toLowerCase();
  const phone = normalizePhoneDigits(String(proposal.phone ?? ""));
  const name = norm(
    String(proposal.customerName ?? proposal.companyName ?? "").trim()
  );

  if (email) {
    const hit = customers.find((c) => String(c.email ?? "").trim().toLowerCase() === email);
    if (hit) {
      return { customerId: hit.id, label: customerLabel(hit), matchReason: "shoda e-mailu" };
    }
  }
  if (phone.length >= 9) {
    const hit = customers.find(
      (c) => normalizePhoneDigits(String(c.phone ?? "")) === phone
    );
    if (hit) {
      return { customerId: hit.id, label: customerLabel(hit), matchReason: "shoda telefonu" };
    }
  }
  if (name.length >= 3) {
    const hit = customers.find((c) => {
      const lbl = norm(customerLabel(c));
      return lbl.includes(name) || name.includes(lbl);
    });
    if (hit) {
      return { customerId: hit.id, label: customerLabel(hit), matchReason: "shoda jména" };
    }
  }
  return null;
}

type JobRow = { id: string; name?: string; customerName?: string; customerId?: string };

export async function loadRecentJobs(
  db: Firestore,
  companyId: string,
  limit = 200
): Promise<JobRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get()
    .catch(async () => {
      const fallback = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .limit(limit)
        .get();
      return fallback;
    });
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as JobRow[];
}

export function matchJobsForProposal(
  proposal: ChatWorkIntentProposal,
  jobs: JobRow[],
  customerId?: string | null
): NonNullable<ChatWorkIntentProposal["jobMatches"]> {
  const name = norm(String(proposal.customerName ?? proposal.companyName ?? ""));
  const title = norm(String(proposal.jobTitle ?? ""));

  const scored = jobs
    .map((j) => {
      let score = 0;
      if (customerId && j.customerId === customerId) score += 0.5;
      const cn = norm(String(j.customerName ?? ""));
      if (name && cn && (cn.includes(name) || name.includes(cn))) score += 0.35;
      const jn = norm(String(j.name ?? ""));
      if (title && jn && (jn.includes(title) || title.includes(jn))) score += 0.25;
      return { jobId: j.id, name: String(j.name ?? j.id), customerName: j.customerName, score };
    })
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored;
}

export function enrichProposalCompletion(
  proposal: ChatWorkIntentProposal,
  requireCustomerForJob: boolean
): ChatWorkIntentProposal {
  const missing = [...(proposal.missingFields ?? [])];
  if (proposal.kind === "new_job" && requireCustomerForJob && !proposal.customerMatch) {
    if (!proposal.email?.trim() && !missing.includes("E-mail")) missing.push("E-mail");
    if (!proposal.phone?.trim() && !missing.includes("Telefon")) missing.push("Telefon");
    if (!proposal.address?.trim() && !missing.includes("Adresa")) missing.push("Adresa");
    const nm = proposal.customerName ?? proposal.companyName;
    if (!nm?.trim() && !missing.includes("Jméno zákazníka")) missing.push("Jméno zákazníka");
  }
  const completionStatus = missing.length ? "needs_input" : "complete";
  return { ...proposal, missingFields: missing, completionStatus };
}
