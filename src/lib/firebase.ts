// Firebase initialization (client-only).
// Reads config from public env vars (NEXT_PUBLIC_*) set in .env.local / Vercel.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Lazily initialize so we never touch firebase during SSR.
let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

export function getFirebase() {
  if (typeof window === "undefined") {
    return { app: null, auth: null, db: null, provider: null };
  }
  if (!_app) {
    _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    _auth = getAuth(_app);
    _db = getFirestore(_app);
  }
  return {
    app: _app,
    auth: _auth!,
    db: _db!,
    provider: new GoogleAuthProvider(),
  };
}
