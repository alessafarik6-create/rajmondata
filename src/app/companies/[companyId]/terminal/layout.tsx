import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Docházkový terminál",
  robots: "noindex, nofollow",
};

export default function CompanyTerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh min-h-screen w-full bg-background text-foreground antialiased">
      {children}
    </div>
  );
}
