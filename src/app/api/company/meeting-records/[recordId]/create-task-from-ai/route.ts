import { NextRequest, NextResponse } from "next/server";
import { requireMeetingAudioAccess } from "@/lib/meeting-audio/meeting-audio-api-auth";
import { meetingRecordsCollection } from "@/lib/meeting-audio/meeting-audio-storage";
import { createOrganizationTask } from "@/lib/tasks/create-organization-task-server";
import { logMeetingAudioAudit } from "@/lib/meeting-audio/meeting-audio-audit";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await ctx.params;
  let body: {
    companyId?: string;
    title?: string;
    description?: string;
    employeeId?: string;
    dueDate?: string;
    jobId?: string;
    jobName?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }
  const companyId = String(body.companyId ?? "").trim();
  if (!companyId || !recordId) {
    return NextResponse.json({ ok: false, error: "Chybí parametry." }, { status: 400 });
  }
  const auth = await requireMeetingAudioAccess(request, companyId);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const snap = await meetingRecordsCollection(auth.db, companyId).doc(recordId).get();
  const row = snap.data() as { jobId?: string; jobName?: string } | undefined;
  const jobId = String(body.jobId ?? row?.jobId ?? "").trim() || null;
  const jobName = String(body.jobName ?? row?.jobName ?? "").trim() || null;

  try {
    const { taskId } = await createOrganizationTask(auth.db, {
      companyId,
      createdByUserId: auth.caller.uid,
      createdVia: "meeting_record_ai",
      draft: {
        title: String(body.title ?? "").trim(),
        description: body.description != null ? String(body.description) : null,
        assignedTo: body.employeeId != null ? String(body.employeeId).trim() : null,
        assignedMode: body.employeeId ? "single" : "all",
        dueDate: body.dueDate != null ? String(body.dueDate).trim() : null,
        jobId,
        jobName,
      },
    });
    await logMeetingAudioAudit(auth.db, {
      companyId,
      userId: auth.caller.uid,
      recordId,
      action: "meeting_tasks_created",
      detail: taskId,
    });
    return NextResponse.json({ ok: true, taskId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Úkol se nepodařilo vytvořit.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
