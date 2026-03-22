
"use client";

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCompany, useCollection } from '@/firebase';
import {
  doc,
  setDoc,
  serverTimestamp,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
} from 'firebase/firestore';
import Link from 'next/link';
import { Users, ShieldCheck, Bell, Building2, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from '@/lib/firestore-collections';

type CompanyBankAccountDoc = {
  id: string;
  name: string;
  accountNumber?: string;
  bankCode?: string;
  iban?: string;
  swift?: string;
  currency?: string;
};

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
  const [dicInput, setDicInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [webInput, setWebInput] = useState('');
  const [publicProfile, setPublicProfile] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);

  const [addrStreetAndNumber, setAddrStreetAndNumber] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrPostalCode, setAddrPostalCode] = useState('');
  const [addrCountry, setAddrCountry] = useState('');

  const bankAccountsColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, COMPANIES_COLLECTION, companyId, 'bankAccounts')
        : null,
    [firestore, companyId]
  );
  const { data: bankAccounts, isLoading: isLoadingBankAccounts } =
    useCollection<CompanyBankAccountDoc>(bankAccountsColRef);

  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankDialogMode, setBankDialogMode] = useState<'create' | 'edit'>('create');
  const [bankForm, setBankForm] = useState<{
    id?: string;
    name: string;
    accountNumber: string;
    bankCode: string;
    iban: string;
    swift: string;
    currency: string;
  }>({
    name: '',
    accountNumber: '',
    bankCode: '',
    iban: '',
    swift: '',
    currency: 'CZK',
  });
  const [isSavingBank, setIsSavingBank] = useState(false);

  useEffect(() => {
    if (company) {
      setCompanyNameInput(
        company.companyName || (company as any).name || ''
      );
      setIcoInput(company.ico || '');
      setDicInput((company as any).dic || '');
      setEmailInput((company as any).email || '');
      setPhoneInput((company as any).phone || '');
      setWebInput((company as any).web || '');
      setPublicProfile(Boolean(company.publicProfile));

      // Prefer structured address; fallback to legacy registeredOfficeAddress.
      const street = (company as any).companyAddressStreetAndNumber;
      const city = (company as any).companyAddressCity;
      const postalCode = (company as any).companyAddressPostalCode;
      const country = (company as any).companyAddressCountry;

      if (street || city || postalCode || country) {
        setAddrStreetAndNumber(street || '');
        setAddrCity(city || '');
        setAddrPostalCode(postalCode || '');
        setAddrCountry(country || '');
      } else if ((company as any).registeredOfficeAddress || (company as any).address) {
        const raw = ((company as any).registeredOfficeAddress || (company as any).address || '').toString();
        const lines = raw.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
        if (lines.length >= 2) {
          setAddrStreetAndNumber(lines[0] || '');
          // last line often country
          setAddrCountry(lines[lines.length - 1] || '');
          const middle = lines.slice(1, lines.length - 1).join(' ').trim();
          if (middle) {
            const m = middle.match(/^(\d{3}\s?\d{2})\s+(.*)$/) || middle.match(/^(\d{5})\s+(.*)$/);
            if (m) {
              setAddrPostalCode((m[1] || '').replace(/\s+/g, '') );
              setAddrCity((m[2] || '').trim());
            } else {
              setAddrCity(middle);
            }
          }
        } else {
          setAddrStreetAndNumber(raw);
        }
      } else {
        setAddrStreetAndNumber('');
        setAddrCity('');
        setAddrPostalCode('');
        setAddrCountry('');
      }
    } else {
      setCompanyNameInput('');
      setIcoInput('');
      setDicInput('');
      setEmailInput('');
      setPhoneInput('');
      setWebInput('');
      setPublicProfile(false);
      setAddrStreetAndNumber('');
      setAddrCity('');
      setAddrPostalCode('');
      setAddrCountry('');
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

    const streetAndNum = addrStreetAndNumber.trim();
    const city = addrCity.trim();
    const postalCode = addrPostalCode.trim();
    const country = addrCountry.trim();

    if (!streetAndNum || !city || !postalCode || !country) {
      toast({
        variant: 'destructive',
        title: 'Adresa společnosti je povinná',
        description:
          'Vyplňte prosím ulice a číslo, město, PSČ a stát.',
      });
      return;
    }

    const fullAddressBlock = [
      streetAndNum,
      [postalCode, city].filter(Boolean).join(' '),
      country,
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    if (isLoadingBankAccounts) {
      toast({
        variant: 'destructive',
        title: 'Načítání probíhá',
        description: 'Počkejte prosím na načtení bankovních účtů a zkuste to znovu.',
      });
      return;
    }

    const accountsArr = (bankAccounts || []) as CompanyBankAccountDoc[];
    const hasAtLeastOneAccount = accountsArr.some((a) => {
      const acct = (a.accountNumber || '').trim();
      const code = (a.bankCode || '').trim();
      const iban = (a.iban || '').trim();
      return (acct && code) || iban;
    });

    if (!hasAtLeastOneAccount) {
      toast({
        variant: 'destructive',
        title: 'Chybí bankovní účet',
        description: 'Vyplňte alespoň jeden bankovní účet (CZ účet nebo IBAN).',
      });
      return;
    }

    // Backward compatibility for parts of the app that still rely on companyDoc.bankAccountNumber.
    const first = accountsArr[0];
    const legacyBankAccountNumber =
      (first?.iban || '').trim() ||
      ((first?.accountNumber || '').trim() && (first?.bankCode || '').trim()
        ? `${first.accountNumber}/${first.bankCode}`
        : (first?.accountNumber || '').trim()) ||
      "";

    try {
      setIsSavingCompany(true);

      const payloadBase = {
        companyName: trimmedName,
        name: trimmedName,
        ico: icoInput.trim() || null,
        dic: dicInput.trim() || null,
        email: emailInput.trim() || null,
        phone: phoneInput.trim() || null,
        web: webInput.trim() || null,
        companyAddressStreetAndNumber: streetAndNum || null,
        companyAddressCity: city || null,
        companyAddressPostalCode: postalCode || null,
        companyAddressCountry: country || null,
        // keep legacy fields so older contract formatting keeps working
        registeredOfficeAddress: fullAddressBlock,
        address: fullAddressBlock,
        bankAccountNumber: legacyBankAccountNumber,
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

      {isAdmin && (
        <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/25">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <div>
                <p className="font-medium">Tarify práce</p>
                <p className="text-sm text-muted-foreground">
                  Interní činnosti (cesta, administrativa, …) pro výběr v docházce.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/portal/labor/tarify">Spravovat tarify</Link>
            </Button>
          </CardContent>
        </Card>
      )}

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
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Název společnosti</Label>
                    <Input
                      value={companyNameInput}
                      onChange={(e) => setCompanyNameInput(e.target.value)}
                      placeholder="Moje Firma s.r.o."
                      className="bg-background"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>IČO</Label>
                      <Input
                        value={icoInput}
                        onChange={(e) => setIcoInput(e.target.value)}
                        placeholder="12345678"
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>DIČ</Label>
                      <Input
                        value={dicInput}
                        onChange={(e) => setDicInput(e.target.value)}
                        placeholder="CZ123456789"
                        className="bg-background"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="info@firma.cz"
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Telefon</Label>
                      <Input
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="+420 777 000 000"
                        className="bg-background"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Web</Label>
                    <Input
                      value={webInput}
                      onChange={(e) => setWebInput(e.target.value)}
                      placeholder="www.firma.cz"
                      className="bg-background"
                    />
                  </div>
                </div>

                <Separator className="bg-border" />

                <div className="space-y-3">
                  <h2 className="text-base font-semibold">Kompletní adresa firmy</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Ulice a číslo popisné</Label>
                      <Input
                        value={addrStreetAndNumber}
                        onChange={(e) => setAddrStreetAndNumber(e.target.value)}
                        placeholder="Např. Hlavní 123"
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Město</Label>
                      <Input
                        value={addrCity}
                        onChange={(e) => setAddrCity(e.target.value)}
                        placeholder="Praha"
                        className="bg-background"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>PSČ</Label>
                      <Input
                        value={addrPostalCode}
                        onChange={(e) => setAddrPostalCode(e.target.value)}
                        placeholder="11000"
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Stát</Label>
                      <Input
                        value={addrCountry}
                        onChange={(e) => setAddrCountry(e.target.value)}
                        placeholder="Česká republika"
                        className="bg-background"
                      />
                    </div>
                  </div>
                </div>

                <Separator className="bg-border" />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Veřejný profil</Label>
                    <p className="text-xs text-muted-foreground">Umožněte ostatním najít vaši organizaci na platformě.</p>
                  </div>
                  <Switch checked={publicProfile} onCheckedChange={setPublicProfile} />
                </div>

                <Separator className="bg-border" />

                <div className="space-y-3">
                  <h2 className="text-base font-semibold">Bankovní účty</h2>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-muted-foreground">
                      Přidejte více účtů a vyberte si je při generování smluv.
                    </p>
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      onClick={() => {
                        setBankDialogMode('create');
                        setBankForm({
                          name: '',
                          accountNumber: '',
                          bankCode: '',
                          iban: '',
                          swift: '',
                          currency: 'CZK',
                        });
                        setBankDialogOpen(true);
                      }}
                      disabled={!companyId}
                    >
                      Přidat účet
                    </Button>
                  </div>

                  {isLoadingBankAccounts ? (
                    <p className="text-sm text-muted-foreground">Načítání účtů…</p>
                  ) : bankAccounts && bankAccounts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {bankAccounts.map((a) => {
                        const acct = (a.accountNumber || '').trim();
                        const code = (a.bankCode || '').trim();
                        const iban = (a.iban || '').trim();
                        const swift = (a.swift || '').trim();
                        const displayAccount = iban
                          ? `IBAN: ${iban}`
                          : acct && code
                            ? `Účet: ${acct}/${code}`
                            : acct
                              ? `Účet: ${acct}`
                              : '—';
                        return (
                          <div
                            key={a.id}
                            className="rounded-lg border border-border/60 bg-background p-4 space-y-3"
                          >
                            <div className="space-y-0.5">
                              <div className="font-medium">{a.name || 'Účet'}</div>
                              <div className="text-sm text-muted-foreground">
                                {a.currency || 'CZK'}
                              </div>
                            </div>

                            <div className="text-sm">
                              <div className="text-muted-foreground">{displayAccount}</div>
                              {swift ? (
                                <div className="text-muted-foreground mt-1">
                                  SWIFT: {swift}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex gap-2 flex-wrap">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setBankDialogMode('edit');
                                  setBankForm({
                                    id: a.id,
                                    name: a.name || '',
                                    accountNumber: a.accountNumber || '',
                                    bankCode: a.bankCode || '',
                                    iban: a.iban || '',
                                    swift: a.swift || '',
                                    currency: a.currency || 'CZK',
                                  });
                                  setBankDialogOpen(true);
                                }}
                              >
                                Upravit
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={async () => {
                                  const ok = window.confirm(`Opravdu smazat účet "${a.name}"?`);
                                  if (!ok) return;
                                  try {
                                    setIsSavingBank(true);
                                    const tplRef = doc(
                                      firestore,
                                      COMPANIES_COLLECTION,
                                      companyId!,
                                      'bankAccounts',
                                      a.id
                                    );
                                    await deleteDoc(tplRef);
                                    toast({
                                      title: 'Účet smazán',
                                      description: `"${a.name}" byla odstraněna.`,
                                    });
                                  } catch (e: any) {
                                    console.error('[Settings] bank delete failed', e);
                                    toast({
                                      variant: 'destructive',
                                      title: 'Chyba',
                                      description:
                                        e?.message || 'Nepodařilo se smazat účet.',
                                    });
                                  } finally {
                                    setIsSavingBank(false);
                                  }
                                }}
                                disabled={isSavingBank}
                              >
                                Smazat
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Zatím nemáte žádné bankovní účty. Přidejte alespoň jeden.
                    </p>
                  )}
                </div>

                {/* Bank account dialog (simple inline form) */}
                {bankDialogOpen ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="w-full max-w-xl rounded-xl bg-white border border-slate-200 shadow-lg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-lg">
                            {bankDialogMode === 'edit'
                              ? 'Upravit bankovní účet'
                              : 'Nový bankovní účet'}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            Vyplňte CZ účet nebo IBAN + volitelně SWIFT.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setBankDialogOpen(false)}
                        >
                          Zavřít
                        </Button>
                      </div>

                      <form
                        className="mt-4 space-y-4"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!firestore || !companyId) return;
                          try {
                            setIsSavingBank(true);

                            const name = bankForm.name.trim();
                            const accountNumber = bankForm.accountNumber.trim();
                            const bankCode = bankForm.bankCode.trim();
                            const iban = bankForm.iban.trim().toUpperCase();
                            const swift = bankForm.swift.trim().toUpperCase();
                            const currency = bankForm.currency.trim() || 'CZK';

                            const ibanOk =
                              !iban ||
                              /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban);
                            const swiftOk =
                              !swift ||
                              /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift);

                            if (!ibanOk) {
                              toast({
                                variant: 'destructive',
                                title: 'IBAN vypadá neplatně',
                                description:
                                  'Ukládám, ale zkontrolujte formát IBAN.',
                              });
                            }
                            if (!swiftOk) {
                              toast({
                                variant: 'destructive',
                                title: 'SWIFT vypadá neplatně',
                                description:
                                  'Ukládám, ale zkontrolujte formát SWIFT.',
                              });
                            }

                            const hasCore =
                              (accountNumber && bankCode) || iban;
                            if (!hasCore) {
                              toast({
                                variant: 'destructive',
                                title: 'Chybí bankovní údaje',
                                description:
                                  'Vyplňte buď CZ účet (číslo účtu + kód banky), nebo IBAN.',
                              });
                              return;
                            }

                            const payload = {
                              name: name || 'Účet',
                              accountNumber: accountNumber || null,
                              bankCode: bankCode || null,
                              iban: iban || null,
                              swift: swift || null,
                              currency,
                              companyId,
                              updatedAt: serverTimestamp(),
                              createdAt: serverTimestamp(),
                            };

                            const { createdAt: _createdAt, ...payloadForUpdate } = payload as any;

                            if (bankDialogMode === 'edit' && bankForm.id) {
                              const accRef = doc(
                                firestore,
                                COMPANIES_COLLECTION,
                                companyId,
                                'bankAccounts',
                                bankForm.id
                              );
                              await updateDoc(accRef, {
                                ...(payloadForUpdate as any),
                              } as any);
                            } else {
                              const bankCol = collection(
                                firestore,
                                COMPANIES_COLLECTION,
                                companyId,
                                'bankAccounts'
                              );
                              await addDoc(bankCol, payload);
                            }

                            toast({
                              title: 'Účet uložen',
                              description: 'Bankovní účet byl uložen.',
                            });
                            setBankDialogOpen(false);
                          } catch (e: any) {
                            console.error('[Settings] bank save failed', e);
                            toast({
                              variant: 'destructive',
                              title: 'Chyba',
                              description:
                                e?.message || 'Nepodařilo se uložit účet.',
                            });
                          } finally {
                            setIsSavingBank(false);
                          }
                        }}
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2 md:col-span-2">
                            <Label>Název / popis účtu</Label>
                            <Input
                              value={bankForm.name}
                              onChange={(e) =>
                                setBankForm((p) => ({ ...p, name: e.target.value }))
                              }
                              placeholder="Hlavní účet, EUR účet…"
                              className="bg-background"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Číslo účtu</Label>
                            <Input
                              value={bankForm.accountNumber}
                              onChange={(e) =>
                                setBankForm((p) => ({
                                  ...p,
                                  accountNumber: e.target.value,
                                }))
                              }
                              placeholder="123456789"
                              className="bg-background"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Kód banky</Label>
                            <Input
                              value={bankForm.bankCode}
                              onChange={(e) =>
                                setBankForm((p) => ({ ...p, bankCode: e.target.value }))
                              }
                              placeholder="0300"
                              className="bg-background"
                            />
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label>IBAN (volitelné)</Label>
                            <Input
                              value={bankForm.iban}
                              onChange={(e) =>
                                setBankForm((p) => ({ ...p, iban: e.target.value }))
                              }
                              placeholder="CZ12 3456 7890 1234 5678 9012"
                              className="bg-background"
                            />
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label>SWIFT (volitelné)</Label>
                            <Input
                              value={bankForm.swift}
                              onChange={(e) =>
                                setBankForm((p) => ({ ...p, swift: e.target.value }))
                              }
                              placeholder="ABCDCZPP"
                              className="bg-background"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Měna</Label>
                            <Input
                              value={bankForm.currency}
                              onChange={(e) =>
                                setBankForm((p) => ({ ...p, currency: e.target.value }))
                              }
                              placeholder="CZK"
                              className="bg-background"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-3">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setBankDialogOpen(false)}
                            disabled={isSavingBank}
                          >
                            Zrušit
                          </Button>
                          <Button type="submit" disabled={isSavingBank}>
                            {isSavingBank ? 'Ukládání…' : 'Uložit účet'}
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : null}

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
