/**
 * Srozumitelné hlášky pro změnu hesla přes Firebase Auth (reauthenticate + updatePassword).
 */

export function mapFirebaseAuthPasswordChangeError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Aktuální heslo není správné.";
    case "auth/weak-password":
      return "Nové heslo je příliš slabé. Zvolte delší nebo složitější heslo.";
    case "auth/too-many-requests":
      return "Příliš mnoho pokusů. Zkuste to později.";
    case "auth/user-not-found":
      return "Účet neexistuje nebo byl odstraněn.";
    case "auth/requires-recent-login":
      return "Z bezpečnostních důvodů se znovu přihlaste a změnu hesla zkuste znovu.";
    case "auth/network-request-failed":
      return "Chyba sítě. Zkontrolujte připojení a zkuste to znovu.";
    default:
      return "Změna hesla se nezdařila. Zkuste to znovu.";
  }
}
