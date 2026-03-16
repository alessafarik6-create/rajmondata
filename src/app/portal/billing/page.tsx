
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  History, 
  Calendar,
  ExternalLink,
  ShieldCheck,
  Zap,
  Loader2,
  Lock
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function BillingPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const companyRef = useMemoFirebase(() => companyId ? doc(firestore, 'companies', companyId) : null, [firestore, companyId]);
  const { data: company, isLoading: isCompanyLoading } = useDoc(companyRef);

  const handleSimulatePayment = async (provider: 'stripe' | 'gopay') => {
    setIsProcessing(true);
    // Simulace zpoždění platební brány
    setTimeout(async () => {
      try {
        if (companyRef) {
          await updateDoc(companyRef, {
            'billing.paymentStatus': 'active',
            'billing.lastPaymentDate': serverTimestamp(),
            'billing.nextPaymentDate': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            'billing.paymentProvider': provider,
            isActive: true,
            updatedAt: serverTimestamp()
          });
          toast({
            title: "Platba úspěšná",
            description: `Vaše předplatné bylo aktivováno přes ${provider === 'stripe' ? 'Stripe' : 'GoPay'}.`,
          });
        }
      } catch (e) {
        toast({ variant: "destructive", title: "Chyba", description: "Nepodařilo se zpracovat platbu." });
      } finally {
        setIsProcessing(false);
      }
    }, 2000);
  };

  const isOwner = profile?.role === 'owner';

  if (isCompanyLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const billingData = company?.billing || {
    plan: company?.licenseId || 'Starter',
    paymentStatus: 'active',
    billingCycle: 'monthly',
    nextPaymentDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toLocaleDateString('cs-CZ'),
    paymentProvider: 'stripe'
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Předplatné a Fakturace</h1>
          <p className="portal-page-description">Správa vašeho tarifu, platebních metod a historie plateb.</p>
        </div>
        <Badge variant={billingData.paymentStatus === 'active' ? 'default' : 'destructive'} className="h-8 px-4 text-sm gap-2 w-fit">
          {billingData.paymentStatus === 'active' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          Stav: {billingData.paymentStatus === 'active' ? 'Aktivní' : 'Problém s platbou'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <Card className="lg:col-span-2 overflow-hidden min-w-0">
          <CardHeader className="bg-primary/5 border-b border-primary/10">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-xl">Aktuální tarif: <span className="text-primary capitalize">{billingData.plan}</span></CardTitle>
                <CardDescription>Váš workspace je nastaven na {billingData.billingCycle === 'monthly' ? 'měsíční' : 'roční'} fakturaci.</CardDescription>
              </div>
              <ShieldCheck className="w-10 h-10 text-primary opacity-20" />
            </div>
          </CardHeader>
          <CardContent className="py-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Příští platba</p>
                <div className="flex items-center gap-2 font-semibold text-lg">
                  <Calendar className="w-5 h-5 text-primary" />
                  {billingData.nextPaymentDate}
                </div>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Částka</p>
                <div className="text-2xl font-bold text-primary">
                  {billingData.plan === 'Enterprise' ? '4 990' : billingData.plan === 'Professional' ? '1 290' : '490'} Kč
                </div>
              </div>
            </div>

            <Separator className="bg-border/50" />

            <div className="space-y-4">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Platební metoda
              </h4>
              <div className="flex items-center justify-between p-4 rounded-xl bg-background border border-border">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-8 bg-zinc-800 rounded border border-zinc-700 flex items-center justify-center font-bold text-[10px] text-zinc-400">
                    {billingData.paymentProvider === 'stripe' ? 'VISA' : 'GO'}
                  </div>
                  <div>
                    <p className="font-medium">•••• •••• •••• 4242</p>
                    <p className="text-xs text-muted-foreground">Expirační datum: 12/2026</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" disabled={!isOwner}>Upravit</Button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t flex flex-col-reverse sm:flex-row justify-end gap-3 py-4">
            <Button variant="outline" disabled={!isOwner} className="min-h-[44px] w-full sm:w-auto">Změnit tarif</Button>
            <Button disabled={!isOwner || isProcessing} onClick={() => handleSimulatePayment('stripe')} className="gap-2 min-h-[44px] w-full sm:w-auto">
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Zaplatit nyní
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-6 lg:space-y-8">
          <Card className="shadow-lg min-w-0">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" /> Fakturační údaje
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div>
                <p className="text-muted-foreground text-xs uppercase font-bold">Firma</p>
                <p className="font-medium">{company?.name || 'Nezadáno'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase font-bold">IČO</p>
                <p className="font-mono">{company?.ico || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase font-bold">Adresa</p>
                <p className="leading-tight">{company?.address || '-'}</p>
              </div>
              <Button variant="link" className="px-0 h-auto text-primary text-xs" disabled={!isOwner}>Změnit údaje</Button>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" /> Poslední platby
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { date: '15. 5. 2024', amount: '1 290 Kč', status: 'Zaplaceno' },
                { date: '15. 4. 2024', amount: '1 290 Kč', status: 'Zaplaceno' },
              ].map((inv, i) => (
                <div key={i} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <div>
                    <p className="font-medium">{inv.date}</p>
                    <p className="text-[10px] text-emerald-500">{inv.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{inv.amount}</p>
                    <Button variant="ghost" size="icon" className="h-6 w-6"><ExternalLink className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-12 space-y-6">
        <h2 className="text-2xl font-bold">Vyberte si platební bránu</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card 
            className={`cursor-pointer transition-all border-2 hover:border-primary/50 ${billingData.paymentProvider === 'stripe' ? 'border-primary' : 'border-border'}`}
            onClick={() => handleSimulatePayment('stripe')}
          >
            <CardContent className="flex items-center gap-6 p-6">
              <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center p-2">
                <img src="https://placehold.co/100x40?text=Stripe" alt="Stripe" className="w-full" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">Stripe</h3>
                <p className="text-sm text-muted-foreground">Globální standard pro online platby kartou.</p>
              </div>
              {billingData.paymentProvider === 'stripe' && <CheckCircle2 className="text-primary w-6 h-6" />}
            </CardContent>
          </Card>

          <Card 
            className={`cursor-pointer transition-all border-2 hover:border-primary/50 ${billingData.paymentProvider === 'gopay' ? 'border-primary' : 'border-border'}`}
            onClick={() => handleSimulatePayment('gopay')}
          >
            <CardContent className="flex items-center gap-6 p-6">
              <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center p-2">
                <img src="https://placehold.co/100x40?text=GoPay" alt="GoPay" className="w-full" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-lg">GoPay</h3>
                <p className="text-sm text-muted-foreground">Populární české platební řešení a bankovní převody.</p>
              </div>
              {billingData.paymentProvider === 'gopay' && <CheckCircle2 className="text-primary w-6 h-6" />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
