"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink } from "lucide-react";

const TERMINAL_PATH = "/terminal";

type Props = {
  companyId: string | undefined;
  canManage: boolean;
};

export function TerminalTabletLinkSection({ companyId, canManage }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [publicUrl, setPublicUrl] = useState("");

  useEffect(() => {
    setPublicUrl(`${window.location.origin}${TERMINAL_PATH}`);
  }, []);

  const handleCopy = useCallback(async () => {
    const text = publicUrl || `${typeof window !== "undefined" ? window.location.origin : ""}${TERMINAL_PATH}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Odkaz zkopírován do schránky" });
    } catch {
      toast({
        variant: "destructive",
        title: "Kopírování se nezdařilo",
      });
    }
  }, [publicUrl, toast]);

  const handleOpen = useCallback(() => {
    const url = publicUrl || `${window.location.origin}${TERMINAL_PATH}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [publicUrl]);

  if (!companyId || !user) {
    return null;
  }

  if (!canManage) {
    return null;
  }

  return (
    <Card className="border-primary/15 shadow-sm overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg sm:text-xl">Odkaz na terminál</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input readOnly value={publicUrl} className="font-mono text-sm bg-muted/40" />
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            variant="default"
            size="lg"
            className="min-h-[48px] flex-1 touch-manipulation"
            onClick={() => void handleOpen()}
          >
            <ExternalLink className="w-5 h-5 mr-2 shrink-0" />
            Otevřít terminál
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-[48px] flex-1 touch-manipulation"
            onClick={() => void handleCopy()}
          >
            <Copy className="w-5 h-5 mr-2 shrink-0" />
            Zkopírovat odkaz
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
