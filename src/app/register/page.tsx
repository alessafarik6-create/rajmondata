
"use client";

import React, { useMemo, useState } from "react";
import { useFirebase } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Logo } from "@/components/ui/logo";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import Link from "next/link";
import { PublicAuthMediaPanel } from "@/components/marketing/public-auth-media-panel";
import { usePublicLandingConfig } from "@/lib/use-public-landing-config";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  fetchSignInMethodsForEmail,
  deleteUser,
  type User,
} from 'firebase/auth';
import { doc, writeBatch, serverTimestamp, getDocs, collection } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import {
  ORGANIZATIONS_COLLECTION,
  COMPANIES_COLLECTION,
  USERS_COLLECTION,
  COMPANY_LICENSES_COLLECTION,
  PLATFORM_MODULES_COLLECTION,
} from '@/lib/firestore-collections';
import { companyDocPlatformFields, createPendingCompanyLicense } from '@/lib/company-license-record';
import {
  buildMergedPlatformCatalogMap,
  companyLicenseFromCatalogForNewOrg,
} from '@/lib/platform-module-catalog';
import {
  lookupCzechCompanyByIco,
  type CompanyLookupResult,
} from '@/lib/company-lookup-api';

/** Jednotná normalizace e-mailu pro Firebase (registrace i přihlášení). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export default function RegisterPage() {
  const { auth, firestore: db, areServicesAvailable, firebaseConfigError } =
    useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  const { data: landingCfg } = usePublicLandingConfig();
  const seo = landingCfg?.seo;

  const registerImages = useMemo((): PlatformSeoHeroImage[] => {
    const raw = seo?.registerImages;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof (x as PlatformSeoHeroImage).url === "string") as PlatformSeoHeroImage[];
  }, [seo?.registerImages]);
  const registerVideo = (seo?.registerVideo as PlatformSeoPromoVideo | null) ?? null;

  const regTitle =
    (typeof seo?.registerPageTitle === "string" && seo.registerPageTitle.trim()) || "Registrace nové firmy";
  const regSubtitle =
    (typeof seo?.registerPageSubtitle === "string" && seo.registerPageSubtitle.trim()) ||
    "Vytvořte si firemní účet. Licence čeká na aktivaci administrátorem.";
  const regHelper =
    (typeof seo?.registerPageHelperText === "string" && seo.registerPageHelperText.trim()) || "";
  const regMediaTitle = PLATFORM_NAME;
  const regMediaSubtitle =
    "Jedno místo pro tým, zakázky a provoz. Vyplňte firemní údaje a založte si účet správce.";
  const loginCta =
    (typeof seo?.loginButtonText === "string" && seo.loginButtonText.trim()) || "Zpět na přihlášení";
  
  const [loading, setLoading] = useState(false);
  // Prevent hydration mismatches for props like `disabled` that depend on client-only Firebase availability.
  const [hasMounted, setHasMounted] = useState(false);
  const [icoLookupLoading, setIcoLookupLoading] = useState(false);
  const [icoLookupError, setIcoLookupError] = useState<string | null>(null);
  const [icoLookupResults, setIcoLookupResults] = useState<CompanyLookupResult[]>([]);

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

  const applyLookupResultToForm = (res: CompanyLookupResult) => {
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
    setIcoLookupError(null);
    setIcoLookupLoading(true);
    try {
      const results = await lookupCzechCompanyByIco(formData.ico, { timeoutMs: 13_000 });
      if (results.length === 1) {
        applyLookupResultToForm(results[0]);
        return;
      }
      setIcoLookupResults(results);
      toast({
        title: "Nalezeno více výsledků",
        description: "Vyberte prosím správnou firmu ze seznamu.",
      });
    } catch (e: unknown) {
      console.error("[register] lookupIco failed", e);
      const msg = e instanceof Error ? e.message : "Nepodařilo se načíst údaje z ARES.";
      setIcoLookupError(msg);
      setIcoLookupResults([]);
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
      // Licence: výchozí moduly z globálního katalogu platform_modules (+ fallback z kódu).
      let pendingLicense = createPendingCompanyLicense(companyId);
      try {
        const modSnap = await getDocs(collection(db, PLATFORM_MODULES_COLLECTION));
        const catalogDocs = modSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const catalogMap = buildMergedPlatformCatalogMap(catalogDocs);
        pendingLicense = companyLicenseFromCatalogForNewOrg(companyId, catalogMap);
      } catch (e) {
        console.warn("[register] platform_modules read failed, using empty license modules", e);
      }
      const platformDenorm = companyDocPlatformFields(pendingLicense);
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
        active: false,
        isActive: false,
        licenseId: 'starter',
        ...platformDenorm,
        onboardingCompleted: false,
        onboardingStep: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const batch = writeBatch(db);

      // 4. Stejný dokument pro superadmin (společnosti) a portál (companies) — id = companyId, merge pro idempotenci.
      batch.set(doc(db, ORGANIZATIONS_COLLECTION, companyId), companyPayload, { merge: true });
      batch.set(doc(db, COMPANIES_COLLECTION, companyId), companyPayload, { merge: true });
      batch.set(doc(db, COMPANY_LICENSES_COLLECTION, companyId), {
        ...pendingLicense,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 5. Uživatel (owner) vázaný na firmu
      batch.set(
        doc(db, USERS_COLLECTION, user.uid),
        {
          uid: user.uid,
          id: user.uid,
          email: normalizedEmail,
          name: formData.adminName.trim(),
          displayName: formData.adminName.trim(),
          companyId,
          role: "owner",
          globalRoles: [],
          language: "cs",
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 6. Role owner pro tuto organizaci
      batch.set(doc(db, USERS_COLLECTION, user.uid, 'company_roles', companyId), {
        role: 'owner',
        assignedAt: serverTimestamp(),
      });

      await batch.commit();

      console.info("[Platform]", "Company registered with inactive license", { companyId });

      createdUser = null;

      toast({
        title: "Registrace úspěšná",
        description: `Účet byl vytvořen. Licence čeká na aktivaci administrátorem platformy — poté budou dostupné placené moduly. Vítejte v ${PLATFORM_NAME}!`,
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
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
        <div className="order-2 min-h-0 w-full min-w-0 shrink-0 lg:order-1">
          <PublicAuthMediaPanel
            images={registerImages}
            video={registerVideo}
            title={regMediaTitle}
            subtitle={regMediaSubtitle}
            backLink="/login"
            backLabel={
              <span className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                {loginCta}
              </span>
            }
          />
        </div>

        <div className="order-1 flex w-full min-w-0 items-start justify-center px-3 py-6 sm:px-5 sm:py-8 lg:order-2 lg:items-center lg:px-8">
        <Card className="w-full max-w-xl border-slate-200 bg-white text-slate-900 shadow-2xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:text-slate-900 [&_label]:text-slate-800">
          <CardHeader className="space-y-2 px-4 sm:px-6">
            <div className="mb-1 flex justify-start lg:hidden">
              <Link
                href="/login"
                className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
                {loginCta}
              </Link>
            </div>
            <div className="mb-1 flex justify-start">
              <Logo context="page" compact />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight sm:text-3xl">{regTitle}</CardTitle>
            <CardDescription className="text-slate-600 text-sm sm:text-base">{regSubtitle}</CardDescription>
          </CardHeader>
          <form onSubmit={handleRegister}>
            <CardContent className="space-y-5 px-4 sm:space-y-6 sm:px-6">
              {firebaseConfigError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {firebaseConfigError}
                </div>
              ) : null}
              {regHelper ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                  {regHelper}
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
          <CardFooter className="mt-4 justify-center border-t border-slate-200 pt-5">
            <p className="text-sm text-slate-600">
              Již máte firemní účet?{" "}
              <Link href="/login" className="font-semibold text-orange-600 hover:underline">
                {loginCta}
              </Link>
            </p>
          </CardFooter>
        </Card>
        </div>
      </div>
    </div>
  );
}
