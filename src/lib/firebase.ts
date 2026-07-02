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
 *  - Atomic move application via `runTransaction` (anti-cheat: server-side
 *    validation is now done inside the transaction so both players see the
 *    same authoritative state).
 *
 * To use this:
 *  1. Create a Realtime Database in your Firebase project
 *     (https://console.firebase.google.com → your project → Build → Realtime Database).
 *  2. Copy the databaseURL shown there and paste it below if it differs.
 *  3. Set read/write rules. For a private game with no auth, you can use the
 *     rules in `FIREBASE_FIX.md` (allows read/write under /chess/*).
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
  // Default URL for this project — change if your DB is in a different region.
  databaseURL: "https://multiplayer-chess-b9742-default-rtdb.firebaseio.com",
};

// Initialize once (HMR / SSR safe).
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

/** Shared Realtime Database handle. Use this everywhere. */
export const db: Database = getDatabase(app);
