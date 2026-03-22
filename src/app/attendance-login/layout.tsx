import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Přihlášení docházky",
  robots: { index: false, follow: false },
};

export default function AttendanceLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50 antialiased">
      {children}
    </div>
  );
}
