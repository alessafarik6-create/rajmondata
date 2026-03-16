
"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  Plus, 
  Trash2, 
  ChevronLeft, 
  Save, 
  Loader2,
  Calculator
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

export default function NewInvoicePage() {
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState([{ id: '1', description: '', quantity: 1, unitPrice: 0 }]);
  const [formData, setFormData] = useState({
    customerId: '',
    invoiceNumber: `FV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: ''
  });

  const { data: customers } = useCollection(useMemoFirebase(() => 
    companyId ? collection(firestore, 'companies', companyId, 'customers') : null
  , [firestore, companyId]));

  const addItem = () => {
    setItems([...items, { id: Math.random().toString(), description: '', quantity: 1, unitPrice: 0 }]);
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems(items.filter(item => item.id !== id));
  };

  const updateItem = (id: string, field: string, value: any) => {
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !formData.customerId) {
      toast({ variant: "destructive", title: "Chyba", description: "Prosím vyberte zákazníka." });
      return;
    }
    setIsSubmitting(true);

    try {
      const invRef = collection(firestore, 'companies', companyId, 'invoices');
      await addDoc(invRef, {
        ...formData,
        items,
        totalAmount,
        vat: 21,
        status: 'draft',
        organizationId: companyId,
        createdAt: serverTimestamp()
      });

      // Update finance module
      const financeRef = collection(firestore, 'companies', companyId, 'finance');
      await addDoc(financeRef, {
        amount: totalAmount,
        type: 'revenue',
        date: formData.issueDate,
        description: `Faktura ${formData.invoiceNumber}`,
        createdAt: serverTimestamp()
      });

      toast({ title: "Faktura vytvořena", description: "Faktura byla úspěšně uložena jako koncept." });
      router.push('/portal/invoices');
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při ukládání" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/portal/invoices')}>
          <ChevronLeft className="w-6 h-6" />
        </Button>
        <h1 className="portal-page-title">Vytvořit novou fakturu</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Základní údaje</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Odběratel (Zákazník)</Label>
              <Select value={formData.customerId} onValueChange={v => setFormData({...formData, customerId: v})}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Vyberte firmu" />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  {customers?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.companyName || `${c.firstName} ${c.lastName}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Číslo faktury</Label>
              <Input value={formData.invoiceNumber} onChange={e => setFormData({...formData, invoiceNumber: e.target.value})} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label>Datum vystavení</Label>
              <Input type="date" value={formData.issueDate} onChange={e => setFormData({...formData, issueDate: e.target.value})} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label>Datum splatnosti</Label>
              <Input type="date" value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} className="bg-background" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Položky faktury</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-2">
              <Plus className="w-4 h-4" /> Přidat řádek
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="hidden md:grid grid-cols-12 gap-4 px-2 text-xs font-bold text-muted-foreground uppercase">
              <div className="col-span-6">Popis služby / zboží</div>
              <div className="col-span-2">Množství</div>
              <div className="col-span-3">Cena za jedn. (Kč)</div>
              <div className="col-span-1"></div>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                <div className="col-span-6">
                  <Input 
                    placeholder="Např. Konzultační služby" 
                    value={item.description} 
                    onChange={e => updateItem(item.id, 'description', e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="col-span-2">
                  <Input 
                    type="number" 
                    value={item.quantity} 
                    onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                    className="bg-background"
                  />
                </div>
                <div className="col-span-3">
                  <Input 
                    type="number" 
                    value={item.unitPrice} 
                    onChange={e => updateItem(item.id, 'unitPrice', Number(e.target.value))}
                    className="bg-background"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
          <Separator />
          <CardFooter className="py-6 flex flex-col items-end">
            <div className="space-y-1 text-right">
              <p className="text-sm text-muted-foreground">Celkem bez DPH: {Math.round(totalAmount / 1.21).toLocaleString()} Kč</p>
              <p className="text-2xl font-bold text-primary flex items-center justify-end gap-2">
                <Calculator className="w-6 h-6" /> {totalAmount.toLocaleString()} Kč
              </p>
              <p className="text-xs text-muted-foreground italic">Včetně DPH 21%</p>
            </div>
          </CardFooter>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.push('/portal/invoices')}>Zrušit</Button>
          <Button type="submit" disabled={isSubmitting} className="gap-2 px-8">
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4" /> Uložit fakturu</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
