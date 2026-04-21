import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  isCompanyPrivileged,
  verifyCompanyBearer,
} from "@/lib/api-company-auth";
import { isCompanyEmployeeRole } from "@/lib/company-privilege";
import {
  employeeAssignedToJobProduction,
  parseJobProductionSettings,
} from "@/lib/job-production-settings";
import {
  canStartProductionWorkflow,
  parseProductionWorkflowStatus,
} from "@/lib/production-job-workflow";

type Body = { jobId?: string };

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
  }

  const jobRef = db.collection("companies").doc(caller.companyId).collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Zakázka neexistuje." }, { status: 404 });
  }

  const data = jobSnap.data() as Record<string, unknown>;
  const settings = parseJobProductionSettings(data);
  const assigned =
    isCompanyEmployeeRole(caller.role) &&
    caller.employeeId &&
    employeeAssignedToJobProduction(settings, caller.employeeId);
  const privileged = isCompanyPrivileged(caller.role, caller.globalRoles);
  if (!assigned && !privileged) {
    return NextResponse.json({ error: "Nemáte oprávnění k výrobě této zakázky." }, { status: 403 });
  }

  const wf = parseProductionWorkflowStatus(data);
  if (wf === "completed") {
    return NextResponse.json(
      { error: "Výroba je dokončená — nelze ji znovu zahájit bez změny stavu vedením." },
      { status: 400 }
    );
  }
  if (wf === "started" || wf === "in_progress") {
    return NextResponse.json({ error: "Výroba u této zakázky již byla zahájena." }, { status: 409 });
  }
  if (!canStartProductionWorkflow(wf)) {
    return NextResponse.json({ error: "Aktuální stav neumožňuje zahájení výroby." }, { status: 400 });
  }

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const u = userSnap.data() as Record<string, unknown> | undefined;
  const displayName =
    (typeof u?.displayName === "string" && u.displayName.trim()
      ? u.displayName.trim()
      : null) ||
    (typeof u?.email === "string" && u.email.includes("@")
      ? String(u.email).split("@")[0]
      : null) ||
    caller.uid;

  await jobRef.update({
    productionWorkflowStatus: "started",
    productionStatus: "active",
    productionStartedAt: FieldValue.serverTimestamp(),
    productionStartedBy: caller.uid,
    productionStartedByName: displayName,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, productionWorkflowStatus: "started" });
}
