'use client';

import type { Timestamp } from 'firebase/firestore';
import { useCompany, type CompanyProfile } from './use-company';

export type Organization = {
  id: string;
  companyName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export function useOrganization() {
  const {
    company,
    companyName,
    companyId,
    isLoading,
    error,
    companyDocMissing,
  } = useCompany();

  return {
    organization: (company as CompanyProfile | null) ?? null,
    companyName,
    organizationId: companyId,
    isLoading,
    error,
    companyDocMissing,
  };
}


