import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { isCompanyPrivileged } from "@/lib/company-privilege";
import {
  generateContractAddendumText,
  type ContractAddendumAiMode,
} from "@/lib/ai/contract-addendum-generation-service";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  userBrief?: string;
  parentContractId?: string | null;
  existingDraft?: string;
  mode?: ContractAddendumAiMode;
};

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await ctx.params;
    const jobIdTrim = String(jobId ?? "").trim();
    if (!jobIdTrim) {
      return NextResponse.json({ ok: false, error: "Chybí jobId." }, { status: 400 });
    }

    const db = getAdminFirestore();
    const auth = getAdminAuth();
    if (!db || !auth) {
      return NextResponse.json({ ok: false, error: "Server není nakonfigurován." }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const caller = await verifyBearerAndLoadCaller(auth, db, idToken);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Neautorizováno." }, { status: 401 });
    }

    const body = (await request.json()) as Body;
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json({ ok: false, error: "Chybí companyId." }, { status: 400 });
    }
    if (!callerCanAccessCompany(caller, companyId)) {
      return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
    }
    if (!isCompanyPrivileged(caller.role, caller.globalRoles)) {
      return NextResponse.json({ ok: false, error: "Nemáte oprávnění upravovat smlouvy." }, { status: 403 });
    }

    const modeRaw = String(body.mode ?? "generate").trim();
    const mode: ContractAddendumAiMode =
      modeRaw === "improve" ? "improve" : modeRaw === "regenerate" ? "regenerate" : "generate";

    const outcome = await generateContractAddendumText({
      db,
      companyId,
      jobId: jobIdTrim,
      parentContractId: body.parentContractId != null ? String(body.parentContractId).trim() : null,
      userBrief: String(body.userBrief ?? ""),
      existingDraft: String(body.existingDraft ?? ""),
      mode,
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json({ ok: true, text: outcome.text });
  } catch (err) {
    console.error("[contract-addendum-ai]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Text se nepodařilo vygenerovat. Zkuste to znovu." },
      { status: 500 }
    );
  }
}
