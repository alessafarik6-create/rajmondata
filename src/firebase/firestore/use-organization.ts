'use client';

import { useEffect } from 'react';
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

  const organization = (company as CompanyProfile | null) ?? null;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !organization) return;
    console.log("ORG:", organization);
    console.log("LICENSE:", organization.license);
  }, [organization]);

  return {
    organization,
    companyName,
    organizationId: companyId,
    isLoading,
    error,
    companyDocMissing,
  };
}


