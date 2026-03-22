import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps, cert } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export async function GET() {
  try {
    console.log("Loading terminal config...");

    const db = getFirestore();

    // 1. načti aktivní terminál
    const snapshot = await db
      .collection("terminálOdkazy")
      .where("aktivní", "==", true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { success: false, error: "Žádný aktivní terminál nenalezen" },
        { status: 400 }
      );
    }

    const terminalDoc = snapshot.docs[0];
    const data = terminalDoc.data();

    const companyId = data["ID společnosti"];

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "Chybí ID společnosti" },
        { status: 400 }
      );
    }

    console.log("Company ID:", companyId);

    // 2. načti firmu
    const companyDoc = await db.collection("společnosti").doc(companyId).get();

    if (!companyDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Firma neexistuje" },
        { status: 404 }
      );
    }

    const companyData = companyDoc.data();

    return NextResponse.json({
      success: true,
      companyId,
      companyName: companyData?.name || "Firma",
    });
  } catch (error) {
    console.error("Terminal config error:", error);

    return NextResponse.json(
      { success: false, error: "Server error" },
      { status: 500 }
    );
  }
}