
"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCompany } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import Link from 'next/link';
import { Users, ShieldCheck, Bell, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from '@/lib/firestore-collections';

export default function SettingsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  
  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);

  const isAdmin =
    profile?.role === 'owner' ||
    profile?.role === 'admin' ||
    profile?.globalRoles?.includes('super_admin');

  const { company, companyName, companyId } = useCompany();
  const [companyNameInput, setCompanyNameInput] = useState('');
  const [icoInput, setIcoInput] = useState('');
  const [publicProfile, setPublicProfile] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);

  useEffect(() => {
    if (company) {
      setCompanyNameInput(
        company.companyName || (company as any).name || ''
      );
      setIcoInput(company.ico || '');
      setPublicProfile(Boolean(company.publicProfile));
    } else {
      setCompanyNameInput('');
      setIcoInput('');
      setPublicProfile(false);
    }
  }, [company]);

  const handleSaveOrganization = async () => {
    if (!firestore || !companyId) {
      toast({
        variant: 'destructive',
        title: 'Organizace nenalezena',
        description: 'Nepodařilo se najít vaši organizaci. Zkuste stránku obnovit.',
      });
      return;
    }

    const trimmedName = companyNameInput.trim();
    if (!trimmedName) {
      toast({
        variant: 'destructive',
        title: 'Název společnosti je povinný',
        description: 'Zadejte prosím platný název společnosti.',
      });
      return;
    }

    try {
      setIsSavingCompany(true);

      const payloadBase = {
        companyName: trimmedName,
        name: trimmedName,
        ico: icoInput.trim() || null,
        publicProfile,
        updatedAt: serverTimestamp(),
      };

      const companyDocRef = doc(firestore, COMPANIES_COLLECTION, companyId);
      const orgDocRef = doc(firestore, ORGANIZATIONS_COLLECTION, companyId);

      const payloadForSet =
        company == null
          ? { ...payloadBase, createdAt: serverTimestamp() }
          : payloadBase;

      console.log('[Settings] Saving company profile', {
        collectionName: COMPANIES_COLLECTION,
        companyId,
        companyDocPath: `${COMPANIES_COLLECTION}/${companyId}`,
        orgCollectionName: ORGANIZATIONS_COLLECTION,
        orgDocPath: `${ORGANIZATIONS_COLLECTION}/${companyId}`,
        payload: payloadForSet,
      });

      await Promise.all([
        setDoc(companyDocRef, payloadForSet, { merge: true }),
        setDoc(orgDocRef, payloadForSet, { merge: true }),
      ]);

      toast({
        title: 'Nastavení uloženo',
        description: 'Název společnosti byl úspěšně aktualizován.',
      });
    } catch (error: any) {
      console.error('Failed to save company profile', error);
      toast({
        variant: 'destructive',
        title: 'Chyba při ukládání',
        description: error?.message || 'Název společnosti se nepodařilo uložit.',
      });
    } finally {
      setIsSavingCompany(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 sm:space-y-8 px-0">
      <div className="min-w-0">
        <h1 className="portal-page-title text-2xl sm:text-3xl">Nastavení</h1>
        <p className="portal-page-description">Spravujte svůj účet a preference organizace.</p>
      </div>

      <Tabs defaultValue="profile" className="w-full overflow-hidden">
        <TabsList className="bg-white border border-slate-200 w-full flex flex-wrap justify-start h-auto p-1 gap-1">
          <TabsTrigger value="profile" className="gap-2 min-h-[44px] sm:min-h-0"><Building2 className="w-4 h-4 shrink-0" /> Profil</TabsTrigger>
          {isAdmin && <TabsTrigger value="organization" className="gap-2 min-h-[44px] sm:min-h-0"><ShieldCheck className="w-4 h-4 shrink-0" /> Organizace</TabsTrigger>}
          {isAdmin && <TabsTrigger value="management" className="gap-2 min-h-[44px] sm:min-h-0"><Users className="w-4 h-4 shrink-0" /> Správa týmu</TabsTrigger>}
          <TabsTrigger value="notifications" className="gap-2 min-h-[44px] sm:min-h-0"><Bell className="w-4 h-4 shrink-0" /> Oznámení</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 sm:mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Osobní informace</CardTitle>
              <CardDescription>Aktualizujte své jméno a profilové údaje.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Celé jméno</Label>
                  <Input defaultValue={profile?.displayName || ''} placeholder="Jan Novák" className="bg-background" />
                </div>
                <div className="space-y-2">
                  <Label>Emailová adresa</Label>
                  <Input defaultValue={user?.email || ''} readOnly className="bg-background opacity-70" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Pracovní pozice</Label>
                <Input defaultValue={profile?.jobTitle || ''} placeholder="Provozní manažer" className="bg-background" />
              </div>
              <Button className="w-fit">Uložit změny</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="organization" className="mt-6">
            <Card className="bg-surface border-border">
              <CardHeader>
                <CardTitle>Profil organizace</CardTitle>
                <CardDescription>Nakonfigurujte podrobnosti o vaší společnosti.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Název společnosti</Label>
                  <Input
                    value={companyNameInput}
                    onChange={(e) => setCompanyNameInput(e.target.value)}
                    placeholder="Moje Firma s.r.o."
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label>IČO</Label>
                  <Input
                    value={icoInput}
                    onChange={(e) => setIcoInput(e.target.value)}
                    placeholder="12345678"
                    className="bg-background"
                  />
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Veřejný profil</Label>
                    <p className="text-xs text-muted-foreground">Umožněte ostatním najít vaši organizaci na platformě.</p>
                  </div>
                  <Switch
                    checked={publicProfile}
                    onCheckedChange={setPublicProfile}
                  />
                </div>
                <Button className="w-fit" onClick={handleSaveOrganization} disabled={isSavingCompany}>
                  {isSavingCompany ? 'Ukládání…' : 'Aktualizovat firmu'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="management" className="mt-6">
            <Card className="bg-surface border-border">
              <CardHeader>
                <CardTitle>Správa zaměstnanců</CardTitle>
                <CardDescription>Přejděte do sekce pro správu týmu, pozvánek a rolí.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  V této sekci můžete spravovat uživatelské účty, přiřazovat role a sledovat aktivitu členů vašeho týmu.
                </p>
                <Link href="/portal/employees">
                  <Button variant="outline" className="gap-2">
                    <Users className="w-4 h-4" /> Přejít na seznam zaměstnanců
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="notifications" className="mt-6">
          <Card className="bg-surface border-border">
            <CardHeader>
              <CardTitle>Předvolby oznámení</CardTitle>
              <CardDescription>Vyberte si, jak chcete být upozorňováni na aktivitu.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Emailová oznámení</Label>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <Label>Upozornění na nové zprávy</Label>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <Label>Připomenutí docházky</Label>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
