'use client';

import { useEffect, useMemo } from 'react';
import { doc, type Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import { COMPANIES_COLLECTION } from '@/lib/firestore-collections';

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
   * Used by "Smlouva o dílo" (Dodavatel) + settings form.
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

/** Jednotný výstup: companyId pouze z `users/{uid}.companyId` (žádné URL). */
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

  const companyId = useMemo(() => {
    const raw = userProfile?.companyId;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
    return undefined;
  }, [userProfile?.companyId]);

  const companyRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, COMPANIES_COLLECTION, companyId)
        : null,
    [firestore, companyId],
  );

  const {
    data: company,
    isLoading: companyLoading,
    error: companyError,
  } = useDoc<CompanyProfile>(companyRef);

  /** Profil uživatele + dokument firmy — dokud běží kterýkoli dotaz. */
  const isLoading =
    profileLoading || (Boolean(companyId) && companyLoading);

  const companyDocMissing =
    Boolean(companyId) &&
    !profileLoading &&
    !companyLoading &&
    !profileError &&
    !companyError &&
    company == null;

  const error = profileError ?? companyError;

  const companyName =
    company?.companyName ||
    // backward compatibility with existing "name" field
    (company as any)?.name ||
    'Organization';

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    try {
      console.log('USER:', user);
      console.log('COMPANY ID (from users/{uid}.companyId):', companyId);
    } catch {
      /* ignore logging failures */
    }
  }, [user, companyId]);

  return {
    /** Dokument `users/{uid}` */
    userProfile,
    /** Firestore `companies/{user.companyId}` */
    company,
    companyName,
    /** Vždy z `userProfile.companyId` (trim), jinak undefined */
    companyId,
    isLoading,
    profileLoading,
    companyLoading,
    error,
    companyDocMissing,
    profileError,
    companyError,
  };
}
