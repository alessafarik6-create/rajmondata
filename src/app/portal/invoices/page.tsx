
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  ReceiptText, 
  Search, 
  Filter, 
  Loader2, 
  MoreVertical,
  Printer,
  CheckCircle2,
  Clock,
  ExternalLink
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function InvoicesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user && firestore ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'invoices');
  }, [firestore, companyId]);

  const { data: invoices, isLoading } = useCollection(invoicesQuery);

  // Načtení zákazníků pro zobrazení jmen v tabulce
  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'customers');
  }, [firestore, companyId]);
  const { data: customers } = useCollection(customersQuery);

  const getCustomerName = (id: string) => {
    const customer = customers?.find(c => c.id === id);
    return customer ? (customer.companyName || `${customer.firstName} ${customer.lastName}`) : 'Neznámý zákazník';
  };

  const markAsPaid = async (id: string) => {
    try {
      await updateDoc(doc(firestore, 'companies', companyId, 'invoices', id), {
        status: 'paid',
        updatedAt: serverTimestamp()
      });
      toast({ title: "Faktura uhrazena", description: "Stav faktury byl změněn na 'Zaplaceno'." });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'paid': return <Badge className="bg-emerald-600">Zaplaceno</Badge>;
      case 'sent': return <Badge variant="secondary" className="bg-blue-600 text-white">Odesláno</Badge>;
      case 'draft': return <Badge variant="outline">Draft</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Nelze načíst faktury bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Faktury</h1>
          <p className="portal-page-description">Vystavujte faktury zákazníkům a sledujte jejich úhrady.</p>
        </div>
        <Link href="/portal/invoices/new" className="w-full sm:w-auto">
          <Button className="gap-2 min-h-[44px] w-full sm:w-auto">
            <Plus className="w-4 h-4 shrink-0" /> Nová faktura
          </Button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-800" />
            <Input placeholder="Hledat číslo faktury nebo firmu..." className="pl-10 bg-white border-slate-200 min-h-[44px]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0"><Filter className="w-4 h-4 shrink-0" /> Filtr</Button>
            <Button variant="outlineLight" size="sm" className="gap-2 min-h-[44px] sm:min-h-0"><Printer className="w-4 h-4 shrink-0" /> Tisk</Button>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : invoices && invoices.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="pl-6">Číslo faktury</TableHead>
                  <TableHead>Zákazník</TableHead>
                  <TableHead>Splatnost</TableHead>
                  <TableHead className="text-right">Celkem</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="border-border hover:bg-muted/30">
                    <TableCell className="pl-6 font-bold">{inv.invoiceNumber}</TableCell>
                    <TableCell>{getCustomerName(inv.customerId)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        {inv.dueDate}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-bold text-primary">
                      {inv.totalAmount?.toLocaleString()} Kč
                    </TableCell>
                    <TableCell>{getStatusBadge(inv.status)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Možnosti</DropdownMenuLabel>
                          <DropdownMenuItem asChild>
                            <Link href={`/portal/invoices/${inv.id}`}>
                              <ExternalLink className="w-4 h-4 mr-2" /> Zobrazit detail
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.print()}>
                            <Printer className="w-4 h-4 mr-2" /> Tisknout PDF
                          </DropdownMenuItem>
                          {inv.status !== 'paid' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => markAsPaid(inv.id)} className="text-emerald-500 font-bold">
                                <CheckCircle2 className="w-4 h-4 mr-2" /> Označit jako zaplacené
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <ReceiptText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Zatím nemáte žádné faktury.</p>
              <Button variant="link" asChild><Link href="/portal/invoices/new">Vytvořit první fakturu</Link></Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
