'use client';

import { useEffect, useMemo } from 'react';
import { doc, type Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import {
  COMPANIES_COLLECTION,
  ORGANIZATIONS_COLLECTION,
} from '@/lib/firestore-collections';

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

/**
 * Superadmin čte/zapisuje `společnosti/{id}`; portál poslouchá `companies/{id}`.
 * Při rozjetých dokumentech má pravdu stejný řádek v `společnosti` jako v admin UI.
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

  if (o?.license != null && typeof o.license === 'object') {
    merged.license = o.license;
  } else if (c?.license != null) {
    merged.license = c.license;
  }

  if (o && 'licenseId' in o && o.licenseId != null) {
    merged.licenseId = o.licenseId;
  } else if (c?.licenseId != null) {
    merged.licenseId = c.licenseId;
  }

  if (Array.isArray(o?.enabledModuleIds)) {
    merged.enabledModuleIds = o.enabledModuleIds;
  } else if (Array.isArray(c?.enabledModuleIds)) {
    merged.enabledModuleIds = c.enabledModuleIds;
  }

  merged.platformLicense = c?.platformLicense ?? o?.platformLicense;
  merged.moduleEntitlements = c?.moduleEntitlements ?? o?.moduleEntitlements;

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
      console.log('USER:', user);
      console.log('COMPANY ID (users.companyId | organizationId):', companyId);
      console.log(
        'TENANT PATHS:',
        companyId
          ? {
              companies: `${COMPANIES_COLLECTION}/${companyId}`,
              organizations: `${ORGANIZATIONS_COLLECTION}/${companyId}`,
            }
          : null,
      );
    } catch {
      /* ignore logging failures */
    }
  }, [user, companyId]);

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
