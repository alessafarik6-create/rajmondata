import { getAdminFirestore } from "@/lib/firebase-admin";
import { PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_BILLING_PROVIDER_DOC } from "@/lib/platform-config";

export type PublicOperatorInfo = {
  companyName: string;
  ico: string;
  dic: string;
  address: string;
  email: string;
  phone: string;
  /** Text pro VOP — limit odpovědnosti; právník může doplnit ve Firestore `legal.liabilityCapNote`. */
  liabilityCapNote: string | null;
};

function envOperatorFallback(): PublicOperatorInfo {
  return {
    companyName: String(process.env.NEXT_PUBLIC_OPERATOR_NAME ?? "J.A.S. obchodní s.r.o.").trim(),
    ico: String(process.env.NEXT_PUBLIC_OPERATOR_ICO ?? "07245866").trim(),
    dic: String(process.env.NEXT_PUBLIC_OPERATOR_DIC ?? "").trim(),
    address: String(process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "").trim(),
    email: String(process.env.NEXT_PUBLIC_OPERATOR_EMAIL ?? "").trim(),
    phone: String(process.env.NEXT_PUBLIC_OPERATOR_PHONE ?? "").trim(),
    liabilityCapNote: null,
  };
}

/** Načte identifikaci provozovatele pro veřejné právní stránky (Firestore → env → návrhová výchozí hodnota). */
export async function loadPublicOperatorInfo(): Promise<PublicOperatorInfo> {
  const fallback = envOperatorFallback();
  const db = getAdminFirestore();
  if (!db) return fallback;

  try {
    const snap = await db
      .collection(PLATFORM_SETTINGS_COLLECTION)
      .doc(PLATFORM_BILLING_PROVIDER_DOC)
      .get();
    if (!snap.exists) return fallback;
    const d = snap.data() as Record<string, unknown>;
    const legal = (d.legal && typeof d.legal === "object" ? d.legal : {}) as Record<string, unknown>;

    return {
      companyName: String(d.companyName ?? fallback.companyName).trim() || fallback.companyName,
      ico: String(d.ico ?? fallback.ico).trim() || fallback.ico,
      dic: String(d.dic ?? fallback.dic).trim(),
      address: String(d.address ?? fallback.address).trim(),
      email: String(d.email ?? fallback.email).trim(),
      phone: String(d.phone ?? fallback.phone).trim(),
      liabilityCapNote:
        typeof legal.liabilityCapNote === "string" && legal.liabilityCapNote.trim()
          ? legal.liabilityCapNote.trim()
          : null,
    };
  } catch (e) {
    console.warn("[loadPublicOperatorInfo]", e);
    return fallback;
  }
}
