import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  buildJobCustomerChatContext,
  extractJobCustomerCrmId,
  extractJobCustomerEmail,
} from "@/lib/job-customer-chat-resolve";
import { normalizeEmail, isValidEmail } from "@/lib/customer-portal-email";

export const dynamic = "force-dynamic";

type Body = {
  companyId?: string;
  jobId?: string;
};

async function findPortalUidByEmail(
  db: NonNullable<ReturnType<typeof getAdminFirestore>>,
  companyId: string,
  email: string
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return null;

  const usersSnap = await db
    .collection("users")
    .where("email", "==", normalized)
    .limit(8)
    .get()
    .catch(() => null);

  if (usersSnap) {
    for (const d of usersSnap.docs) {
      const u = d.data() as Record<string, unknown>;
      if (String(u.role ?? "") !== "customer") continue;
      if (String(u.companyId ?? "") === companyId || u.companyId == null) {
        return d.id;
      }
    }
  }

  const customersCol = db.collection("companies").doc(companyId).collection("customers");
  for (const field of ["email", "customerPortalEmail"] as const) {
    const snap = await customersCol.where(field, "==", normalized).limit(3).get().catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const c = d.data() as Record<string, unknown>;
      const uid = String(c.customerPortalUid ?? "").trim();
      if (uid) return uid;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: "Server není nakonfigurován." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "Neautorizováno." }, { status: 401 });
  }

  let callerUid: string;
  try {
    callerUid = (await auth.verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "Neplatný token." }, { status: 401 });
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.data() as Record<string, unknown> | undefined;
  if (!caller) {
    return NextResponse.json({ error: "Profil neexistuje." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? caller.companyId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  if (!companyId || !jobId) {
    return NextResponse.json({ error: "Chybí companyId nebo jobId." }, { status: 400 });
  }
  if (String(caller.companyId ?? "") !== companyId) {
    return NextResponse.json({ error: "Neplatná organizace." }, { status: 403 });
  }

  const jobSnap = await db
    .collection("companies")
    .doc(companyId)
    .collection("jobs")
    .doc(jobId)
    .get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Zakázka nenalezena." }, { status: 404 });
  }
  const job = (jobSnap.data() ?? {}) as Record<string, unknown>;

  let customerDoc: Record<string, unknown> | null = null;
  let customerPortalUserDocId: string | null = null;

  const emailHint = extractJobCustomerEmail(job, null);
  let crmIdFromJob = extractJobCustomerCrmId(job, null);

  if (!crmIdFromJob && emailHint) {
    const customersCol = db.collection("companies").doc(companyId).collection("customers");
    const normalized = normalizeEmail(emailHint);
    for (const field of ["email", "customerPortalEmail"] as const) {
      const snap = await customersCol.where(field, "==", normalized).limit(1).get().catch(() => null);
      if (snap && !snap.empty) {
        crmIdFromJob = snap.docs[0]!.id;
        break;
      }
    }
  }

  if (crmIdFromJob) {
    const cSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("customers")
      .doc(crmIdFromJob)
      .get();
    if (cSnap.exists) {
      customerDoc = { id: cSnap.id, ...(cSnap.data() as Record<string, unknown>) };
      const portalUid = String(customerDoc.customerPortalUid ?? "").trim();
      if (portalUid) customerPortalUserDocId = portalUid;
    }
  }

  if (!customerPortalUserDocId && crmIdFromJob) {
    const uSnap = await db
      .collection("users")
      .where("customerRecordId", "==", crmIdFromJob)
      .where("role", "==", "customer")
      .limit(1)
      .get()
      .catch(() => null);
    if (uSnap && !uSnap.empty) {
      customerPortalUserDocId = uSnap.docs[0]!.id;
    }
  }

  const emailForLookup = extractJobCustomerEmail(job, customerDoc);
  let portalUidFromEmail: string | null = null;
  if (emailForLookup) {
    portalUidFromEmail = await findPortalUidByEmail(db, companyId, emailForLookup);
  }

  const ctx = buildJobCustomerChatContext(job, {
    customer: customerDoc,
    customerPortalUserDocId,
    portalUidFromEmailLookup: portalUidFromEmail,
  });

  return NextResponse.json({ ok: true, ...ctx });
}
