import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Přihlášení docházky",
  robots: { index: false, follow: false },
};

export default function AttendanceLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh min-h-screen bg-[radial-gradient(120%_80%_at_50%_-20%,rgba(16,185,129,0.12),transparent)] bg-slate-950 text-slate-50 antialiased">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0.3),transparent_40%,rgba(15,23,42,0.85))]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
