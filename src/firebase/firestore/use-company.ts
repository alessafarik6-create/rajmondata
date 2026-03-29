'use client';

import { useEffect, useMemo } from 'react';
import { doc, type Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from '@/lib/firestore-collections';
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

function mergeTopLevelCompanyModules(c: unknown, o: unknown): Record<string, boolean> | undefined {
  const cm = c && typeof c === 'object' ? (c as Record<string, boolean>) : null;
  const om = o && typeof o === 'object' ? (o as Record<string, boolean>) : null;
  if (!cm && !om) return undefined;
  const out: Record<string, boolean> = {};
  for (const k of MODULE_KEYS) {
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

  return merged as CompanyProfile & { id: string };
}

/** Jednotný výstup: companyId z `users/{uid}.companyId` (nebo `organizationId`); dokument `companies` + merge licence z `společnosti`. */
export function useCompany() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, 'users', user.uid) : null),
    /** `user` mění referenci při token refresh / getIdToken — jen uid je stabilní */
    [firestore, user?.uid],
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
      firestore && companyId
        ? doc(firestore, COMPANIES_COLLECTION, companyId)
        : null,
    [firestore, companyId],
  );

  const orgRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, ORGANIZATIONS_COLLECTION, companyId)
        : null,
    [firestore, companyId],
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

  const companyName =
    company?.companyName ||
    // backward compatibility with existing "name" field
    (company as any)?.name ||
    'Organization';

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    try {
      console.log('[useCompany] companyId:', companyId);
      console.log('[useCompany] company.modules (merged):', company?.modules);
      console.log('[useCompany] loading:', {
        profileLoading,
        companyLoading,
        orgLoading,
        tenantDocsLoading,
      });
    } catch {
      /* ignore logging failures */
    }
  }, [user, companyId, company?.modules, profileLoading, companyLoading, orgLoading, tenantDocsLoading]);

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
