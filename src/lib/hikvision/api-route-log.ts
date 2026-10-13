import { HccApiError } from "@/lib/hikvision/hikconnect-openapi/client";

/** Bezpečné logování chyb Hikvision API (bez tokenů a URL streamu). */
export function logHikvisionRouteError(
  route: string,
  context: { companyId?: string; cameraId?: string; action?: string },
  err: unknown
): void {
  const companyId = String(context.companyId ?? "").slice(0, 64) || "?";
  const cameraId = String(context.cameraId ?? "").slice(0, 128) || "?";
  const action = context.action ?? "request";
  let code: string | undefined;
  let message: string;
  if (err instanceof HccApiError) {
    code = err.code;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  console.error("[hikvision]", route, {
    action,
    companyId,
    cameraId,
    code,
    message: message.slice(0, 500),
  });
}
