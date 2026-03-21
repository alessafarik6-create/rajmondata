
"use client";

import React, { useState } from 'react';
import { useFirebase } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { PLATFORM_NAME } from '@/lib/platform-brand';
import Image from 'next/image';
import Link from 'next/link';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  fetchSignInMethodsForEmail,
  deleteUser,
  type User,
} from 'firebase/auth';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { ORGANIZATIONS_COLLECTION, COMPANIES_COLLECTION, USERS_COLLECTION } from '@/lib/firestore-collections';
import { DEFAULT_LICENSE } from '@/lib/license-modules';

type LookupCompanyAddress = {
  street: string;
  city: string;
  postalCode: string;
  country: string;
  registeredAddressFull: string;
};

type LookupCompanyResult = {
  ico: string;
  companyName: string;
  dic?: string | null;
  legalForm?: string | null;
  address: LookupCompanyAddress;
  establishedAt?: string | null;
};

/** Jednotná normalizace e-mailu pro Firebase (registrace i přihlášení). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export default function RegisterPage() {
  const { auth, firestore: db, areServicesAvailable, firebaseConfigError } =
    useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  // Prevent hydration mismatches for props like `disabled` that depend on client-only Firebase availability.
  const [hasMounted, setHasMounted] = useState(false);
  const [icoLookupLoading, setIcoLookupLoading] = useState(false);
  const [icoLookupError, setIcoLookupError] = useState<string | null>(null);
  const [icoLookupResults, setIcoLookupResults] = useState<LookupCompanyResult[]>([]);

  const [formData, setFormData] = useState({
    companyName: '',
    ico: '',
    dic: '',
    legalForm: '',
    adminName: '',
    email: '',
    password: '',
    phone: '',
    addressStreetAndNumber: '',
    addressCity: '',
    addressZip: '',
    addressCountry: 'Česká republika',
    registeredAddressFull: '',
    establishedAt: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.id]: e.target.value });
  };

  React.useEffect(() => {
    setHasMounted(true);
  }, []);

  const validateIcoChecksum = (icoRaw: string): boolean => {
    const ico = icoRaw.replace(/\s+/g, "");
    if (!/^\d{8}$/.test(ico)) return false;
    const digits = ico.split("").map((c) => Number(c));
    const weights = [8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, idx) => acc + digits[idx] * w, 0);
    const remainder = sum % 11;
    let check: number;
    if (remainder === 0) check = 1;
    else if (remainder === 1) check = 0;
    else check = 11 - remainder;
    return check === digits[7];
  };

  const applyLookupResultToForm = (res: LookupCompanyResult) => {
    setIcoLookupError(null);
    setIcoLookupResults([res]);
    setFormData((prev) => ({
      ...prev,
      companyName: res.companyName || prev.companyName,
      ico: res.ico || prev.ico,
      dic: res.dic ?? prev.dic,
      legalForm: res.legalForm ?? prev.legalForm,
      addressStreetAndNumber:
        res.address.street || prev.addressStreetAndNumber,
      addressCity: res.address.city || prev.addressCity,
      addressZip: res.address.postalCode || prev.addressZip,
      addressCountry: res.address.country || prev.addressCountry,
      registeredAddressFull:
        res.address.registeredAddressFull || prev.registeredAddressFull,
      establishedAt: res.establishedAt ?? prev.establishedAt,
    }));
    toast({
      title: "Údaje z ARES načteny",
      description: `Vyplnili jsme data pro IČO ${res.ico}.`,
    });
  };

  const lookupIcoFromRegistry = async () => {
    const ico = formData.ico.replace(/\s+/g, "");
    setIcoLookupError(null);

    if (!/^\d{8}$/.test(ico)) {
      const msg = "IČO musí obsahovat přesně 8 číslic.";
      setIcoLookupError(msg);
      toast({ variant: "destructive", title: "Neplatné IČO", description: msg });
      return;
    }

    if (!validateIcoChecksum(ico)) {
      const msg = "Neplatné IČO (kontrolní číslo nesedí).";
      setIcoLookupError(msg);
      toast({ variant: "destructive", title: "Neplatné IČO", description: msg });
      return;
    }

    setIcoLookupLoading(true);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 13000);

      const res = await fetch("/api/company-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ico }),
        signal: controller.signal,
      });
      clearTimeout(t);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data?.error || "Nepodařilo se načíst údaje z ARES.";
        setIcoLookupError(msg);
        toast({ variant: "destructive", title: "Chyba při načítání", description: msg });
        return;
      }

      const results = (data?.results || []) as LookupCompanyResult[];

      if (!results.length) {
        const msg = "Firma nebyla nalezena.";
        setIcoLookupResults([]);
        setIcoLookupError(msg);
        toast({ variant: "destructive", title: "Nenalezeno", description: msg });
        return;
      }

      if (results.length === 1) {
        applyLookupResultToForm(results[0]);
        return;
      }

      setIcoLookupResults(results);
      toast({
        title: "Nalezeno více výsledků",
        description: "Vyberte prosím správnou firmu ze seznamu.",
      });
    } catch (e: any) {
      console.error("[register] lookupIco failed", e);
      const msg =
        e?.name === "AbortError"
          ? "Timeout při načítání údajů z ARES."
          : e?.message || "Nepodařilo se načíst údaje z ARES.";
      setIcoLookupError(msg);
      toast({ variant: "destructive", title: "Chyba při načítání", description: msg });
    } finally {
      setIcoLookupLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (firebaseConfigError) {
      toast({
        variant: "destructive",
        title: "Chybí konfigurace Firebase",
        description: firebaseConfigError,
      });
      return;
    }
    if (!areServicesAvailable) {
      toast({ variant: "destructive", title: "Načítání", description: "Firebase se ještě načítá. Zkuste to za chvíli." });
      return;
    }
    setLoading(true);

    /** Po úspěšném createUserWithEmailAndPassword – pro případný rollback při chybě Firestore / profilu. */
    let createdUser: User | null = null;

    try {
      const street = formData.addressStreetAndNumber.trim();
      const city = formData.addressCity.trim();
      const zip = formData.addressZip.trim();
      const country = formData.addressCountry.trim();

      if (!street || !city || !zip || !country) {
        toast({
          variant: 'destructive',
          title: 'Chybí adresa firmy',
          description: 'Vyplňte prosím ulici a číslo, město, PSČ a stát.',
        });
        return;
      }

      const normalizedEmail = normalizeEmail(formData.email);
      if (!normalizedEmail) {
        toast({
          variant: 'destructive',
          title: 'Neplatný e-mail',
          description: 'Zadejte prosím platnou e-mailovou adresu.',
        });
        return;
      }

      const existingMethods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
      if (existingMethods.length > 0) {
        toast({
          variant: 'destructive',
          title: 'E-mail je již registrován',
          description:
            'Účet s tímto e-mailem už v systému existuje. Přihlaste se, nebo použijte jinou adresu.',
        });
        return;
      }

      const fullAddressBlock = [street, [zip, city].filter(Boolean).join(' '), country]
        .filter(Boolean)
        .join('\n')
        .trim();

      // 1. Firebase Authentication – nejdřív účet, teprve potom zápis do Firestore
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        formData.password
      );
      const user = userCredential.user;
      createdUser = user;

      await updateProfile(user, { displayName: formData.adminName });

      // 2. Generate organization/company id (slug + random suffix)
      const slug = formData.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const companyId = `${slug}-${Math.random().toString(36).substring(2, 7)}`;

      // 3. Minimální metadata firmy — žádné demo záznamy, žádné subkolekce (zakázky, zákazníci, …).
      // Kolekce jako jobs / customers / jobTemplates se vytvoří až při prvním použití.
      const enabledModules = [...DEFAULT_LICENSE.enabledModules];
      const companyPayload = {
        id: companyId,
        companyName: formData.companyName.trim(),
        name: formData.companyName.trim(),
        slug,
        /** Povinné identifikační a kontaktní údaje z registrace (nevzorová data). */
        ico: formData.ico.replace(/\s+/g, ''),
        dic: formData.dic?.trim() || null,
        legalForm: formData.legalForm?.trim() || null,
        email: normalizedEmail,
        phone: (formData.phone ?? '').trim(),
        address: fullAddressBlock,
        registeredAddressFull:
          formData.registeredAddressFull.trim() || fullAddressBlock,
        companyAddressStreetAndNumber: street,
        companyAddressCity: city,
        companyAddressPostalCode: zip,
        companyAddressCountry: country,
        establishedAt: formData.establishedAt?.trim() || null,
        ownerId: user.uid,
        ownerUserId: user.uid,
        active: true,
        isActive: true,
        licenseId: DEFAULT_LICENSE.licenseType,
        license: {
          licenseType: DEFAULT_LICENSE.licenseType,
          status: DEFAULT_LICENSE.status,
          expirationDate: null,
          maxUsers: DEFAULT_LICENSE.maxUsers,
          enabledModules,
        },
        enabledModuleIds: enabledModules,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const batch = writeBatch(db);

      // 4. Stejný dokument pro superadmin (společnosti) a portál (companies) — bez kopírování z jiných firem.
      batch.set(doc(db, ORGANIZATIONS_COLLECTION, companyId), companyPayload);
      batch.set(doc(db, COMPANIES_COLLECTION, companyId), companyPayload);

      // 5. Uživatel (owner) vázaný na firmu
      batch.set(doc(db, USERS_COLLECTION, user.uid), {
        id: user.uid,
        email: normalizedEmail,
        displayName: formData.adminName,
        companyId,
        role: 'owner',
        globalRoles: [],
        createdAt: serverTimestamp(),
      });

      // 6. Role owner pro tuto organizaci
      batch.set(doc(db, USERS_COLLECTION, user.uid, 'company_roles', companyId), {
        role: 'owner',
        assignedAt: serverTimestamp(),
      });

      await batch.commit();

      createdUser = null;

      toast({
        title: "Registrace úspěšná",
        description: `Vaše firma byla zaregistrována. Vítejte v ${PLATFORM_NAME}!`
      });

      router.push('/portal/dashboard');
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };

      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (rollbackErr: unknown) {
          console.error('[register] rollback: deleteUser failed', rollbackErr);
        }
      }

      console.error('[register] registration failed', error);

      let description =
        err?.message || 'Nepodařilo se dokončit registraci. Zkuste to prosím znovu.';

      if (err?.code === 'auth/email-already-in-use') {
        description =
          'Tento e-mail je již obsazený. Přihlaste se nebo zadejte jinou adresu.';
      } else if (err?.code === 'auth/weak-password') {
        description = 'Heslo je příliš slabé. Zvolte silnější heslo.';
      } else if (err?.code === 'auth/invalid-email') {
        description = 'Neplatný formát e-mailové adresy.';
      }

      toast({
        variant: "destructive",
        title: "Chyba při registraci",
        description,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:block relative bg-black overflow-hidden">
        <Image 
          src="https://picsum.photos/seed/rajmondata-register/1200/1200"
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
            <div className="mb-2 flex justify-start">
              <Logo context="page" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">Registrace nové firmy</CardTitle>
            <CardDescription>Vytvořte si vlastní workspace a začněte spravovat svůj podnik.</CardDescription>
          </CardHeader>
          <form onSubmit={handleRegister}>
            <CardContent className="space-y-6">
              {firebaseConfigError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {firebaseConfigError}
                </div>
              ) : null}
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
                  <div className="flex gap-2 items-end">
                    <Input
                      id="ico"
                      placeholder="12345678"
                      value={formData.ico}
                      onChange={handleChange}
                      className="bg-background border-border"
                      required
                    />
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      onClick={lookupIcoFromRegistry}
                      disabled={icoLookupLoading}
                    >
                      {icoLookupLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Načíst z ARES"
                      )}
                    </Button>
                  </div>

                  {icoLookupError ? (
                    <p className="text-xs text-destructive">{icoLookupError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Údaje po načtení můžete ručně upravit.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dic">DIČ</Label>
                  <Input
                    id="dic"
                    placeholder="DIČ (pokud je dostupné)"
                    value={formData.dic}
                    onChange={handleChange}
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legalForm">Právní forma</Label>
                  <Input
                    id="legalForm"
                    placeholder="např. s.r.o., a.s., z.s."
                    value={formData.legalForm}
                    onChange={handleChange}
                    className="bg-background border-border"
                  />
                </div>
              </div>

              {icoLookupResults.length > 1 && (
                <div className="space-y-2">
                  <Label>Vyberte správnou firmu</Label>
                  <div className="flex flex-col gap-2">
                    {icoLookupResults.map((r, idx) => (
                      <Button
                        key={`${r.ico}-${idx}`}
                        type="button"
                        variant="outline"
                        onClick={() => applyLookupResultToForm(r)}
                        disabled={icoLookupLoading}
                        className="justify-start"
                      >
                        <span className="font-medium">{r.companyName}</span>
                        {r.legalForm ? (
                          <span className="text-muted-foreground ml-2">
                            ({r.legalForm})
                          </span>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Kompletní adresa firmy</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="addressStreetAndNumber">
                      Ulice a číslo popisné
                    </Label>
                    <Input
                      id="addressStreetAndNumber"
                      placeholder="Např. Hlavní 123"
                      value={formData.addressStreetAndNumber}
                      onChange={handleChange}
                      className="bg-background border-border"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="addressCity">Město</Label>
                    <Input
                      id="addressCity"
                      placeholder="Např. Praha"
                      value={formData.addressCity}
                      onChange={handleChange}
                      className="bg-background border-border"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="addressZip">PSČ</Label>
                    <Input
                      id="addressZip"
                      placeholder="11000"
                      value={formData.addressZip}
                      onChange={handleChange}
                      className="bg-background border-border"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="addressCountry">Stát</Label>
                    <Input
                      id="addressCountry"
                      placeholder="Česká republika"
                      value={formData.addressCountry}
                      onChange={handleChange}
                      className="bg-background border-border"
                      required
                    />
                  </div>
                </div>
              </div>

              {formData.establishedAt ? (
                <div className="space-y-2">
                  <Label htmlFor="establishedAt">Datum vzniku (volitelné)</Label>
                  <Input
                    id="establishedAt"
                    value={formData.establishedAt}
                    onChange={handleChange}
                    className="bg-background border-border"
                    placeholder="např. 1. ledna 2014"
                  />
                </div>
              ) : null}

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

              <Button
                type="submit"
                className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20"
                disabled={
                  // On SSR + very first client render, keep disabled stable to avoid hydration mismatch.
                  !hasMounted ? false : Boolean(loading || !areServicesAvailable)
                }
              >
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
