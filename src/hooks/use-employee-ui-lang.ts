"use client";

import { useMemo } from "react";
import {
  employeeUiT,
  normalizeEmployeeUiLang,
  type EmployeeUiKey,
  type EmployeeUiLang,
} from "@/lib/i18n/employee-ui";

export function useEmployeeUiLang(
  profile: { language?: unknown } | null | undefined
): { lang: EmployeeUiLang; t: (key: EmployeeUiKey) => string } {
  const lang = useMemo(
    () => normalizeEmployeeUiLang(profile?.language),
    [profile?.language]
  );
  const t = useMemo(
    () => (key: EmployeeUiKey) => employeeUiT(lang, key),
    [lang]
  );
  return { lang, t };
}
