
"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  ShieldCheck, 
  Plus, 
  Settings, 
  Edit2, 
  Check,
  X,
  CreditCard,
  Users,
  Box,
  AlertCircle
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export default function AdminLicensesPage() {
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const licensesQuery = useMemoFirebase(() => collection(firestore, 'licenses'), [firestore]);
  const { data: licenses, isLoading } = useCollection(licensesQuery);

  const [isNewLicenseOpen, setIsNewJobOpen] = useState(false);
  const [newLicense, setNewLicense] = useState({
    name: '',
    plan: 'starter',
    monthlyPrice: 490,
    usersLimit: 5,
    description: ''
  });

  const handleCreateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(firestore, 'licenses'), {
        ...newLicense,
        monthlyPrice: Number(newLicense.monthlyPrice),
        usersLimit: Number(newLicense.usersLimit),
        modulesEnabled: ['dashboard', 'employees', 'jobs'],
        createdAt: serverTimestamp(),
        paymentStatus: 'active'
      });
      toast({ title: "Licence vytvořena", description: `Plán ${newLicense.name} byl přidán do nabídky.` });
      setIsNewJobOpen(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const suspendLicense = async (id: string) => {
    try {
      await updateDoc(doc(firestore, 'licenses', id), {
        paymentStatus: 'unpaid',
        status: 'suspended'
      });
      toast({ title: "Licence pozastavena", description: "Status byl změněn na Nezaplaceno." });
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const defaultPlans = [
    { id: '1', name: 'Starter', price: 490, users: 5, modules: 3, color: 'bg-zinc-500', paymentStatus: 'active' },
    { id: '2', name: 'Professional', price: 1290, users: 20, modules: 6, color: 'bg-primary', paymentStatus: 'active' },
    { id: '3', name: 'Enterprise', price: 4990, users: 100, modules: 10, color: 'bg-emerald-600', paymentStatus: 'unpaid' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Správa Licencí</h1>
          <p className="text-muted-foreground mt-2">Definujte cenové plány a limity pro organizace na platformě.</p>
        </div>
        <Dialog open={isNewLicenseOpen} onOpenChange={setIsNewJobOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4" /> Nový tarif
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-surface border-border">
            <DialogHeader>
              <DialogTitle>Vytvořit nový licenční plán</DialogTitle>
              <DialogDescription>Nastavte parametry nového předplatného pro vaše zákazníky.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateLicense} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Název plánu</Label>
                <Input id="name" required value={newLicense.name} onChange={e => setNewLicense({...newLicense, name: e.target.value})} className="bg-background" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Měsíční cena (Kč)</Label>
                  <Input id="price" type="number" required value={newLicense.monthlyPrice} onChange={e => setNewLicense({...newLicense, monthlyPrice: Number(e.target.value)})} className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="limit">Limit uživatelů</Label>
                  <Input id="limit" type="number" required value={newLicense.usersLimit} onChange={e => setNewLicense({...newLicense, usersLimit: Number(e.target.value)})} className="bg-background" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Popis</Label>
                <Input id="desc" value={newLicense.description} onChange={e => setNewLicense({...newLicense, description: e.target.value})} className="bg-background" />
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full">Uložit plán</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {(licenses && licenses.length > 0 ? licenses : defaultPlans).map((plan: any) => (
          <Card key={plan.id} className="bg-surface border-border flex flex-col relative overflow-hidden">
            <div className={`h-1.5 w-full ${plan.color || 'bg-primary'}`} />
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <Badge variant={plan.paymentStatus === 'active' ? 'outline' : 'destructive'} className={plan.paymentStatus === 'active' ? 'border-primary/20 text-primary' : ''}>
                  {plan.paymentStatus === 'active' ? 'Aktivní' : 'Nezaplaceno'}
                </Badge>
              </div>
              <CardDescription>{plan.description || `Základní plán pro menší týmy.`}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-6">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold">{(plan.monthlyPrice || plan.price).toLocaleString()}</span>
                <span className="text-muted-foreground font-medium">Kč / měsíc</span>
              </div>
              <ul className="space-y-3">
                <li className="flex items-center gap-3 text-sm">
                  <Users className="w-4 h-4 text-primary" />
                  <span>Až {plan.usersLimit || plan.users} uživatelů</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <Box className="w-4 h-4 text-primary" />
                  <span>{plan.modulesEnabled?.length || plan.modules} aktivních modulů</span>
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span>Prioritní podpora platformy</span>
                </li>
              </ul>
            </CardContent>
            <CardFooter className="pt-6 border-t border-border/50 flex flex-col gap-2">
              <Button variant="outline" className="w-full gap-2"><Edit2 className="w-4 h-4" /> Upravit parametry</Button>
              {plan.paymentStatus === 'active' && (
                <Button variant="ghost" className="w-full text-xs text-rose-500" onClick={() => suspendLicense(plan.id)}>
                  <AlertCircle className="w-3 h-3 mr-1" /> Simulovat selhání platby
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
