import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { requirePortalModuleAccess } from "@/lib/portal-permissions-server";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import {
  createLeadReminderDoc,
  serializeLeadReminder,
} from "@/lib/leads/lead-reminder-api-server";
import {
  localDateTimeFromParts,
  resolveLeadReminderQuickPreset,
  type LeadReminderQuickPresetId,
} from "@/lib/leads/lead-reminder-datetime";
import { listLeadReminderDocs } from "@/lib/leads/lead-reminder-list-server";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const perm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "read");
    if (!perm.ok) {
      return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
    }

    const companyId = String(
      request.nextUrl.searchParams.get("companyId") ?? auth.caller.companyId
    ).trim();
    if (companyId !== auth.caller.companyId && !auth.caller.globalRoles.includes("super_admin")) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }

    const leadKey = String(request.nextUrl.searchParams.get("leadKey") ?? "").trim();
    const mineOnly = request.nextUrl.searchParams.get("mine") === "1";
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 100)));

    const docs = await listLeadReminderDocs(auth.db, companyId, {
      leadKey: leadKey || undefined,
      assignedUserId: mineOnly ? auth.caller.uid : undefined,
      limit,
    });
    const reminders = docs.map((d) =>
      serializeLeadReminder(d.id, d.data() as Record<string, unknown>)
    );

    return NextResponse.json({ ok: true, reminders });
  } catch (err) {
    console.error("[lead-reminders GET]", err);
    return NextResponse.json(
      { ok: false, error: "Připomínky se nepodařilo načíst." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const perm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "write");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (companyId !== auth.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const leadKey = String(body.leadKey ?? "").trim();
  if (!leadKey) {
    return NextResponse.json({ ok: false, error: "Chybí poptávka." }, { status: 400 });
  }

  let remindAt: Date | null = null;
  const preset = String(body.preset ?? "").trim() as LeadReminderQuickPresetId;
  if (preset && ["15m", "30m", "1h", "today_11", "tomorrow_9"].includes(preset)) {
    remindAt = resolveLeadReminderQuickPreset(preset);
  } else if (body.remindAtIso && !Number.isNaN(Date.parse(String(body.remindAtIso)))) {
    remindAt = new Date(String(body.remindAtIso));
  } else {
    const dateYmd = String(body.dateYmd ?? "").trim();
    const hour = Number(body.hour ?? 0);
    const minute = Number(body.minute ?? 0);
    remindAt = localDateTimeFromParts(dateYmd, hour, minute);
  }

  if (!remindAt || Number.isNaN(remindAt.getTime())) {
    return NextResponse.json({ ok: false, error: "Neplatný termín připomenutí." }, { status: 400 });
  }
  if (remindAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ ok: false, error: "Termín musí být v budoucnosti." }, { status: 400 });
  }

  const assignedUserId = String(body.assignedUserId ?? auth.caller.uid).trim();

  try {
    const { id } = await createLeadReminderDoc(auth.db, companyId, auth.caller, {
      leadKey,
      importLeadId: String(body.importLeadId ?? leadKey).trim(),
      customerName: String(body.customerName ?? "—").trim(),
      inquiryTitle: String(body.inquiryTitle ?? "Poptávka").trim(),
      assignedUserId,
      note: String(body.note ?? "").trim(),
      remindAt,
    });

    const snap = await auth.db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(LEAD_REMINDERS_SUBCOLLECTION)
      .doc(id)
      .get();

    return NextResponse.json({
      ok: true,
      reminder: serializeLeadReminder(id, (snap.data() ?? {}) as Record<string, unknown>),
      remindAt: remindAt.toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg || "Uložení selhalo." }, { status: 400 });
  }
}
