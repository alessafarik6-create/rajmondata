"use client";

import { Suspense } from "react";
import { EmailPortalPage } from "@/components/portal/email-portal-page";
import { Loader2 } from "lucide-react";

function EmailPageInner() {
  return <EmailPortalPage />;
}

export default function PortalEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <EmailPageInner />
    </Suspense>
  );
}
