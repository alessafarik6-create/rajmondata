"use client";
import type { Auth } from "firebase/auth";

/**
 * Dříve zde byly signInAnonymously / createUserWithEmailAndPassword bez await.
 * Automatické vytváření auth účtů je zakázáno — tyto funkce nic nevolají (nebo vyhodí chybu při záměrném použití).
 */
export function initiateAnonymousSignIn(_authInstance: Auth): void {
  if (process.env.NODE_ENV === "development") {
    console.warn("[non-blocking-login] initiateAnonymousSignIn disabled — signInAnonymously removed");
  }
}

export function initiateEmailSignUp(_authInstance: Auth, _email: string, _password: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "[non-blocking-login] initiateEmailSignUp disabled — use register page createUserWithEmailAndPassword only"
    );
  }
}

export function initiateEmailSignIn(_authInstance: Auth, _email: string, _password: string): void {
  if (process.env.NODE_ENV === "development") {
    console.warn("[non-blocking-login] initiateEmailSignIn disabled — use login page signInWithEmailAndPassword");
  }
}
