import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { extractEmailAddress, resolveCustomerByEmail } from "@/lib/email-mailbox/contact-resolve";

export type EmailLinkSuggestion = {
  customerId: string | null;
  customerName: string | null;
  jobId: string | null;
  jobLabel: string | null;
  confidence: "low" | "medium" | "high";
  reason: string;
};

const JOB_NUMBER_RE = /\b([KkZzPp]-?\d{4}-?\d{2,6})\b/g;

export async function suggestEmailJobLinks(
  db: Firestore,
  companyId: string,
  input: { from: string; subject: string; textBody?: string | null }
): Promise<EmailLinkSuggestion> {
  const text = `${input.subject}\n${input.textBody ?? ""}`;
  const empty: EmailLinkSuggestion = {
    customerId: null,
    customerName: null,
    jobId: null,
    jobLabel: null,
    confidence: "low",
    reason: "bez shody",
  };

  const customer = await resolveCustomerByEmail(db, companyId, input.from);
  let customerId = customer?.customerId ?? null;
  let customerName = customer?.customerName ?? null;

  const jobNumbers = [...text.matchAll(JOB_NUMBER_RE)].map((m) => m[1]!.toUpperCase());
  if (jobNumbers.length) {
    const num = jobNumbers[0]!;
    const jobsCol = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs");
    const byOrder = await jobsCol.where("orderNumber", "==", num).limit(1).get().catch(() => null);
    const snap =
      byOrder && !byOrder.empty
        ? byOrder
        : await jobsCol
            .where("orderNumber", "==", num.replace(/-/g, ""))
            .limit(1)
            .get()
            .catch(async () => jobsCol.limit(0).get());

    if (!snap.empty) {
      const doc = snap.docs[0]!;
      const d = doc.data() as {
        title?: string;
        name?: string;
        orderNumber?: string;
        customerId?: string;
      };
      const label =
        [d.orderNumber, d.title ?? d.name].filter(Boolean).join(" – ") || doc.id;
      return {
        customerId: d.customerId ?? customerId,
        customerName,
        jobId: doc.id,
        jobLabel: label,
        confidence: "high",
        reason: `číslo zakázky v textu (${num})`,
      };
    }
  }

  if (customerId) {
    const email = extractEmailAddress(input.from);
    const jobsCol = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("jobs");
    const snap = await jobsCol
      .where("customerId", "==", customerId)
      .orderBy("updatedAt", "desc")
      .limit(3)
      .get()
      .catch(async () => jobsCol.where("customerId", "==", customerId).limit(3).get());

    if (!snap.empty) {
      const doc = snap.docs[0]!;
      const d = doc.data() as { title?: string; name?: string; orderNumber?: string };
      const label =
        [d.orderNumber, d.title ?? d.name].filter(Boolean).join(" – ") || doc.id;
      return {
        customerId,
        customerName,
        jobId: doc.id,
        jobLabel: label,
        confidence: "medium",
        reason: `zákazník dle e-mailu (${email})`,
      };
    }
    return {
      customerId,
      customerName,
      jobId: null,
      jobLabel: null,
      confidence: "medium",
      reason: `známý zákazník (${customerName ?? email})`,
    };
  }

  return empty;
}
