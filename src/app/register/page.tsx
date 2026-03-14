
"use client";

import React, { useState } from 'react';
import { useAuth, useFirestore } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Loader2, ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

export default function RegisterPage() {
  const auth = useAuth();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    companyName: '',
    ico: '',
    adminName: '',
    email: '',
    password: '',
    phone: '',
    address: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.id]: e.target.value });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Vytvoření uživatele v Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
      const user = userCredential.user;

      // Aktualizace jména v Auth profilu
      await updateProfile(user, { displayName: formData.adminName });

      // 2. Vygenerování ID firmy (slug z názvu + náhodný řetězec pro unikátnost)
      const companySlug = formData.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const companyId = `${companySlug}-${Math.random().toString(36).substring(2, 7)}`;

      // 3. Vytvoření dokumentu firmy
      const companyRef = doc(db, 'companies', companyId);
      await setDoc(companyRef, {
        id: companyId,
        name: formData.companyName,
        ico: formData.ico,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        ownerUserId: user.uid,
        isActive: true,
        licenseId: 'free-trial', // Výchozí licence
        enabledModuleIds: ['dashboard', 'employees', 'jobs', 'attendance'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 4. Vytvoření profilu uživatele
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        id: user.uid,
        email: formData.email,
        displayName: formData.adminName,
        globalRoles: [],
        companyId: companyId, // Pro snadnou navigaci
        createdAt: serverTimestamp()
      });

      // 5. Přiřazení role v rámci firmy
      const roleRef = doc(db, 'users', user.uid, 'company_roles', companyId);
      await setDoc(roleRef, {
        role: 'owner',
        assignedAt: serverTimestamp()
      });

      // 6. Vytvoření záznamu zaměstnance pro majitele
      const employeeRef = doc(db, 'companies', companyId, 'employees', user.uid);
      await setDoc(employeeRef, {
        id: user.uid,
        companyId: companyId,
        userId: user.uid,
        firstName: formData.adminName.split(' ')[0],
        lastName: formData.adminName.split(' ').slice(1).join(' ') || '',
        email: formData.email,
        jobTitle: 'Majitel firmy',
        role: 'owner',
        isActive: true,
        hireDate: new Date().toISOString().split('T')[0],
        createdAt: serverTimestamp()
      });

      toast({
        title: "Registrace úspěšná",
        description: "Vaše firma byla zaregistrována. Vítejte v BizForge!"
      });

      router.push('/portal/dashboard');
    } catch (error: any) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Chyba při registraci",
        description: error.message || "Nepodařilo se vytvořit účet."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:block relative bg-black overflow-hidden">
        <Image 
          src="https://picsum.photos/seed/bizforge-register/1200/1200"
          alt="Registrace pozadí"
          fill
          className="object-cover opacity-40 scale-105"
          data-ai-hint="dark construction workspace"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        <div className="absolute top-12 left-12">
          <Link href="/login" className="flex items-center gap-2 text-primary hover:text-white transition-colors group">
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            Zpět na přihlášení
          </Link>
        </div>
        <div className="absolute bottom-12 left-12 right-12">
          <h1 className="text-5xl font-bold text-white mb-6 leading-tight">Začněte budovat svou <span className="text-primary">digitální kovárnu</span>.</h1>
          <p className="text-xl text-muted-foreground max-w-lg">Všechny nástroje pro správu vaší firmy, zaměstnanců a zakázek na jednom bezpečném místě.</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-8 overflow-y-auto">
        <Card className="w-full max-w-xl bg-surface border-border shadow-2xl">
          <CardHeader className="space-y-2">
            <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20 mb-2">
              <Building2 className="text-white w-7 h-7" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">Registrace nové firmy</CardTitle>
            <CardDescription>Vytvořte si vlastní workspace a začněte spravovat svůj podnik.</CardDescription>
          </CardHeader>
          <form onSubmit={handleRegister}>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Název firmy</Label>
                  <Input 
                    id="companyName" 
                    placeholder="Např. Kovovýroba s.r.o." 
                    value={formData.companyName}
                    onChange={handleChange}
                    className="bg-background border-border"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ico">IČO</Label>
                  <Input 
                    id="ico" 
                    placeholder="12345678" 
                    value={formData.ico}
                    onChange={handleChange}
                    className="bg-background border-border"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Adresa firmy</Label>
                <Input 
                  id="address" 
                  placeholder="Ulice, město, PSČ" 
                  value={formData.address}
                  onChange={handleChange}
                  className="bg-background border-border"
                  required
                />
              </div>

              <div className="separator flex items-center gap-4 py-2">
                <div className="h-px bg-border flex-1" />
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Údaje administrátora</span>
                <div className="h-px bg-border flex-1" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="adminName">Celé jméno administrátora</Label>
                <Input 
                  id="adminName" 
                  placeholder="Jan Novák" 
                  value={formData.adminName}
                  onChange={handleChange}
                  className="bg-background border-border"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Emailová adresa</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="email@firma.cz" 
                    value={formData.email}
                    onChange={handleChange}
                    className="bg-background border-border"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input 
                    id="phone" 
                    type="tel" 
                    placeholder="+420 777 000 000" 
                    value={formData.phone}
                    onChange={handleChange}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Heslo</Label>
                <Input 
                  id="password" 
                  type="password" 
                  placeholder="••••••••" 
                  value={formData.password}
                  onChange={handleChange}
                  className="bg-background border-border"
                  required
                />
              </div>

              <Button type="submit" className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20" disabled={loading}>
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Vytvořit firemní portál"}
              </Button>
            </CardContent>
          </form>
          <CardFooter className="justify-center border-t border-border mt-4 pt-6">
            <p className="text-sm text-muted-foreground">
              Již máte firemní účet?{" "}
              <Link href="/login" className="text-primary font-bold hover:underline underline-offset-4">
                Přihlaste se zde
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
