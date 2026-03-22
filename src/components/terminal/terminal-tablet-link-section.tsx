"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const TERMINAL_PATH = "/terminal";

type Props = {
  companyId: string | undefined;
  canManage: boolean;
};

export function TerminalTabletLinkSection({ companyId, canManage }: Props) {
  const { user } = useUser();
  const { toast } = useToast();
  const [qrValue, setQrValue] = useState(TERMINAL_PATH);

  useEffect(() => {
    setQrValue(`${window.location.origin}${TERMINAL_PATH}`);
  }, []);

  const handleCopy = useCallback(async () => {
    const text = typeof window !== "undefined" ? `${window.location.origin}${TERMINAL_PATH}` : TERMINAL_PATH;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Odkaz zkopírován do schránky" });
    } catch {
      toast({
        variant: "destructive",
        title: "Kopírování se nezdařilo",
      });
    }
  }, [toast]);

  const handleOpen = useCallback(() => {
    const url = typeof window !== "undefined" ? `${window.location.origin}${TERMINAL_PATH}` : TERMINAL_PATH;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  if (!companyId || !user) {
    return null;
  }

  if (!canManage) {
    return null;
  }

  return (
    <Card className="border-primary/15 shadow-sm overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg sm:text-xl">Odkaz pro tablet</CardTitle>
        <p className="text-sm text-muted-foreground">
          Jeden stabilní odkaz na docházkový terminál. Firma se na serveru nastaví proměnnou{" "}
          <code className="text-xs bg-muted px-1 rounded">TERMINAL_COMPANY_ID</code> nebo se použije první firma v
          databázi.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6">
        <div className="rounded-lg border bg-muted/30 p-3 sm:p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Cesta</p>
          <code className="text-sm sm:text-base font-mono break-all block">{TERMINAL_PATH}</code>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <Button
            type="button"
            variant="default"
            size="lg"
            className="min-h-[52px] w-full sm:flex-1 text-base touch-manipulation"
            onClick={() => void handleOpen()}
          >
            <ExternalLink className="w-5 h-5 mr-2 shrink-0" />
            Otevřít terminál
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-[52px] w-full sm:flex-1 text-base touch-manipulation"
            onClick={() => void handleCopy()}
          >
            <Copy className="w-5 h-5 mr-2 shrink-0" />
            Zkopírovat odkaz
          </Button>
        </div>

        <div className="flex flex-col items-center gap-3 pt-2 border-t">
          <p className="text-sm text-muted-foreground text-center">QR kód pro otevření na tabletu</p>
          <div className="rounded-xl border-2 border-border bg-white p-4 shadow-inner">
            <QRCodeSVG
              value={qrValue}
              size={200}
              level="M"
              includeMargin
              className="max-w-full h-auto w-[min(200px,70vw)]"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
