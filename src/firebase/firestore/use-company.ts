'use client';

import { useMemo } from 'react';
import { doc, type Timestamp } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import { COMPANIES_COLLECTION } from '@/lib/firestore-collections';

export type CompanyProfile = {
  id: string;
  companyName: string;
  ico?: string;
  publicProfile?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export function useCompany() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [firestore, user],
  );
  const { data: profile } = useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;

  const companyRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, COMPANIES_COLLECTION, companyId)
        : null,
    [firestore, companyId],
  );

  const { data: company, isLoading, error } = useDoc<CompanyProfile>(companyRef);

  const companyName =
    company?.companyName ||
    // backward compatibility with existing "name" field
    (company as any)?.name ||
    'Organization';

  return {
    company,
    companyName,
    companyId,
    isLoading,
    error,
  };
}

