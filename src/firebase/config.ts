/**
 * Firebase client config. Prefer environment variables in .env.local for production.
 * See https://firebase.google.com/docs/web/setup#config-object
 */
export const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studio-5230144579-281f1",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:212594496461:web:e0505768b4a8b14df3aa84",
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCY3w3NG2GYE-dZjELiF-Z7JkJ0A5A4zSE",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "studio-5230144579-281f1.firebaseapp.com",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "212594496461",
};
