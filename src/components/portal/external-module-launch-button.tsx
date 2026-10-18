"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import type { PlatformModuleCode } from "@/lib/platform-config";

type Props = {
  moduleCode: PlatformModuleCode;
  label?: string;
  className?: string;
  openInNewTab?: boolean;
  onSuccess?: () => void;
  buttonId?: string;
};

function launchErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("synchronizace") || m.includes("sync")) {
    return "Oprávnění s editorem se ještě synchronizují. Zkuste to za chvíli nebo kontaktujte podporu.";
  }
  if (m.includes("403") || m.includes("nemáte") || m.includes("neni") || m.includes("není")) {
    return raw;
  }
  if (m.includes("fetch") || m.includes("network") || m.includes("nedostup")) {
    return "Editor na Railway momentálně neodpovídá. Zkuste to znovu za chvíli.";
  }
  return raw || "Spuštění editoru se nezdařilo.";
}

export function ExternalModuleLaunchButton(props: Props) {
  const { moduleCode, label, className, openInNewTab = true, onSuccess, buttonId } = props;
  const { user } = useUser();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function launch() {
    if (!user) {
      toast({ variant: "destructive", title: "Přihlášení", description: "Nejste přihlášeni." });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/modules/${encodeURIComponent(moduleCode)}/launch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ok?: boolean; redirectUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Spuštění selhalo");
      const url = String(data.redirectUrl ?? "").trim();
      if (!url) throw new Error("Chybí adresa pro spuštění editoru.");
      if (openInNewTab) {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          window.location.href = url;
        }
      } else {
        window.location.href = url;
      }
      onSuccess?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "RAJMONDATA EDITOR",
        description: launchErrorMessage(e instanceof Error ? e.message : String(e)),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      id={buttonId}
      type="button"
      className={className ?? "bg-orange-500 hover:bg-orange-600 text-black"}
      disabled={busy}
      onClick={() => void launch()}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : label ?? "Spustit editor"}
    </Button>
  );
}
