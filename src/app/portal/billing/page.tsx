"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  CheckCircle2,
  AlertCircle,
  History,
  Calendar,
  ShieldCheck,
  Zap,
  Loader2,
  Lock,
} from "lucide-react";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function BillingPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;

  const companyRef = useMemoFirebase(
    () => (companyId && firestore ? doc(firestore, "companies", companyId) : null),
    [firestore, companyId]
  );
  const { data: company, isLoading: isCompanyLoading } = useDoc(companyRef);

  const handleSimulatePayment = async (provider: "stripe" | "gopay") => {
    setIsProcessing(true);
    setTimeout(async () => {
      try {
        if (companyRef) {
          await updateDoc(companyRef, {
            "billing.paymentStatus": "active",
            "billing.lastPaymentDate": serverTimestamp(),
            "billing.nextPaymentDate": new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
            "billing.paymentProvider": provider,
            isActive: true,
            updatedAt: serverTimestamp(),
          });
          toast({
            title: "Platba úspěšná",
            description: `Předplatné bylo aktivováno (${provider === "stripe" ? "Stripe" : "GoPay"}).`,
          });
        }
      } catch {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Nepodařilo se zpracovat platbu.",
        });
      } finally {
        setIsProcessing(false);
      }
    }, 2000);
  };

  const isOwner = profile?.role === "owner";

  if (isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Fakturaci předplatného nelze načíst bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  if (isCompanyLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!company) {
    return (
      <Alert variant="destructive" className="max-w-xl border-destructive/60">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Firma neexistuje</AlertTitle>
        <AlertDescription>
          Dokument firmy ve Firestore chybí nebo k němu nemáte přístup. Zkuste obnovit stránku; pokud problém
          přetrvává, kontaktujte administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  const billing = company?.billing as
    | {
        paymentStatus?: string;
        nextPaymentDate?: string;
        billingCycle?: string;
        paymentProvider?: string;
      }
    | undefined;

  const planName =
    (company?.license as { licenseType?: string } | undefined)?.licenseType ??
    company?.licenseId ??
    "—";

  const paymentStatus = billing?.paymentStatus;
  const isActive = paymentStatus === "active";

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Předplatné a fakturace
          </h1>
          <p className="portal-page-description">
            Údaje podle vaší organizace – bez ukázkových plateb a karet.
          </p>
        </div>
        <Badge
          variant={isActive ? "default" : "secondary"}
          className="h-8 w-fit gap-2 px-4 text-sm"
        >
          {isActive ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          Stav:{" "}
          {isActive
            ? "Aktivní"
            : paymentStatus
              ? String(paymentStatus)
              : "Platba nevyřízená"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
        <Card className="min-w-0 overflow-hidden lg:col-span-2">
          <CardHeader className="border-b border-primary/10 bg-primary/5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl">
                  Tarif:{" "}
                  <span className="capitalize text-primary">{planName}</span>
                </CardTitle>
                <CardDescription>
                  {billing?.billingCycle
                    ? `Fakturace: ${billing.billingCycle === "monthly" ? "měsíční" : billing.billingCycle === "yearly" ? "roční" : billing.billingCycle}`
                    : "Cyklus fakturace doplníte po první platbě předplatného."}
                </CardDescription>
              </div>
              <ShieldCheck className="h-10 w-10 text-primary opacity-20" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 py-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Příští platba
                </p>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Calendar className="h-5 w-5 text-primary" />
                  {billing?.nextPaymentDate
                    ? new Date(billing.nextPaymentDate).toLocaleDateString(
                        "cs-CZ"
                      )
                    : "—"}
                </div>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Částka
                </p>
                <div className="text-2xl font-bold text-primary">—</div>
                <p className="text-xs text-muted-foreground">
                  Zobrazí se po nastavení ceníku u dodavatele
                </p>
              </div>
            </div>

            <Separator className="bg-border/50" />

            <div className="space-y-4">
              <h4 className="flex items-center gap-2 text-sm font-bold">
                <Zap className="h-4 w-4 text-primary" /> Platební metoda
              </h4>
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Zatím nemáte uloženou platební metodu. Po propojení s bránou se
                údaje zobrazí zde — žádné ukázkové karty se neukládají.
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col-reverse gap-3 border-t py-4 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={!isOwner}
              className="min-h-[44px] w-full sm:w-auto"
            >
              Změnit tarif
            </Button>
            <Button
              disabled={!isOwner || isProcessing}
              onClick={() => handleSimulatePayment("stripe")}
              className="min-h-[44px] w-full gap-2 sm:w-auto"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Zaplatit nyní
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-6 lg:space-y-8">
          <Card className="min-w-0 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lock className="h-4 w-4 text-primary" /> Fakturační údaje
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  Firma
                </p>
                <p className="font-medium">
                  {company?.companyName ?? company?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  IČO
                </p>
                <p className="font-mono">{company?.ico ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  Adresa
                </p>
                <p className="leading-tight">{company?.address ?? "—"}</p>
              </div>
              <Button
                variant="link"
                className="h-auto px-0 text-xs text-primary"
                disabled={!isOwner}
              >
                Změnit údaje
              </Button>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-muted-foreground" /> Platby
                předplatného
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-center text-sm text-muted-foreground">
                Zatím nemáte žádné zaznamenané platby předplatného.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-12 space-y-6">
        <h2 className="text-2xl font-bold">Platební brány</h2>
        <p className="text-sm text-muted-foreground">
          Výběr brány uloží reálný stav až po dokončení platby (bez předvyplněné
          historie).
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card
            className={`cursor-pointer border-2 transition-all hover:border-primary/50 ${billing?.paymentProvider === "stripe" ? "border-primary" : "border-border"}`}
            onClick={() => isOwner && handleSimulatePayment("stripe")}
          >
            <CardContent className="flex items-center gap-6 p-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white font-bold text-slate-800 shadow-sm">
                S
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold">Stripe</h3>
                <p className="text-sm text-muted-foreground">
                  Online platby kartou.
                </p>
              </div>
              {billing?.paymentProvider === "stripe" && (
                <CheckCircle2 className="h-6 w-6 text-primary" />
              )}
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer border-2 transition-all hover:border-primary/50 ${billing?.paymentProvider === "gopay" ? "border-primary" : "border-border"}`}
            onClick={() => isOwner && handleSimulatePayment("gopay")}
          >
            <CardContent className="flex items-center gap-6 p-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white font-bold text-slate-800 shadow-sm">
                G
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold">GoPay</h3>
                <p className="text-sm text-muted-foreground">
                  České platební řešení.
                </p>
              </div>
              {billing?.paymentProvider === "gopay" && (
                <CheckCircle2 className="h-6 w-6 text-primary" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
