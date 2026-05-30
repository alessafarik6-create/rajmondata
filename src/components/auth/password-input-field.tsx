"use client";

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LIGHT_FORM_CONTROL_CLASS } from "@/lib/light-form-control-classes";
import {
  PUBLIC_AUTH_INPUT_CLASS,
  PUBLIC_AUTH_LABEL_CLASS,
} from "@/lib/public-auth-form-classes";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  error?: string | null;
  /** publicAuth = styl přihlášení; portal = výchozí světlý input portálu */
  variant?: "publicAuth" | "portal";
  onBlur?: () => void;
};

export function PasswordInputField({
  id,
  label,
  value,
  onChange,
  autoComplete = "new-password",
  disabled = false,
  required = true,
  minLength,
  placeholder,
  error,
  variant = "portal",
  onBlur,
}: Props) {
  const [show, setShow] = useState(false);
  const inputClass =
    variant === "publicAuth" ? PUBLIC_AUTH_INPUT_CLASS : `${LIGHT_FORM_CONTROL_CLASS} pr-10`;
  const labelClass = variant === "publicAuth" ? PUBLIC_AUTH_LABEL_CLASS : undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={labelClass}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn(inputClass, error && "border-destructive focus:ring-destructive")}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          minLength={minLength}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 h-9 w-9 -translate-y-1/2 text-slate-500 hover:text-slate-800"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          aria-label={show ? "Skrýt heslo" : "Zobrazit heslo"}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
