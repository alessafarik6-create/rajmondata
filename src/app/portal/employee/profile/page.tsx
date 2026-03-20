"use client";

import React, { useState } from "react";
import {
  useUser,
  useAuth,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/firebase/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2 } from "lucide-react";
import { LIGHT_FORM_CONTROL_CLASS } from "@/lib/light-form-control-classes";
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";

const PROFILE_LABEL_CLASS = "text-sm font-medium text-gray-800";

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
  const { user } = useUser();
  const auth = useAuth();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;
  const photoUrl = profile?.profileImage || profile?.photoUrl;

  const [uploading, setUploading] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);

  const syncProfileImage = async (url: string | null) => {
    if (!user || !firestore) return;
    const uref = doc(firestore, "users", user.uid);
    await updateDoc(uref, {
      profileImage: url,
      updatedAt: serverTimestamp(),
    });
    if (companyId && employeeId) {
      await updateDoc(
        doc(firestore, "companies", companyId, "employees", employeeId),
        {
          profileImage: url,
          updatedAt: serverTimestamp(),
        }
      );
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    setUploading(true);
    try {
      const path = `profile_images/${user.uid}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const sref = ref(storage, path);
      await uploadBytes(sref, file, { contentType: file.type });
      const url = await getDownloadURL(sref);
      await syncProfileImage(url);
      toast({ title: "Fotka nahrána" });
    } catch (err) {
      console.error(err);
      toast({
        variant: "destructive",
        title: "Nahrání selhalo",
        description: "Zkontrolujte Firebase Storage pravidla a konfiguraci.",
      });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoUrl || !user) return;
    setUploading(true);
    try {
      // Volitelně lze doplnit mazání objektu ve Storage (ref z URL závisí na SDK).
      await syncProfileImage(null);
      toast({ title: "Profilová fotka odstraněna" });
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Profil</h1>
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
            <AvatarImage src={photoUrl} className="object-cover" />
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
            <p className="text-xs text-slate-500">
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
              <span className="text-slate-500">Jméno</span>
              <p className="font-medium">{profile?.firstName || "—"}</p>
            </div>
            <div>
              <span className="text-slate-500">Příjmení</span>
              <p className="font-medium">{profile?.lastName || "—"}</p>
            </div>
          </div>
          <div>
            <span className="text-slate-500">Email</span>
            <p className="font-medium">{profile?.email || user?.email || "—"}</p>
          </div>
          <div>
            <span className="text-slate-500">Pracovní pozice</span>
            <p className="font-medium">{profile?.jobTitle || "—"}</p>
          </div>
          <div>
            <span className="text-slate-500">Hodinová sazba</span>
            <p className="font-medium">
              {profile?.hourlyRate != null && profile?.hourlyRate !== ""
                ? `${profile.hourlyRate} Kč/h`
                : "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Organizace</span>
            <p className="font-medium">{companyName || companyId || "—"}</p>
          </div>
          <p className="text-xs text-slate-500 pt-2">
            Změnu jména, pozice a sazby řeší administrátor firmy.
          </p>
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
