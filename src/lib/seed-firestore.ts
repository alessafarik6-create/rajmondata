'use client';

/**
 * Vývoj / záchranná cesta: doplnění users + companies bez jakýchkoli subkolekcí.
 * V produkci se portál spoléhá na registraci firmy (`register/page.tsx`).
 * Nevytváří zaměstnance, zakázky ani šablony — ty vznikají lazy v aplikaci.
 */
import type { User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { DEFAULT_LICENSE } from '@/lib/license-modules';

/**
 * Generates a default company ID for a user (stable per user).
 */
function defaultCompanyId(uid: string): string {
  return `company-${uid.substring(0, 8)}-${Math.random().toString(36).substring(2, 7)}`;
}

function labelFromAuthUser(user: User): string {
  return (user.displayName || user.email || "Nová firma").trim() || "Nová firma";
}

/** Minimální dokument firmy — bez subkolekcí a bez demo záznamů. */
function minimalCompanyDoc(companyId: string, ownerId: string, displayLabel: string) {
  const enabledModules = [...DEFAULT_LICENSE.enabledModules];
  return {
    id: companyId,
    companyName: displayLabel,
    name: displayLabel,
    ico: '',
    ownerId,
    ownerUserId: ownerId,
    email: '',
    isActive: true,
    active: true,
    licenseId: DEFAULT_LICENSE.licenseType,
    license: {
      licenseType: DEFAULT_LICENSE.licenseType,
      status: DEFAULT_LICENSE.status,
      expirationDate: null,
      maxUsers: DEFAULT_LICENSE.maxUsers,
      enabledModules,
    },
    enabledModuleIds: enabledModules,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
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
      await ensureCompanyDocument(companyId, user.uid, firestore, {
        nameFallback: labelFromAuthUser(user),
      });
      return { createdUser: false, createdCompany: false, companyId };
    }
    const newCompanyId = defaultCompanyId(user.uid);
    await ensureCompanyDocument(newCompanyId, user.uid, firestore, {
      nameFallback: labelFromAuthUser(user),
    });
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
  await ensureCompanyDocument(companyId, user.uid, firestore, {
    nameFallback: labelFromAuthUser(user),
  });

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

  // Zaměstnance / zakázky / šablony se nevytvářejí — lazy při prvním použití v UI.

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
  firestore: Firestore,
  options?: { nameFallback?: string }
): Promise<boolean> {
  const companyRef = doc(firestore, "companies", companyId);
  const companySnap = await getDoc(companyRef);

  if (companySnap.exists()) {
    return false;
  }

  let displayLabel = (options?.nameFallback ?? "").trim() || "Nová firma";
  if (!options?.nameFallback) {
    try {
      const ownerSnap = await getDoc(doc(firestore, "users", ownerId));
      if (ownerSnap.exists()) {
        const d = ownerSnap.data();
        displayLabel =
          String(d.displayName ?? d.email ?? "").trim() || "Nová firma";
      }
    } catch {
      /* keep default */
    }
  }

  await setDoc(companyRef, minimalCompanyDoc(companyId, ownerId, displayLabel));

  if (typeof window !== "undefined") {
    console.debug("[seed-firestore] Created company", { companyId, ownerId });
  }
  return true;
}
