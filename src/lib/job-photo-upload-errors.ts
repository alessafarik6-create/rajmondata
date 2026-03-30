import { FirebaseError } from "firebase/app";

export function jobPhotoUploadErrorTitle(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (
      err.code === "storage/invalid-argument" ||
      err.code === "storage/no-default-bucket" ||
      err.code === "storage/bucket-not-found" ||
      err.code === "storage/project-not-found"
    ) {
      return "Chybná konfigurace Storage bucketu";
    }
  }
  return "Nepodařilo se nahrát fotku do Firebase Storage";
}

function jobPhotoUploadErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (err.code === "permission-denied") {
      return "Operace byla zamítnuta (pravidla Firestore nebo Storage). Zkontrolujte nasazení storage.rules.";
    }
    if (err.code === "storage/unauthorized") {
      return "Nemáte oprávnění nahrát soubor do úložiště (zkontrolujte pravidla Storage).";
    }
    if (err.code === "storage/canceled") {
      return "Nahrávání bylo zrušeno.";
    }
    if (err.code === "storage/quota-exceeded") {
      return "Byla překročena kvóta úložiště.";
    }
    if (err.code === "storage/invalid-checksum") {
      return "Soubor se při přenosu poškodil, zkuste to znovu.";
    }
    return err.message || "Chyba úložiště.";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Fotografii se nepodařilo nahrát.";
}

export function describeStorageUploadFailure(err: unknown): string {
  const base = jobPhotoUploadErrorMessage(err);
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("cors") ||
    lower.includes("access-control") ||
    lower.includes("access-control-allow-origin")
  ) {
    return (
      base +
      " U oficiálního SDK jde často o zamítnutí Storage rules (nasadit firebase deploy --only storage), " +
      "nebo o NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET, který neodpovídá bucketu projektu v Firebase Console. " +
      "Zkuste vypnout blokující rozšíření prohlížeče."
    );
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed")
  ) {
    return (
      base +
      " Zkontrolujte připojení k internetu a dostupnost Firebase Storage pro tento projekt."
    );
  }
  return base;
}
