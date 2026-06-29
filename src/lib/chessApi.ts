// Data-access layer: auth, user profiles, challenges, games.
// All functions are client-only (Firebase web SDK).
"use client";

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit as fbLimit,
  getDocs,
  addDoc,
  deleteDoc,
  arrayUnion,
  increment,
  Timestamp,
} from "firebase/firestore";
import { getFirebase } from "./firebase";
import type {
  UserProfile,
  Challenge,
  GameDoc,
  GameMove,
  PieceColor,
  GameStatus,
} from "./types";
import { CHALLENGE_TTL_MS } from "./types";

const USERS = "users";
const CHALLENGES = "challenges";
const GAMES = "games";

// ----- username helpers --------------------------------------------------

const USERNAME_BLOCKLIST = new Set([
  "guest", "admin", "root", "system", "official", "moderator", "mod",
  "support", "help", "chess", "master", "grandmaster", "gm", "im", "fm",
]);

export function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20);
}

export function validateUsername(raw: string): { ok: boolean; reason?: string } {
  const u = sanitizeUsername(raw);
  if (u.length < 3) return { ok: false, reason: "Username must be at least 3 characters." };
  if (u.length > 20) return { ok: false, reason: "Username must be at most 20 characters." };
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return { ok: false, reason: "Only letters, numbers and underscores." };
  if (USERNAME_BLOCKLIST.has(u.toLowerCase())) return { ok: false, reason: "This username is reserved." };
  return { ok: true };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { db } = getFirebase();
  if (!db) return false;
  const q = query(collection(db, USERS), where("usernameLower", "==", username.toLowerCase()), fbLimit(1));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ----- profile management ----------------------------------------------

async function ensureProfile(user: User, username: string, provider: "google" | "guest"): Promise<UserProfile> {
  const { db } = getFirebase();
  if (!db) throw new Error("Firestore not ready");

  const ref = doc(db, USERS, user.uid);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    const data = existing.data() as UserProfile;
    // Update display name / photo / online state
    await updateDoc(ref, {
      username,
      email: user.email ?? null,
      photoURL: user.photoURL ?? null,
      provider,
      isOnline: true,
      lastSeen: Date.now(),
    });
    return { ...data, username, email: user.email ?? null, photoURL: user.photoURL ?? null, provider, isOnline: true };
  }

  const profile: UserProfile = {
    uid: user.uid,
    username,
    email: user.email ?? null,
    photoURL: user.photoURL ?? null,
    provider,
    isOnline: true,
    lastSeen: Date.now(),
    wins: 0,
    losses: 0,
    draws: 0,
    createdAt: Date.now(),
  };
  await setDoc(ref, { ...profile, usernameLower: username.toLowerCase() });
  return profile;
}

export async function signInWithGoogle(displayName?: string): Promise<UserProfile> {
  const { auth, provider } = getFirebase();
  if (!auth || !provider) throw new Error("Auth not ready");
  const cred = await signInWithPopup(auth, provider);
  const baseName = sanitizeUsername(displayName || cred.user.displayName || cred.user.email?.split("@")[0] || "Player");
  // ensure unique username if a display name was provided
  let finalName = baseName;
  if (displayName) {
    let n = 0;
    while (await isUsernameTaken(finalName)) {
      n += 1;
      finalName = `${baseName}${n}`;
      if (n > 50) break;
    }
  } else {
    // If user didn't pick a name, try their default; if taken, suffix a number
    let n = 0;
    while (await isUsernameTaken(finalName)) {
      n += 1;
      finalName = `${baseName}${n}`;
      if (n > 50) break;
    }
  }
  if (cred.user.displayName !== finalName) {
    try { await updateProfile(cred.user, { displayName: finalName }); } catch { /* noop */ }
  }
  return ensureProfile(cred.user, finalName, "google");
}

export async function signInAsGuest(displayName: string): Promise<UserProfile> {
  const { auth } = getFirebase();
  if (!auth) throw new Error("Auth not ready");
  const cred = await signInAnonymously(auth);
  if (cred.user.displayName !== displayName) {
    try { await updateProfile(cred.user, { displayName }); } catch { /* noop */ }
  }
  return ensureProfile(cred.user, displayName, "guest");
}

export async function logoutUser(): Promise<void> {
  const { auth, db } = getFirebase();
  if (!auth) return;
  const uid = auth.currentUser?.uid;
  if (uid && db) {
    try {
      await updateDoc(doc(db, USERS, uid), { isOnline: false, lastSeen: Date.now() });
    } catch { /* noop */ }
  }
  await signOut(auth);
}

export function watchAuthState(cb: (profile: UserProfile | null) => void): () => void {
  let didCall = false;
  const safeCb = (p: UserProfile | null) => {
    didCall = true;
    cb(p);
  };

  let auth: ReturnType<typeof getFirebase>["auth"];
  let db: ReturnType<typeof getFirebase>["db"];
  try {
    const fb = getFirebase();
    auth = fb.auth;
    db = fb.db;
  } catch (e) {
    console.error("Firebase init failed", e);
    safeCb(null);
    return () => {};
  }
  if (!auth || !db) {
    safeCb(null);
    return () => {};
  }

  // Safety net: if onAuthStateChanged doesn't fire within 4s, assume no user.
  const fallbackId = setTimeout(() => {
    if (!didCall) safeCb(null);
  }, 4000);

  let unsubProfile: (() => void) | null = null;
  const unsub = onAuthStateChanged(
    auth,
    (user) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!user) { safeCb(null); return; }
      // Subscribe to the profile doc so username / online state stay live
      unsubProfile = onSnapshot(
        doc(db!, USERS, user.uid),
        (snap) => {
          if (snap.exists()) safeCb(snap.data() as UserProfile);
          else safeCb(null);
        },
        () => safeCb(null)
      );
    },
    () => safeCb(null)
  );

  return () => {
    clearTimeout(fallbackId);
    unsub();
    if (unsubProfile) unsubProfile();
  };
}

export async function setOnline(uid: string, online: boolean): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, USERS, uid), { isOnline: online, lastSeen: Date.now() });
}

// ----- online players / search ----------------------------------------

export function watchOnlinePlayers(excludeUid: string | null, cb: (players: UserProfile[]) => void): () => void {
  const { db } = getFirebase();
  if (!db) { cb([]); return () => {}; }
  // NOTE: do NOT add orderBy here — Firestore would require a composite index
  // for `where("isOnline", "==", true) + orderBy("lastSeen")`, and if the
  // index doesn't exist the snapshot returns empty (with a console warning).
  // We sort client-side instead.
  const q = query(
    collection(db, USERS),
    where("isOnline", "==", true),
    fbLimit(50)
  );
  return onSnapshot(q, (snap) => {
    const out: UserProfile[] = [];
    snap.forEach((d) => {
      const p = d.data() as UserProfile;
      if (p.uid !== excludeUid) out.push(p);
    });
    out.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
    cb(out);
  }, (err) => {
    console.error("watchOnlinePlayers error:", err);
    cb([]);
  });
}

export async function searchUsersByUsername(term: string, excludeUid: string | null): Promise<UserProfile[]> {
  const { db } = getFirebase();
  if (!db || !term.trim()) return [];
  const lower = term.toLowerCase();
  const q = query(
    collection(db, USERS),
    where("usernameLower", ">=", lower),
    where("usernameLower", "<=", lower + "\uf8ff"),
    fbLimit(20)
  );
  const snap = await getDocs(q);
  const out: UserProfile[] = [];
  snap.forEach((d) => {
    const p = d.data() as UserProfile;
    if (p.uid !== excludeUid) out.push(p);
  });
  return out;
}

// ----- challenges ------------------------------------------------------

export async function sendChallenge(from: UserProfile, toUid: string, toName: string): Promise<string> {
  const { db } = getFirebase();
  if (!db) throw new Error("Firestore not ready");
  const now = Date.now();
  const payload = {
    challengerUid: from.uid,
    challengerName: from.username,
    challengerPhoto: from.photoURL,
    targetUid: toUid,
    targetName: toName,
    status: "pending" as const,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    gameId: null,
  };
  const ref = await addDoc(collection(db, CHALLENGES), payload);
  return ref.id;
}

export async function cancelChallenge(id: string): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, CHALLENGES, id), { status: "cancelled" });
}

export async function declineChallenge(id: string): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, CHALLENGES, id), { status: "declined" });
}

export async function acceptChallenge(challenge: Challenge, myProfile: UserProfile): Promise<string> {
  const { db } = getFirebase();
  if (!db) throw new Error("Firestore not ready");
  // Challenger plays white, accepter plays black (simple rule; could be randomized).
  const whiteUid = challenge.challengerUid;
  const whiteName = challenge.challengerName;
  const blackUid = myProfile.uid;
  const blackName = myProfile.username;
  const now = Date.now();
  const game: Omit<GameDoc, "id"> = {
    whiteUid,
    whiteName,
    blackUid,
    blackName,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    pgn: "",
    turn: "white",
    status: "playing",
    winnerUid: null,
    moves: [],
    createdAt: now,
    updatedAt: now,
    lastMoveAt: now,
    drawOfferBy: null,
  };
  const gameRef = await addDoc(collection(db, GAMES), game);
  await updateDoc(doc(db, CHALLENGES, challenge.id), { status: "accepted", gameId: gameRef.id });
  return gameRef.id;
}

// Listen for incoming challenges targeted at me with status pending.
export function watchIncomingChallenges(myUid: string, cb: (cs: Challenge[]) => void): () => void {
  const { db } = getFirebase();
  if (!db) { cb([]); return () => {}; }
  // No orderBy — would require composite index.
  const q = query(
    collection(db, CHALLENGES),
    where("targetUid", "==", myUid),
    where("status", "==", "pending"),
    fbLimit(20)
  );
  return onSnapshot(q, (snap) => {
    const out: Challenge[] = [];
    snap.forEach((d) => out.push({ id: d.id, ...(d.data() as Omit<Challenge, "id">) }));
    out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    // Filter expired client-side to keep listener simple
    const now = Date.now();
    cb(out.filter((c) => c.expiresAt > now));
  }, (err) => {
    console.error("watchIncomingChallenges error:", err);
    cb([]);
  });
}

// Listen for challenges I sent (to know if accepted / declined / expired).
export function watchOutgoingChallenges(myUid: string, cb: (cs: Challenge[]) => void): () => void {
  const { db } = getFirebase();
  if (!db) { cb([]); return () => {}; }
  // No orderBy — would require composite index.
  const q = query(
    collection(db, CHALLENGES),
    where("challengerUid", "==", myUid),
    where("status", "in", ["pending", "accepted", "declined"]),
    fbLimit(20)
  );
  return onSnapshot(q, (snap) => {
    const out: Challenge[] = [];
    snap.forEach((d) => out.push({ id: d.id, ...(d.data() as Omit<Challenge, "id">) }));
    out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    cb(out);
  }, (err) => {
    console.error("watchOutgoingChallenges error:", err);
    cb([]);
  });
}

// ----- games -----------------------------------------------------------

export function watchGame(gameId: string, cb: (g: GameDoc | null) => void): () => void {
  const { db } = getFirebase();
  if (!db) { cb(null); return () => {}; }
  return onSnapshot(doc(db, GAMES, gameId), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    cb({ id: snap.id, ...(snap.data() as Omit<GameDoc, "id">) });
  });
}

export async function submitMove(
  gameId: string,
  move: GameMove,
  nextFen: string,
  nextTurn: PieceColor,
  pgn: string,
  status: GameStatus,
  winnerUid?: string | null
): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, GAMES, gameId), {
    fen: nextFen,
    turn: nextTurn,
    pgn,
    status,
    winnerUid: winnerUid ?? null,
    lastMoveAt: Date.now(),
    updatedAt: Date.now(),
    moves: arrayUnion(move),
    drawOfferBy: null,
  });
}

export async function offerDraw(gameId: string, uid: string): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, GAMES, gameId), { drawOfferBy: uid, updatedAt: Date.now() });
}

export async function respondDraw(gameId: string, accept: boolean, winnerUid?: string | null): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  if (accept) {
    await updateDoc(doc(db, GAMES, gameId), { status: "draw", winnerUid: null, drawOfferBy: null, updatedAt: Date.now() });
  } else {
    await updateDoc(doc(db, GAMES, gameId), { drawOfferBy: null, updatedAt: Date.now() });
  }
}

export async function resignGame(gameId: string, winnerUid: string): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, GAMES, gameId), { status: "resigned", winnerUid, updatedAt: Date.now() });
}

export async function abortGame(gameId: string): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  await updateDoc(doc(db, GAMES, gameId), { status: "aborted", updatedAt: Date.now() });
}

// Update win/loss stats for both players when a game ends.
export async function finalizeStats(game: GameDoc): Promise<void> {
  const { db } = getFirebase();
  if (!db) return;
  if (game.status === "aborted" || game.status === "playing") return;
  const white = doc(db, USERS, game.whiteUid);
  const black = doc(db, USERS, game.blackUid);
  if (game.status === "draw") {
    await updateDoc(white, { draws: increment(1) });
    await updateDoc(black, { draws: increment(1) });
    return;
  }
  const winner = game.winnerUid;
  if (!winner) return;
  const loser = winner === game.whiteUid ? black : white;
  await updateDoc(winner === game.whiteUid ? white : black, { wins: increment(1) });
  await updateDoc(loser, { losses: increment(1) });
}

export { serverTimestamp, Timestamp };
