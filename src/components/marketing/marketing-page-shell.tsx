import type { ReactNode } from "react";
import { PublicMarketingFooter } from "@/components/marketing/public-marketing-footer";
import { PublicMarketingHeader } from "@/components/marketing/public-marketing-header";

export function MarketingPageShell({
  children,
  contactEmail,
}: {
  children: ReactNode;
  contactEmail?: string | null;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <PublicMarketingHeader />
      <main>{children}</main>
      <PublicMarketingFooter contactEmail={contactEmail} />
    </div>
  );
}
