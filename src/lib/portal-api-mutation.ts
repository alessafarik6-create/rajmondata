import type { NextRequest } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import type { PortalModuleId } from "@/lib/portal-permissions";

/** Ověření Bearer tokenu + WRITE k modulu portálu (403 při READ / NONE). */
export async function verifyCompanyPortalMutation(
  request: NextRequest | Request,
  moduleId: PortalModuleId
) {
  const authHeader = request.headers.get("authorization");
  return verifyCompanyBearerWithPortalAccess(authHeader, {
    moduleId,
    method: request.method,
  });
}
