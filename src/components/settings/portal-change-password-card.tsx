"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInputField } from "@/components/auth/password-input-field";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import {
  PASSWORD_MISMATCH_MESSAGE,
  validateNewPasswordForm,
} from "@/lib/new-password-form-validation";

export function PortalChangePasswordCard() {
  const { user } = useUser();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    current?: string;
    password?: string;
    confirm?: string;
  }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const clientErrors = validateNewPasswordForm({
      password: newPassword,
      confirm: confirmPassword,
    });
    const nextErrors: typeof fieldErrors = {};
    if (!currentPassword.trim()) {
      nextErrors.current = "Vyplňte současné heslo.";
    }
    if (clientErrors.password) nextErrors.password = clientErrors.password;
    if (clientErrors.confirm) nextErrors.confirm = clientErrors.confirm;
    if (
      currentPassword.trim() &&
      newPassword.trim() &&
      currentPassword.trim() === newPassword.trim()
    ) {
      nextErrors.password = "Nové heslo musí být odlišné od současného.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: currentPassword.trim(),
          newPassword: newPassword.trim(),
          confirmPassword: confirmPassword.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Změna hesla se nezdařila.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Heslo bylo úspěšně změněno.",
        description: "Od příštího přihlášení použijte nové heslo.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Změna hesla",
        description: err instanceof Error ? err.message : "Zkuste to znovu.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Změna hesla</CardTitle>
        <CardDescription>Heslo k přihlášení do portálu RAJMONDATA.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(ev) => void submit(ev)} className="max-w-md space-y-4">
          <PasswordInputField
            id="portal-pwd-current"
            label="Současné heslo"
            value={currentPassword}
            onChange={(v) => {
              setCurrentPassword(v);
              setFieldErrors((e) => ({ ...e, current: undefined }));
            }}
            autoComplete="current-password"
            error={fieldErrors.current}
          />
          <PasswordInputField
            id="portal-pwd-new"
            label="Nové heslo"
            value={newPassword}
            onChange={(v) => {
              setNewPassword(v);
              setFieldErrors((e) => ({ ...e, password: undefined }));
            }}
            autoComplete="new-password"
            error={fieldErrors.password}
          />
          <PasswordInputField
            id="portal-pwd-confirm"
            label="Potvrzení nového hesla"
            value={confirmPassword}
            onChange={(v) => {
              setConfirmPassword(v);
              setFieldErrors((e) => ({ ...e, confirm: undefined }));
            }}
            autoComplete="new-password"
            error={fieldErrors.confirm ?? (confirmPassword && newPassword !== confirmPassword ? PASSWORD_MISMATCH_MESSAGE : undefined)}
          />
          <Button type="submit" disabled={busy || !user} className="min-h-[44px]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Změnit heslo"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
