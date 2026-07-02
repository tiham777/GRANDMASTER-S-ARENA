/**
 * firebase.ts — Firebase initialization for online multiplayer chess.
 *
 * Online play used to run through a socket.io mini-service on port 3001 that
 * required a Caddy gateway in front of the app. That works in a single-host
 * sandbox but breaks the moment you deploy to Vercel / Netlify / any normal
 * static host (no Caddy, no separate long-running socket.io process).
 *
 * Switching to Firebase Realtime Database means:
 *  - No separate server to deploy — works on any static host.
 *  - Real-time sync via `.on(...)` listeners.
 *  - Atomic move application via `runTransaction` (anti-cheat: the
 *    transaction only commits if the room's FEN still matches what the
 *    player loaded when computing the move).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SETUP
 * ──────────────────────────────────────────────────────────────────────────
 *  1. Create a Realtime Database in your Firebase project
 *     (console → your project → Build → Realtime Database → Create Database).
 *     IMPORTANT: choose "Realtime Database", NOT "Firestore Database" —
 *     they are different products with different APIs and rule languages.
 *  2. The databaseURL below is the default for this project. If your DB is
 *     in a different region (e.g. europe-west1), the URL will be different —
 *     either edit it here or set the NEXT_PUBLIC_FIREBASE_DATABASE_URL env
 *     variable (recommended for production).
 *  3. Set read/write rules. See ONLINE_FIX_README.md.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

// Your Firebase project config. Provided by the user.
// Note: `databaseURL` is NOT in the standard config block — you must add it
// manually after creating a Realtime Database instance in the Firebase console.
export const firebaseConfig = {
  apiKey: "AIzaSyDFWqdJHdCb1vaR6uRuKmHd2M5oOWIjJDk",
  authDomain: "multiplayer-chess-b9742.firebaseapp.com",
  projectId: "multiplayer-chess-b9742",
  storageBucket: "multiplayer-chess-b9742.firebasestorage.app",
  messagingSenderId: "475801564420",
  appId: "1:475801564420:web:e10cc670293995f4350c51",
  measurementId: "G-8BNF5RFD2E",
  // Allow override via env var so production deployments can point at a
  // region-specific database URL without editing this file.
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    "https://multiplayer-chess-b9742-default-rtdb.firebaseio.com",
};

// Initialize once (HMR / SSR safe).
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

/** Shared Realtime Database handle. Use this everywhere. */
export const db: Database = getDatabase(app);
