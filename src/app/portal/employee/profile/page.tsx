"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  useUser,
  useAuth,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCompany,
  useFirebaseApp,
} from "@/firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, AlertCircle, KeyRound, Briefcase } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const DEBUG = process.env.NODE_ENV === "development";
import { LIGHT_FORM_CONTROL_CLASS } from "@/lib/light-form-control-classes";
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";
import {
  type EmployeeUiLang,
  normalizeEmployeeUiLang,
} from "@/lib/i18n/employee-ui";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { cn } from "@/lib/utils";
import { MIN_TERMINAL_PIN_LENGTH, normalizeTerminalPin } from "@/lib/terminal-pin-validation";
import { useAssignedWorklogJobs } from "@/hooks/use-assigned-worklog-jobs";

const PROFILE_LABEL_CLASS = "text-sm font-medium text-gray-800";

function employeeHasTerminalPinForProfile(
  emp: Record<string, unknown> | null | undefined
): boolean {
  if (!emp) return false;
  if (emp.terminalPinActive === true) return true;
  if (emp.terminalPinActive === false) return false;
  const legacy = emp.attendancePin;
  return legacy != null && String(legacy).length > 0;
}

function mapPasswordChangeError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Současné heslo není správné.";
    case "auth/weak-password":
      return "Nové heslo je příliš slabé. Zvolte delší nebo složitější heslo.";
    case "auth/too-many-requests":
      return "Příliš mnoho pokusů. Zkuste to později.";
    case "auth/user-not-found":
      return "Účet neexistuje nebo byl odstraněn.";
    case "auth/requires-recent-login":
      return "Z bezpečnostních důvodů se znovu přihlaste a opakujte změnu hesla.";
    default:
      return "Změna hesla se nezdařila. Zkuste to znovu.";
  }
}

export default function EmployeeProfilePage() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const firebaseApp = useFirebaseApp();
  const { toast } = useToast();
  const { companyName, isLoading: companyLoading } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } =
    useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;
  const photoUrl =
    profile?.photoURL ?? profile?.profileImage ?? profile?.photoUrl;

  const employeeRowRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeRow, isLoading: employeeRowLoading } =
    useDoc<Record<string, unknown>>(employeeRowRef);

  const {
    assignedJobIds,
    jobs: assignedWorklogJobs,
    jobsLoading: assignedWorklogJobsLoading,
  } = useAssignedWorklogJobs(
    firestore,
    companyId,
    employeeRow ?? undefined,
    employeeRowLoading,
    user?.uid,
    employeeId
  );

  const [uploading, setUploading] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [langSaving, setLangSaving] = useState(false);

  const [tpOld, setTpOld] = useState("");
  const [tpNew, setTpNew] = useState("");
  const [tpConfirm, setTpConfirm] = useState("");
  const [tpSaving, setTpSaving] = useState(false);

  const { t, lang: uiLang } = useEmployeeUiLang(profile);

  useEffect(() => {
    if (!DEBUG) return;
    console.log("[employee/profile]", {
      route: pathname,
      uid: user?.uid ?? null,
      companyId: companyId ?? null,
      employeeId: employeeId ?? null,
      hasProfile: !!profile,
      isUserLoading,
      profileLoading,
      companyLoading,
      profileError: profileError?.message ?? null,
    });
  }, [
    pathname,
    user?.uid,
    companyId,
    employeeId,
    profile,
    isUserLoading,
    profileLoading,
    companyLoading,
    profileError,
  ]);

  const syncProfileImage = async (url: string | null): Promise<{ employeeSynced: boolean }> => {
    if (!user || !firestore) return { employeeSynced: false };
    const uref = doc(firestore, "users", user.uid);
    await updateDoc(uref, {
      photoURL: url,
      profileImage: url,
      updatedAt: serverTimestamp(),
    });
    let employeeSynced = !companyId || !employeeId;
    if (companyId && employeeId) {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/employee/profile-photo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ photoURL: url }),
        });
        employeeSynced = res.ok;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.warn("[employee/profile] employee doc photo sync failed", data);
        }
      } catch (e) {
        console.warn("[employee/profile] employee doc photo sync error", e);
      }
    }
    if (auth) {
      try {
        await updateProfile(user, { photoURL: url ?? "" });
      } catch {
        /* Auth profilová fotka je volitelná; Firestore je zdroj pravdy. */
      }
    }
    return { employeeSynced };
  };

  const runPhotoUpload = async (file: File) => {
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Soubor musí být obrázek",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Soubor je příliš velký (max 5 MB)",
      });
      return;
    }
    if (!firebaseApp) {
      toast({
        variant: "destructive",
        title: "Aplikace není připravena",
        description: "Zkuste obnovit stránku.",
      });
      return;
    }
    setUploading(true);
    console.log("Uploading employee profile photo");
    try {
      const storage = getStorage(firebaseApp);
      const path = `profile_images/${user.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: file.type });
      const url = await getDownloadURL(sref);
      const { employeeSynced } = await syncProfileImage(url);
      console.log("Employee profile photo uploaded successfully");
      if (employeeSynced) {
        toast({ title: "Fotka nahrána", description: "Profilová fotka byla uložena." });
      } else {
        toast({
          variant: "destructive",
          title: "Fotka uložena jen částečně",
          description:
            "Účet má fotku, ale záznam zaměstnance (terminál) se nepodařilo aktualizovat. Zkuste to znovu nebo kontaktujte administrátora.",
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Nahrání selhalo",
        description: "Zkontrolujte Firebase Storage pravidla a konfiguraci.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await runPhotoUpload(file);
    } finally {
      e.target.value = "";
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoUrl || !user) return;
    setUploading(true);
    try {
      // Volitelně lze doplnit mazání objektu ve Storage (ref z URL závisí na SDK).
      const { employeeSynced } = await syncProfileImage(null);
      if (employeeSynced) {
        toast({ title: "Profilová fotka odstraněna" });
      } else {
        toast({
          variant: "destructive",
          title: "Smazání částečné",
          description: "Účet byl aktualizován, záznam pro terminál ne.",
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Smazání selhalo",
      });
    } finally {
      setUploading(false);
    }
  };

  const saveUiLanguage = async (next: EmployeeUiLang) => {
    if (!user || !firestore) return;
    setLangSaving(true);
    try {
      await updateDoc(doc(firestore, "users", user.uid), {
        language: next,
        updatedAt: serverTimestamp(),
      });
      toast({ title: t("saved"), description: "" });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Jazyk se nepodařilo uložit.",
      });
    } finally {
      setLangSaving(false);
    }
  };

  const handleTerminalPinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setTpSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/employee/terminal-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          oldPin: normalizeTerminalPin(tpOld),
          newPin: normalizeTerminalPin(tpNew),
          newPinConfirm: normalizeTerminalPin(tpConfirm),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Uložení PINu se nezdařilo."
        );
      }
      setTpOld("");
      setTpNew("");
      setTpConfirm("");
      toast({
        title: "PIN uložen",
        description:
          (data as { message?: string }).message ||
          "PIN docházky byl změněn.",
      });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: err instanceof Error ? err.message : "Zkuste to znovu.",
      });
    } finally {
      setTpSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !auth) return;
    if (pwdNew.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
      toast({
        variant: "destructive",
        title: "Heslo je příliš krátké",
        description: `Nové heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`,
      });
      return;
    }
    if (pwdNew !== pwdConfirm) {
      toast({
        variant: "destructive",
        title: "Hesla se neshodují",
      });
      return;
    }
    setPwdLoading(true);
    try {
      const cred = EmailAuthProvider.credential(user.email, pwdCurrent);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, pwdNew);
      setPwdCurrent("");
      setPwdNew("");
      setPwdConfirm("");
      toast({
        title: "Heslo bylo změněno",
        description: "Od příštího přihlášení použijte nové heslo.",
      });
    } catch (err: unknown) {
      console.error(err);
      const msg = mapPasswordChangeError(err);
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setPwdLoading(false);
    }
  };

  const displayName =
    profile?.displayName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    user?.email;

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Profil nebyl nalezen</AlertTitle>
        <AlertDescription>
          Dokument uživatele ve Firestore chybí. Kontaktujte administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba načtení profilu</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">{t("profile")}</h1>
        <p className="portal-page-description">
          Vaše údaje a nastavení účtu.
        </p>
      </div>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Profilová fotka</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row items-start gap-6">
          <Avatar className="h-28 w-28 border-4 border-primary/20">
            <AvatarImage
              key={photoUrl ? String(photoUrl).slice(0, 120) : "none"}
              src={photoUrl ? String(photoUrl) : undefined}
              className="object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <AvatarFallback className="text-2xl bg-primary text-white">
              {displayName?.[0]?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="emp-profile-photo"
              onChange={handleUpload}
            />
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              id="emp-profile-photo-camera"
              onChange={handleUpload}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                disabled={uploading}
                className="gap-2"
                onClick={() =>
                  document.getElementById("emp-profile-photo")?.click()
                }
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {photoUrl ? "Změnit fotku" : "Nahrát fotku"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                className="gap-2 sm:hidden"
                onClick={() =>
                  document.getElementById("emp-profile-photo-camera")?.click()
                }
              >
                Vyfoť
              </Button>
              {photoUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 text-destructive border-destructive/40"
                  disabled={uploading}
                  onClick={handleRemovePhoto}
                >
                  <Trash2 className="w-4 h-4" />
                  Smazat fotku
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-slate-800">
              JPG, PNG… max 5 MB. Fotka se zobrazí na hlavní stránce portálu.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Údaje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="text-slate-800">Jméno</span>
              <p className="font-medium">{profile?.firstName || "—"}</p>
            </div>
            <div>
              <span className="text-slate-800">Příjmení</span>
              <p className="font-medium">{profile?.lastName || "—"}</p>
            </div>
          </div>
          <div>
            <span className="text-slate-800">Email</span>
            <p className="font-medium">{profile?.email || user?.email || "—"}</p>
          </div>
          <div>
            <span className="text-slate-800">Pracovní pozice</span>
            <p className="font-medium">{profile?.jobTitle || "—"}</p>
          </div>
          <div>
            <span className="text-slate-800">Hodinová sazba</span>
            <p className="font-medium">
              {profile?.hourlyRate != null && profile?.hourlyRate !== ""
                ? `${profile.hourlyRate} Kč/h`
                : "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-800">Organizace</span>
            <p className="font-medium">
              {companyName && companyName !== "Organization"
                ? companyName
                : companyId || "—"}
            </p>
          </div>
          <p className="text-xs text-slate-800 pt-2">
            Změnu jména, pozice a sazby řeší administrátor firmy.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-black">
            <Briefcase className="h-5 w-5 shrink-0 text-primary" />
            Výkaz práce — přiřazené zakázky
          </CardTitle>
          <p className="text-sm text-slate-800 font-normal pt-1">
            Zakázky níže máte přiřazené v systému (správa u administrátora). Ve výkazu práce je u každého řádku
            můžete ručně vybrat k popisu práce — nezávisle na tom, co jste případně vybrali na terminálu docházky.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!companyId || !employeeId ? (
            <p className="text-sm text-slate-800">Pro zobrazení zakázek musíte mít propojený účet zaměstnance.</p>
          ) : assignedWorklogJobsLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítání přiřazených zakázek…
            </div>
          ) : assignedJobIds.length === 0 ? (
            <p className="text-sm text-slate-800 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
              Nemáte přiřazené žádné zakázky. Ve výkazu můžete zapisovat interní práci bez zakázky; přiřazení
              zakázek řeší administrátor.
            </p>
          ) : (
            <ul className="space-y-2">
              {assignedWorklogJobs.map((j) => (
                <li
                  key={j.id}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <span className="font-medium">{j.name?.trim() || j.id}</span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="default" className="w-full sm:w-auto">
            <Link href="/portal/employee/daily-reports">Otevřít výkaz práce</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>{t("language")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(
            [
              { code: "cs" as const, label: t("languageCs") },
              { code: "ua" as const, label: t("languageUa") },
            ] as const
          ).map(({ code, label }) => (
            <Button
              key={code}
              type="button"
              variant={normalizeEmployeeUiLang(profile?.language) === code ? "default" : "outline"}
              disabled={langSaving}
              className={cn(
                normalizeEmployeeUiLang(profile?.language) === code && "pointer-events-none"
              )}
              onClick={() => void saveUiLanguage(code)}
            >
              {langSaving && uiLang === code ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {label}
            </Button>
          ))}
          <p className="w-full text-xs text-slate-800 pt-1">
            Ovlivňuje rozhraní zaměstnaneckého portálu a jazyk popisu ve výkazu
            práce.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-black flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            PIN pro terminál docházky
          </CardTitle>
          <p className="text-sm text-gray-600 font-normal pt-1">
            PIN použijete na sdíleném docházkovém terminálu (tablet). Ukládá se jen jako zabezpečený hash —
            nikdy jako čitelný text v databázi.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {employeeRowLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítání stavu PINu…
            </div>
          ) : !employeeHasTerminalPinForProfile(employeeRow) ? (
            <p className="text-sm text-slate-800">
              Administrátor zatím nenastavil PIN pro terminál. Po obdržení výchozího PINu od administrátora si
              jej zde můžete změnit na vlastní.
            </p>
          ) : (
            <>
              {employeeRow?.terminalPinNeedsChange === true && (
                <Alert className="border-amber-500/50 bg-amber-50/80">
                  <AlertCircle className="h-4 w-4 text-amber-700" />
                  <AlertTitle className="text-amber-900">Je potřeba změnit výchozí PIN</AlertTitle>
                  <AlertDescription className="text-amber-950/90">
                    Administrátor nastavil nový výchozí PIN. Nastavte si vlastní PIN ({MIN_TERMINAL_PIN_LENGTH}–12
                    číslic), aby byl účet v terminálu chráněný.
                  </AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleTerminalPinChange} className="space-y-4 w-full max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="tp-old" className={PROFILE_LABEL_CLASS}>
                    Současný PIN
                  </Label>
                  <Input
                    id="tp-old"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={tpOld}
                    onChange={(e) => setTpOld(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    className={LIGHT_FORM_CONTROL_CLASS}
                    placeholder="Výchozí nebo aktuální PIN"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tp-new" className={PROFILE_LABEL_CLASS}>
                    Nový PIN
                  </Label>
                  <Input
                    id="tp-new"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={tpNew}
                    onChange={(e) => setTpNew(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    className={LIGHT_FORM_CONTROL_CLASS}
                    placeholder={`${MIN_TERMINAL_PIN_LENGTH}–12 číslic`}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tp-c" className={PROFILE_LABEL_CLASS}>
                    Potvrzení nového PINu
                  </Label>
                  <Input
                    id="tp-c"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={tpConfirm}
                    onChange={(e) => setTpConfirm(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    className={LIGHT_FORM_CONTROL_CLASS}
                  />
                </div>
                <Button type="submit" disabled={tpSaving} className="w-full sm:w-auto">
                  {tpSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Uložit nový PIN"
                  )}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-black">Změna hesla</CardTitle>
          <p className="text-sm text-gray-600 font-normal pt-1">
            Pro změnu hesla zadejte současné heslo a nové heslo (min.{" "}
            {MIN_EMPLOYEE_PASSWORD_LENGTH} znaků). Heslo se ukládá pouze v
            přihlášení Firebase, ne do databáze.
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handlePasswordChange}
            className="space-y-4 w-full max-w-md"
          >
            <div className="space-y-2">
              <Label htmlFor="pwd-c" className={PROFILE_LABEL_CLASS}>
                Aktuální heslo
              </Label>
              <Input
                id="pwd-c"
                type="password"
                autoComplete="current-password"
                value={pwdCurrent}
                onChange={(e) => setPwdCurrent(e.target.value)}
                className={LIGHT_FORM_CONTROL_CLASS}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-n" className={PROFILE_LABEL_CLASS}>
                Nové heslo
              </Label>
              <Input
                id="pwd-n"
                type="password"
                autoComplete="new-password"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
                className={LIGHT_FORM_CONTROL_CLASS}
                required
                minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                placeholder={`Min. ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd-r" className={PROFILE_LABEL_CLASS}>
                Potvrzení nového hesla
              </Label>
              <Input
                id="pwd-r"
                type="password"
                autoComplete="new-password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                className={LIGHT_FORM_CONTROL_CLASS}
                required
                minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
              />
            </div>
            <Button type="submit" disabled={pwdLoading} className="w-full sm:w-auto">
              {pwdLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Uložit nové heslo"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
