import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import {
  callerCanAccessCompany,
  verifyBearerAndLoadCaller,
} from "@/lib/api-verify-company-user";
import { isCompanyPrivileged } from "@/lib/company-privilege";
import {
  generateContractTemplateBodyText,
  type ContractTemplateAiMode,
  type ContractTemplateAiScope,
  type ContractTemplateAiStyle,
} from "@/lib/ai/contract-template-body-generation-service";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  companyId?: string;
  mode?: ContractTemplateAiMode;
  contractType?: string;
  scope?: ContractTemplateAiScope;
  style?: ContractTemplateAiStyle;
  userBrief?: string;
  existingContent?: string;
};

export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json(
        { ok: false, error: "Nemáte oprávnění upravovat šablony smluv." },
        { status: 403 }
      );
    }

    const rl = await checkFirestoreRateLimit(db, `ai_contract_tpl:${companyId}:${caller.uid}`, {
      limit: 24,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Příliš mnoho AI požadavků. Zkuste to později." },
        { status: 429 }
      );
    }

    const modeRaw = String(body.mode ?? "generate").trim();
    const mode: ContractTemplateAiMode =
      modeRaw === "improve" ? "improve" : modeRaw === "regenerate" ? "regenerate" : "generate";

    const scopeRaw = String(body.scope ?? "standard").trim();
    const scope: ContractTemplateAiScope =
      scopeRaw === "short" ? "short" : scopeRaw === "detailed" ? "detailed" : "standard";

    const styleRaw = String(body.style ?? "professional").trim();
    const style: ContractTemplateAiStyle = styleRaw === "formal" ? "formal" : "professional";

    const userBrief = String(body.userBrief ?? "").trim().slice(0, 4000);
    const existingContent = String(body.existingContent ?? "").slice(0, 50000);

    const outcome = await generateContractTemplateBodyText({
      db,
      companyId,
      mode,
      contractType: String(body.contractType ?? "Smlouva o dílo").trim().slice(0, 120),
      scope,
      style,
      userBrief,
      existingContent: mode === "generate" && !existingContent ? undefined : existingContent,
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json({ ok: true, text: outcome.text });
  } catch (err) {
    console.error("[contract-templates/ai-body]", errorMessageFromUnknown(err));
    return NextResponse.json(
      { ok: false, error: "Návrh se nepodařilo vytvořit. Zkuste to znovu." },
      { status: 500 }
    );
  }
}
