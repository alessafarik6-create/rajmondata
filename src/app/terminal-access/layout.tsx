import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Docházkový terminál",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

/**
 * Samostatný shell pro tabletový terminál — bez portálového layoutu, menu a hlavičky.
 */
export default function TerminalAccessLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh h-dvh w-full overflow-hidden bg-background text-foreground flex flex-col touch-manipulation">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}
