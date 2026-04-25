'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { doc, type Timestamp } from 'firebase/firestore';
import { useUser, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { isGlobalAdminAppPath } from '@/lib/global-admin-shell';
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from '@/lib/firestore-collections';
import type { DocumentEmailOutboundSettings } from '@/lib/document-email-outbound';
import { MODULE_KEYS } from '@/lib/license-modules';

export type CompanyProfile = {
  id: string;
  companyName: string;
  ico?: string;
  dic?: string;
  email?: string;
  phone?: string;
  web?: string;
  legalForm?: string;
  establishedAt?: any;
  publicProfile?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;

  /** Licence — po merge se bere z `společnosti` (stejný zdroj jako superadmin), jinak z `companies`. */
  license?: {
    status?: string;
    licenseStatus?: string;
    enabledModules?: string[];
    modules?: {
      jobs?: boolean;
      attendance?: boolean;
      finance?: boolean;
      sklad?: boolean;
      vyroba?: boolean;
    };
    licenseType?: string;
    expirationDate?: string | null;
    maxUsers?: number | null;
  };

  /** Globální licence (denormalizace z company_licenses). */
  platformLicense?: {
    active?: boolean;
    status?: string;
    expiresAt?: string | null;
    activatedAt?: string | null;
    activatedBy?: string | null;
  };
  moduleEntitlements?: Record<
    string,
    { active?: boolean; expiresAt?: string | null; activatedAt?: string | null }
  >;
  /**
   * Top-level `modules` na `companies` / `společnosti` — stejné klíče jako v superadminu (MODULE_KEYS).
   */
  modules?: Record<string, boolean>;
  active?: boolean;
  isActive?: boolean;

  /**
   * Externí JSON endpoint pro import poptávek (Zakázky → Poptávky).
   */
  poptavkyImportUrl?: string | null;

  /**
   * Po 24 h od konce pracovního dne zamknout úpravy denního výkazu (zaměstnanec jen čte).
   */
  enableDailyReport24hLock?: boolean;

  /**
   * Structured company address.
   * Used for "Smlouva o dílo" (Dodavatel) + settings form.
   */
  companyAddressStreetAndNumber?: string;
  companyAddressCity?: string;
  companyAddressPostalCode?: string;
  companyAddressCountry?: string;

  /**
   * Legacy/backward-compatibility fields.
   * Kept because other parts of the app might still reference them.
   */
  registeredOfficeAddress?: string;
  address?: string;

  /** Logo firmy pro doklady (URL z Firebase Storage). */
  organizationLogoUrl?: string | null;

  /** Elektronický podpis organizace (URL z Firebase Storage + metadata). */
  organizationSignature?: {
    url?: string;
    storagePath?: string;
    updatedAt?: unknown;
    updatedBy?: string;
    /** Jméno osoby, která podpis naposledy uložila (z API). */
    signedByName?: string | null;
    contentType?: string;
  } | null;

  /** Centrální nastavení modulových e-mailových notifikací (viz email-notifications/schema). */
  emailNotifications?: unknown;

  /** Šablony a CC pro odesílání dokumentů ze zakázky e-mailem. */
  documentEmailOutbound?: DocumentEmailOutboundSettings | null;

  /**
   * Povolit zaměstnancům úpravu vlastního bankovního účtu v profilu (API employee/bank-account).
   */
  allowEmployeeBankAccountSelfEdit?: boolean;

  /**
   * `false` = v profilu / peněžním přehledu se zaměstnanci nezobrazí vlastní dluhy.
   */
  allowEmployeeDebtSelfView?: boolean;
};

function resolveTenantCompanyId(userProfile: unknown): string | undefined {
  if (!userProfile || typeof userProfile !== 'object') return undefined;
  const u = userProfile as Record<string, unknown>;
  const raw = u.companyId ?? u.organizationId;
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (raw && typeof raw === 'object' && 'path' in raw) {
    const p = String((raw as { path?: string }).path ?? '');
    const seg = p.split('/').filter(Boolean);
    const last = seg[seg.length - 1];
    if (last) return last;
  }
  return undefined;
}

function mergeLicenseDocuments(fromCompanies: unknown, fromOrg: unknown): unknown {
  const c =
    fromCompanies && typeof fromCompanies === 'object'
      ? (fromCompanies as Record<string, unknown>)
      : null;
  const o = fromOrg && typeof fromOrg === 'object' ? (fromOrg as Record<string, unknown>) : null;
  if (!c && !o) return undefined;
  if (!c) return { ...o };
  if (!o) return { ...c };
  const out: Record<string, unknown> = { ...c, ...o };
  const pickStr = (a: unknown, b: unknown) => {
    if (b != null && String(b).trim() !== '') return b;
    if (a != null && String(a).trim() !== '') return a;
    return undefined;
  };
  const st = pickStr(c.status, o.status);
  const lst = pickStr(c.licenseStatus, o.licenseStatus);
  if (st !== undefined) out.status = st;
  if (lst !== undefined) out.licenseStatus = lst;
  const cm = c.modules;
  const om = o.modules;
  if (typeof cm === 'object' && cm && typeof om === 'object' && om) {
    out.modules = { ...(cm as Record<string, unknown>), ...(om as Record<string, unknown>) };
  } else {
    out.modules = om ?? cm ?? out.modules;
  }
  const al = Array.isArray(c.enabledModules) ? c.enabledModules.length : 0;
  const bl = Array.isArray(o.enabledModules) ? o.enabledModules.length : 0;
  out.enabledModules =
    bl >= al ? o.enabledModules ?? c.enabledModules : c.enabledModules ?? o.enabledModules;
  for (const key of ['expirationDate', 'licenseExpiresAt', 'licenseType', 'maxUsers']) {
    if (o[key] !== undefined && o[key] !== null) out[key] = o[key];
    else if (c[key] !== undefined) out[key] = c[key];
  }
  return out;
}

function pickBetterPlatformLicense(fromCompanies: unknown, fromOrg: unknown): unknown {
  const cp =
    fromCompanies && typeof fromCompanies === 'object'
      ? (fromCompanies as Record<string, unknown>)
      : null;
  const op = fromOrg && typeof fromOrg === 'object' ? (fromOrg as Record<string, unknown>) : null;
  if (!cp) return op;
  if (!op) return cp;
  const score = (p: Record<string, unknown>) => {
    const s = String(p.status ?? '').toLowerCase();
    const active = p.active === true;
    if (s === 'active' && active) return 4;
    if (s === 'active') return 3;
    if (active) return 2;
    if (s === 'pending') return 0;
    return 1;
  };
  return score(op) >= score(cp) ? op : cp;
}

const MERGED_TOP_LEVEL_MODULE_KEYS = MODULE_KEYS;

function mergeTopLevelCompanyModules(c: unknown, o: unknown): Record<string, boolean> | undefined {
  const cm = c && typeof c === 'object' ? (c as Record<string, boolean>) : null;
  const om = o && typeof o === 'object' ? (o as Record<string, boolean>) : null;
  if (!cm && !om) return undefined;
  const out: Record<string, boolean> = {};
  for (const k of MERGED_TOP_LEVEL_MODULE_KEYS) {
    if (om && Object.prototype.hasOwnProperty.call(om, k)) {
      out[k] = Boolean(om[k]);
    } else if (cm && Object.prototype.hasOwnProperty.call(cm, k)) {
      out[k] = Boolean(cm[k]);
    } else {
      out[k] = false;
    }
  }
  return out;
}

function mergeModuleEntitlementsMaps(fromCompanies: unknown, fromOrg: unknown): unknown {
  const ce =
    fromCompanies && typeof fromCompanies === 'object'
      ? (fromCompanies as Record<string, unknown>)
      : null;
  const oe =
    fromOrg && typeof fromOrg === 'object' ? (fromOrg as Record<string, unknown>) : null;
  if (!ce && !oe) return undefined;
  return { ...(ce ?? {}), ...(oe ?? {}) };
}

function updatedAtToMillis(u: unknown): number {
  if (u == null) return 0;
  if (typeof u === 'object' && u !== null && 'toMillis' in u) {
    const t = (u as { toMillis?: () => number }).toMillis;
    if (typeof t === 'function') {
      try {
        return t.call(u);
      } catch {
        return 0;
      }
    }
  }
  if (u instanceof Date) return u.getTime();
  return 0;
}

/**
 * `emailNotifications` se z portálu zapisuje do `companies` i `společnosti`.
 * Sloučený profil musí brát čerstvější / dostupný zdroj, ne jen spread z `companies`.
 */
function mergeEmailNotificationsField(
  c: Record<string, unknown> | null,
  o: Record<string, unknown> | null | undefined
): unknown {
  const cEmail = c?.emailNotifications;
  const oEmail = o?.emailNotifications;
  if (cEmail !== undefined && cEmail !== null && oEmail !== undefined && oEmail !== null) {
    const cMs = updatedAtToMillis(c?.updatedAt);
    const oMs = updatedAtToMillis(o?.updatedAt);
    return oMs >= cMs ? oEmail : cEmail;
  }
  if (oEmail !== undefined && oEmail !== null) return oEmail;
  if (cEmail !== undefined && cEmail !== null) return cEmail;
  return undefined;
}

/**
 * Superadmin čte/zapisuje `společnosti/{id}`; portál poslouchá `companies/{id}`.
 * Sloučení: licence + moduly z obou dokumentů; lepší `platformLicense`; org má prioritu u stavu firmy.
 */
function mergeCompanyWithOrganizationRecord(
  id: string,
  fromCompanies: (CompanyProfile & { id: string }) | null,
  fromOrg: Record<string, unknown> | null
): (CompanyProfile & { id: string }) | null {
  if (!fromCompanies && !fromOrg) return null;
  const c = fromCompanies as Record<string, unknown> | null;
  const o = fromOrg;

  const companyName =
    (c?.companyName as string) ||
    (c?.name as string) ||
    (o?.companyName as string) ||
    (o?.name as string) ||
    'Organization';

  const merged: Record<string, unknown> = {
    ...(c ?? {}),
    id,
    companyName,
  };

  const mergedLicense = mergeLicenseDocuments(c?.license, o?.license);
  if (mergedLicense !== undefined) {
    merged.license = mergedLicense;
  }

  if (o && 'licenseId' in o && o.licenseId != null) {
    merged.licenseId = o.licenseId;
  } else if (c?.licenseId != null) {
    merged.licenseId = c.licenseId;
  }

  const ae = Array.isArray(c?.enabledModuleIds) ? c.enabledModuleIds.length : 0;
  const be = Array.isArray(o?.enabledModuleIds) ? o.enabledModuleIds.length : 0;
  merged.enabledModuleIds =
    be >= ae ? o?.enabledModuleIds ?? c?.enabledModuleIds : c?.enabledModuleIds ?? o?.enabledModuleIds;

  merged.platformLicense = pickBetterPlatformLicense(c?.platformLicense, o?.platformLicense);
  const me = mergeModuleEntitlementsMaps(c?.moduleEntitlements, o?.moduleEntitlements);
  if (me !== undefined) {
    merged.moduleEntitlements = me;
  }

  const topMods = mergeTopLevelCompanyModules(c?.modules, o?.modules);
  if (topMods !== undefined) {
    merged.modules = topMods;
  }

  if (o && 'isActive' in o && o.isActive !== undefined) {
    merged.isActive = o.isActive;
  }
  if (o && 'active' in o && o.active !== undefined) {
    merged.active = o.active;
  }

  const mergedEmailNotifications = mergeEmailNotificationsField(c, o);
  if (mergedEmailNotifications !== undefined) {
    merged.emailNotifications = mergedEmailNotifications;
  }

  return merged as CompanyProfile & { id: string };
}

/** Jednotný výstup: companyId z `users/{uid}.companyId` (nebo `organizationId`); dokument `companies` + merge licence z `společnosti`. */
export function useCompany() {
  const { user } = useUser();
  const { firestore, areServicesAvailable } = useFirebase();
  const pathname = usePathname() ?? '';
  const suppressTenantFirestore = isGlobalAdminAppPath(pathname);

  const userRef = useMemoFirebase(
    () =>
      areServicesAvailable && user && firestore
        ? doc(firestore, 'users', user.uid)
        : null,
    /** `user` mění referenci při token refresh / getIdToken — jen uid je stabilní */
    [areServicesAvailable, firestore, user?.uid],
  );
  const {
    data: userProfile,
    isLoading: profileLoading,
    error: profileError,
  } = useDoc<any>(userRef);

  const companyId = useMemo(
    () => resolveTenantCompanyId(userProfile),
    [userProfile],
  );

  const companyRef = useMemoFirebase(
    () =>
      areServicesAvailable &&
      firestore &&
      companyId &&
      !suppressTenantFirestore
        ? doc(firestore, COMPANIES_COLLECTION, companyId)
        : null,
    [areServicesAvailable, firestore, companyId, suppressTenantFirestore],
  );

  const orgRef = useMemoFirebase(
    () =>
      areServicesAvailable &&
      firestore &&
      companyId &&
      !suppressTenantFirestore
        ? doc(firestore, ORGANIZATIONS_COLLECTION, companyId)
        : null,
    [areServicesAvailable, firestore, companyId, suppressTenantFirestore],
  );

  const {
    data: companyFromDb,
    isLoading: companyLoading,
    error: companyError,
  } = useDoc<CompanyProfile>(companyRef);

  const {
    data: orgFromDb,
    isLoading: orgLoading,
    error: orgError,
  } = useDoc<Record<string, unknown>>(orgRef);

  const company = useMemo(
    () =>
      companyId
        ? mergeCompanyWithOrganizationRecord(
            companyId,
            companyFromDb,
            orgFromDb,
          )
        : null,
    [companyId, companyFromDb, orgFromDb],
  );

  const tenantDocsLoading = companyLoading || orgLoading;

  /** Profil uživatele + dokument firmy — dokud běží kterýkoli dotaz. */
  const isLoading =
    profileLoading || (Boolean(companyId) && tenantDocsLoading);

  const companyDocMissing =
    Boolean(companyId) &&
    !profileLoading &&
    !tenantDocsLoading &&
    !profileError &&
    !companyError &&
    !orgError &&
    company == null;

  const error = profileError ?? companyError ?? orgError;

  const companyName = suppressTenantFirestore
    ? ''
    : company?.companyName ||
      // backward compatibility with existing "name" field
      (company as any)?.name ||
      'Organization';

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    try {
      const isSuperAdminFirebase =
        Array.isArray((userProfile as { globalRoles?: string[] })?.globalRoles) &&
        (userProfile as { globalRoles: string[] }).globalRoles.includes('super_admin');
      console.log('[useCompany] isSuperAdmin (Firebase globalRoles)', isSuperAdminFirebase);
      console.log('[useCompany] suppressTenantFirestore (global /admin shell)', suppressTenantFirestore);
      console.log('[useCompany] companyId:', companyId);
      console.log('[useCompany] modules (merged, null on admin shell)', company?.modules);
      console.log('[useCompany] loading:', {
        profileLoading,
        companyLoading,
        orgLoading,
        tenantDocsLoading,
      });
      console.debug('[useCompany] merged emailNotifications (companies + společnosti)', company?.emailNotifications);
    } catch {
      /* ignore logging failures */
    }
  }, [
    user,
    userProfile,
    companyId,
    company?.modules,
    profileLoading,
    companyLoading,
    orgLoading,
    tenantDocsLoading,
    suppressTenantFirestore,
  ]);

  return {
    /** Dokument `users/{uid}` */
    userProfile,
    /** Sloučený profil: `companies/{id}` + licence z `společnosti/{id}` */
    company,
    companyName,
    /** Vždy z profilu uživatele (trim), jinak undefined */
    companyId,
    isLoading,
    profileLoading,
    companyLoading: tenantDocsLoading,
    error,
    companyDocMissing,
    profileError,
    companyError: companyError ?? orgError,
  };
}
