import type { ReactNode } from "react";

/**
 * Dynamické vykreslení kvůli `useSearchParams()` na stránce terminálu (rychlejší rozřešení query).
 */
export const dynamic = "force-dynamic";

export default function PortalAttendanceTerminalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
