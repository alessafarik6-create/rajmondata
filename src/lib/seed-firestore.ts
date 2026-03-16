'use client';

import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const DEFAULT_COMPANY_NAME = 'My Company';

/**
 * Generates a default company ID for a user (stable per user).
 */
function defaultCompanyId(uid: string): string {
  return `company-${uid.substring(0, 8)}-${Math.random().toString(36).substring(2, 7)}`;
}

export interface SeedResult {
  createdUser: boolean;
  createdCompany: boolean;
  companyId: string;
}

/**
 * Ensures users/{uid} exists. If not, creates a default company and user profile linked to it.
 * Idempotent: safe to call multiple times.
 */
export async function ensureUserProfile(
  user: User,
  firestore: Firestore
): Promise<SeedResult> {
  const userRef = doc(firestore, 'users', user.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data = userSnap.data();
    const companyId = data.companyId as string | undefined;
    if (companyId) {
      await ensureCompanyDocument(companyId, user.uid, firestore);
      return { createdUser: false, createdCompany: false, companyId };
    }
    const newCompanyId = defaultCompanyId(user.uid);
    await ensureCompanyDocument(newCompanyId, user.uid, firestore);
    await setDoc(
      userRef,
      {
        companyId: newCompanyId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (typeof window !== 'undefined') {
      console.debug('[seed-firestore] Linked existing user to new company', newCompanyId);
    }
    return { createdUser: false, createdCompany: true, companyId: newCompanyId };
  }

  const companyId = defaultCompanyId(user.uid);
  await ensureCompanyDocument(companyId, user.uid, firestore);

  await setDoc(userRef, {
    id: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? null,
    role: 'owner',
    companyId,
    globalRoles: [],
    createdAt: serverTimestamp(),
  });

  const roleRef = doc(firestore, 'users', user.uid, 'company_roles', companyId);
  await setDoc(roleRef, {
    role: 'owner',
    assignedAt: serverTimestamp(),
  });

  const employeeRef = doc(firestore, 'companies', companyId, 'employees', user.uid);
  const nameParts = (user.displayName ?? user.email ?? 'User').trim().split(/\s+/);
  await setDoc(employeeRef, {
    id: user.uid,
    companyId,
    userId: user.uid,
    firstName: nameParts[0] ?? 'Owner',
    lastName: nameParts.slice(1).join(' ') || '',
    email: user.email ?? '',
    jobTitle: 'Owner',
    role: 'owner',
    isActive: true,
    hireDate: new Date().toISOString().split('T')[0],
    attendanceQrId: `QR-${Math.random().toString(36).substring(2, 15)}`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (typeof window !== 'undefined') {
    console.debug('[seed-firestore] Created user profile and company', { companyId, uid: user.uid });
  }
  return { createdUser: true, createdCompany: true, companyId };
}

/**
 * Ensures companies/{companyId} exists. If not, creates a default company document.
 * Idempotent: safe to call multiple times.
 */
export async function ensureCompanyDocument(
  companyId: string,
  ownerId: string,
  firestore: Firestore
): Promise<boolean> {
  const companyRef = doc(firestore, 'companies', companyId);
  const companySnap = await getDoc(companyRef);

  if (companySnap.exists()) {
    return false;
  }

  await setDoc(companyRef, {
    id: companyId,
    name: DEFAULT_COMPANY_NAME,
    ownerUserId: ownerId,
    ownerId,
    isActive: true,
    licenseId: 'free-trial',
    enabledModuleIds: ['dashboard', 'employees', 'jobs', 'attendance'],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (typeof window !== 'undefined') {
    console.debug('[seed-firestore] Created company', { companyId, ownerId });
  }
  return true;
}
