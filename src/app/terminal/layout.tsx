import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docházkový terminál",
  description: "Docházkový terminál pro tablet",
  robots: "noindex, nofollow",
};

export default function TerminalRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh h-dvh min-h-screen w-full flex flex-col overflow-hidden bg-background text-foreground antialiased touch-manipulation">
      {children}
    </div>
  );
}
