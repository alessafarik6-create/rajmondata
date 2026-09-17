"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function AdminPlatformNotificationsPanel() {
  const { toast } = useToast();
  const [testingReg, setTestingReg] = useState(false);
  const [testingSec, setTestingSec] = useState(false);
  const [lastReg, setLastReg] = useState<string | null>(null);
  const [lastSec, setLastSec] = useState<string | null>(null);

  const testReg = async () => {
    setTestingReg(true);
    try {
      const res = await fetch("/api/superadmin/notifications/test-registration", {
        method: "POST",
        credentials: "include",
      });
      const j = await res.json();
      const msg = `Interní notifikace: ${j.internalNotification ?? "?"}\nE-mail: ${j.email ?? "?"}${j.emailError ? `\n${j.emailError}` : ""}`;
      setLastReg(msg);
      toast({
        title: "Test registrace",
        description: j.email === "OK" ? "Notifikace a e-mail OK." : "Dokončeno — viz detail.",
        variant: j.email === "OK" ? "default" : "destructive",
      });
    } finally {
      setTestingReg(false);
    }
  };

  const testSec = async () => {
    setTestingSec(true);
    try {
      const res = await fetch("/api/superadmin/notifications/test-security", {
        method: "POST",
        credentials: "include",
      });
      const j = await res.json();
      const msg = `Interní notifikace: ${j.internalNotification ?? "?"}\nBezpečnostní e-mail: ${j.securityEmail ?? "?"}${j.emailError ? `\n${j.emailError}` : ""}`;
      setLastSec(msg);
      toast({
        title: "Test bezpečnostního upozornění",
        description: j.securityEmail === "OK" ? "OK" : "Chyba e-mailu — viz detail.",
        variant: j.securityEmail === "OK" ? "default" : "destructive",
      });
    } finally {
      setTestingSec(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifikace platformy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Testy nevytvářejí skutečnou organizaci ani neblokují IP. E-mail jde na adresu z billingProvider.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" disabled={testingReg} onClick={() => void testReg()}>
            {testingReg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Otestovat notifikaci nové registrace"}
          </Button>
          <Button type="button" variant="outline" disabled={testingSec} onClick={() => void testSec()}>
            {testingSec ? <Loader2 className="h-4 w-4 animate-spin" /> : "Otestovat bezpečnostní upozornění"}
          </Button>
        </div>
        {lastReg ? (
          <pre className="whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs">{lastReg}</pre>
        ) : null}
        {lastSec ? (
          <pre className="whitespace-pre-wrap rounded bg-slate-100 p-3 text-xs">{lastSec}</pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
