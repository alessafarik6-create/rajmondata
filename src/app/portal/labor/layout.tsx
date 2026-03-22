import { Suspense } from "react";
import { LaborNav } from "./LaborNav";

export default function LaborSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Práce a mzdy</h1>
        <p className="portal-page-description mt-1">
          Docházka, výkazy, výplaty a tarify interních činností na jednom místě.
        </p>
      </div>

      <Suspense
        fallback={
          <div
            className="h-11 w-full max-w-xl animate-pulse rounded-md bg-muted"
            aria-hidden
          />
        }
      >
        <LaborNav />
      </Suspense>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
