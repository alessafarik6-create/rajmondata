"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BizForgeSidebar } from "@/components/layout/bizforge-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";
import { isGlobalAdminAppPath } from "@/lib/global-admin-shell";
import { PwaInstallBanner } from "@/components/pwa/pwa-install-banner";

type AdminSession = {
  username: string;
  role: string;
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
    releaseDocumentModalLocks();
    const id = window.requestAnimationFrame(() => releaseDocumentModalLocks());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      releaseDocumentModalLocks();
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    let cancelled = false;

    if (pathname === "/admin/login") {
      setLoading(false);
      return;
    }

    const checkSession = async () => {
      try {
        const fetchOnce = async () => {
          const res = await fetch("/api/superadmin/session", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          });
          return res;
        };

        console.debug("[AdminLayout] checking session", {
          pathname,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "ssr",
        });

        let res = await fetchOnce();
        if (cancelled) return;

        if (!res.ok && res.status === 401) {
          console.warn("[AdminLayout] session unauthorized (401), retrying once after grace", {
            pathname,
          });
          await new Promise((r) => setTimeout(r, 800));
          res = await fetchOnce();
          if (cancelled) return;
        }

        if (!res.ok) {
          console.warn("[AdminLayout] session invalid, redirecting to /admin/login", {
            pathname,
            status: res.status,
          });
          setSession(null);
          window.location.replace("/admin/login");
          return;
        }

        const data = (await res.json()) as AdminSession;

        if (cancelled) return;

        if (!data?.username) {
          console.warn("[AdminLayout] session missing username, redirecting", {
            pathname,
            data,
          });
          setSession(null);
          window.location.replace("/admin/login");
          return;
        }

        console.debug("[AdminLayout] session ok", {
          pathname,
          username: data.username,
          role: data.role,
        });
        setSession(data);
      } catch (error) {
        console.error("[AdminLayout] session check failed", error);

        if (cancelled) return;

        setSession(null);
        window.location.replace("/admin/login");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (pathname === "/admin/login" || !session) return;
    if (!isGlobalAdminAppPath(pathname)) return;
    const r = String(session.role ?? "").toLowerCase();
    const isSuperAdmin =
      r.includes("super") || session.username?.toLowerCase() === "superadmin";
    console.log("isSuperAdmin", isSuperAdmin);
    console.log(
      "modules",
      "(tenant org modules not loaded on /admin — useCompany skips companies/společnosti)",
    );
  }, [pathname, session]);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-slate-800">
            Ověřování oprávnění...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <aside className="hidden print:hidden lg:block shrink-0">
        <BizForgeSidebar />
      </aside>

      {mobileMenuOpen ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) {
              setMobileMenuOpen(false);
              releaseDocumentModalLocks();
            }
          }}
          modal
        >
          <SheetContent
            side="left"
            className="w-[min(280px,85vw)] max-w-full p-0 bg-sidebar border-sidebar-border rounded-r-lg [&>button]:text-sidebar-foreground [&>button]:hover:bg-sidebar-accent [&>button]:hover:text-sidebar-primary"
          >
            <div className="flex flex-col h-full overflow-y-auto">
              <BizForgeSidebar
                mobileSheetClose={() => {
                  setMobileMenuOpen(false);
                  releaseDocumentModalLocks();
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      <div
        className="flex min-w-0 flex-1 flex-col min-h-screen"
        data-admin-content
      >
        <TopHeader onOpenMobileMenu={() => setMobileMenuOpen(true)} />
        <PwaInstallBanner />
        <main className="flex-1 overflow-auto px-4 py-4 md:px-6 md:py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
