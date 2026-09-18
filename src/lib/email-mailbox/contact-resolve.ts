import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

const EMAIL_RE = /<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/;

export function extractEmailAddress(fromField: string): string {
  const m = String(fromField ?? "").match(EMAIL_RE);
  return (m?.[1] ?? fromField).trim().toLowerCase();
}

export async function resolveCustomerByEmail(
  db: Firestore,
  companyId: string,
  emailRaw: string
): Promise<{ customerId: string; customerName: string } | null> {
  const email = extractEmailAddress(emailRaw);
  if (!email) return null;

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("customers")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (!snap.empty) {
    const doc = snap.docs[0]!;
    const d = doc.data() as { firstName?: string; lastName?: string; companyName?: string };
    const name =
      [d.firstName, d.lastName].filter(Boolean).join(" ").trim() ||
      String(d.companyName ?? "").trim() ||
      email;
    return { customerId: doc.id, customerName: name };
  }

  const snap2 = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("customers")
    .where("emailLower", "==", email)
    .limit(1)
    .get();

  if (snap2.empty) return null;
  const doc = snap2.docs[0]!;
  const d = doc.data() as { firstName?: string; lastName?: string; companyName?: string };
  const name =
    [d.firstName, d.lastName].filter(Boolean).join(" ").trim() ||
    String(d.companyName ?? "").trim() ||
    email;
  return { customerId: doc.id, customerName: name };
}

export async function resolveJobHint(
  db: Firestore,
  companyId: string,
  customerId: string
): Promise<{ jobId: string; jobLabel: string } | null> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .where("customerId", "==", customerId)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get()
    .catch(async () => {
      const fallback = await db
        .collection(COMPANIES_COLLECTION)
        .doc(companyId)
        .collection("jobs")
        .where("customerId", "==", customerId)
        .limit(1)
        .get();
      return fallback;
    });

  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  const d = doc.data() as { title?: string; name?: string; orderNumber?: string };
  const label =
    [d.orderNumber, d.title ?? d.name].filter(Boolean).join(" – ") || doc.id;
  return { jobId: doc.id, jobLabel: label };
}
