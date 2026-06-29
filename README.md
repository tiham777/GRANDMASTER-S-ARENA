# Grandmaster's Arena — Full-Stack Chess (Next.js + Firebase)

A multiplayer chess web app built on top of your original `chess-game.html`.

- **Google login** with a chosen username
- **Guest login** for players who don't want to authenticate
- **Online 2-player mode** with username search and challenge invites
- **5-minute accept window** — challenge expires if the opponent doesn't respond
- **Focus-mode board** — minimal-distraction online game page with real-time move sync
- **Original offline mode preserved 100%** — AI / local 2P still works exactly as before

## 1. Tech stack

| Layer            | Tech |
| ---------------- | ---- |
| Framework        | Next.js 16 (App Router) + TypeScript |
| Styling          | Tailwind CSS 4 (dark stone/amber theme to match the original) |
| State            | Zustand |
| Auth             | Firebase Auth (Google + Anonymous) |
| Realtime DB      | Firestore (challenges, games, user profiles, moves) |
| Game logic       | chess.js |
| Board UI         | react-chessboard v5 |
| Original game    | `public/chess-game.html` — embedded in an iframe, untouched |

## 2. Project structure

```
.
├── public/
│   └── chess-game.html          # ORIGINAL FILE — UNMODIFIED
├── src/
│   ├── app/
│   │   ├── layout.tsx           # Dark theme applied globally
│   │   ├── page.tsx             # View-state router: loading/login/lobby/game/offline
│   │   └── globals.css          # Tailwind + dark stone/amber theme
│   ├── components/chess/
│   │   ├── LoginView.tsx        # Google + Guest login
│   │   ├── LobbyView.tsx        # Online players, search, challenge
│   │   ├── ChallengeModal.tsx   # 5-min countdown + accept/decline
│   │   ├── GameView.tsx         # Focus-mode online board
│   │   └── OfflineView.tsx      # Iframe wrapper around chess-game.html
│   └── lib/
│       ├── firebase.ts          # Firebase client init (reads NEXT_PUBLIC_*)
│       ├── chessApi.ts          # All Firestore data-access layer
│       ├── store.ts             # Zustand store
│       └── types.ts             # Shared types + CHALLENGE_TTL_MS (5 min)
├── firestore.rules              # Firestore security rules (paste into console)
├── firebase.json                # Firebase config
├── .env.local                   # Firebase config values (already filled in)
└── package.json
```

## 3. Firebase setup (one-time, ~5 minutes)

You already created the Firebase project `multiplayer-chess-b9742`. The Firebase config is already wired up in `.env.local`. The remaining steps are:

### 3.1 Enable auth providers

1. Open [Firebase Console → Authentication → Sign-in method](https://console.firebase.google.com/project/multiplayer-chess-b9742/authentication/providers).
2. Enable **Google**:
   - Toggle "Enable" → On
   - Pick a support email (yours) → Save
3. Enable **Anonymous**:
   - Toggle "Enable" → On → Save

### 3.2 Add authorized domains

Still in Authentication → Settings → Authorized domains, add:

- `localhost` (already there by default — for local dev)
- your Vercel domain, e.g. `your-app.vercel.app`
- any preview domains Vercel creates, e.g. `your-app-git-main-xxx.vercel.app`

Without this, Google sign-in popups will be blocked with `auth/unauthorized-domain`.

### 3.3 Create the Firestore database

1. Open [Firebase Console → Firestore Database](https://console.firebase.google.com/project/multiplayer-chess-b9742/firestore).
2. Click **Create database** → start in **production mode** → pick a region close to your users.
3. Once created, go to the **Rules** tab and paste the contents of `firestore.rules` from this repo.
4. Click **Publish**.

These rules:
- Allow anyone to read user profiles (so search works)
- Allow users to create/update only their own profile
- Allow users to read challenges targeted at them
- Allow challenger to cancel, target to accept/decline
- Allow both players of a game to read it and submit moves

### 3.4 (Optional) Create Firestore indexes

The queries in this app are simple and don't require composite indexes for typical usage. If Firestore complains about a missing index in the console, click the link it gives you and create it (one click).

## 4. Local development

```bash
# install deps
bun install   # or: npm install

# start dev server on port 3000
bun run dev   # or: npm run dev
```

Open http://localhost:3000.

- **Login page** should appear immediately.
- Click **Skip — Play vs AI / Local 2P** to enter the original chess game in an iframe — this works fully offline, no auth required.
- To test online mode, complete the Firebase setup above, then sign in with Google or as Guest.

## 5. Deploy to Vercel

### 5.1 Push to GitHub

```bash
git init
git add -A
git commit -m "Initial commit — Grandmaster's Arena full-stack"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 5.2 Import to Vercel

1. Open [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Vercel auto-detects Next.js — keep the defaults.
3. Under **Environment Variables**, add (these are already in `.env.local` but Vercel needs them too):
   - `NEXT_PUBLIC_FIREBASE_API_KEY` = `AIzaSyDFWqdJHdCb1vaR6uRuKmHd2M5oOWIjJDk`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = `multiplayer-chess-b9742.firebaseapp.com`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `multiplayer-chess-b9742`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` = `multiplayer-chess-b9742.firebasestorage.app`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` = `475801564420`
   - `NEXT_PUBLIC_FIREBASE_APP_ID` = `1:475801564420:web:e10cc670293995f4350c51`
   - `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` = `G-8BNF5RFD2E`
4. Click **Deploy**.
5. After deployment, copy your production domain (e.g. `https://your-app.vercel.app`) and add it to **Firebase Console → Authentication → Settings → Authorized domains**.

### 5.3 First-time test

1. Open the Vercel URL.
2. Sign in with Google → pick a username → lobby loads.
3. Sign in as Guest in another browser/incognito with a different username.
4. From one account, search for the other and click **Challenge**.
5. The other account should see a 5-minute countdown modal → **Accept**.
6. Both jump into the focus-mode board. Moves sync in real time.

## 6. How the multiplayer flow works

1. **Auth** → `watchAuthState` subscribes to `onAuthStateChanged`. On first sign-in, we create a `/users/{uid}` doc with the chosen username (lowercased for search).
2. **Lobby** → `watchOnlinePlayers` subscribes to `/users` filtered by `isOnline == true`, ordered by `lastSeen desc`. A 60-second heartbeat keeps the doc fresh.
3. **Challenge** → `sendChallenge` writes a `/challenges/{id}` doc with `status: pending` and `expiresAt: now + 5min`.
4. **Accept window** → both challenger and target subscribe to their respective challenge queries (`where("challengerUid", "==", me)` and `where("targetUid", "==", me)`). The target sees a modal with a live countdown.
5. **Accept** → `acceptChallenge` creates a `/games/{id}` doc with the starting FEN and writes `status: accepted` + `gameId` on the challenge. Both clients' outgoing-challenge listener sees the update and transitions to the Game view.
6. **Moves** → both clients subscribe to `/games/{id}`. When it's your turn, click a piece → click a target square → `submitMove` updates the doc with the new FEN, SAN, move object, turn, status, and pushes the move into the `moves` array. The other client's snapshot listener applies the move locally via `chess.js`.
7. **End of game** → checkmate / stalemate / draw detection happens on the moving client. `submitMove` writes the final `status`. When the listener sees a non-`playing` status, `finalizeStats` increments each player's wins/losses/draws once.
8. **Resign / draw** → resign writes `status: resigned, winnerUid: <opponent>`. Draw offer writes `drawOfferBy`; the other player gets a modal to accept/decline.

## 7. What was NOT changed

- `public/chess-game.html` is byte-for-byte identical to the file you uploaded. The original AI mode, local pass-and-play, themes, animations, focus mode, hints, take-backs, analysis — everything still works.
- When the user clicks **Skip — Play vs AI / Local 2P** on the login page (or the **vs AI / Local** button in the lobby), the original game loads in an iframe. You can also pop it out to fullscreen or open `/chess-game.html` directly.

## 8. Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `auth/admin-restricted-operation` when signing in as Guest | Enable Anonymous auth in Firebase Console → Authentication → Sign-in method. |
| `auth/unauthorized-domain` on Google sign-in | Add your domain (localhost, *.vercel.app) to Firebase Console → Authentication → Settings → Authorized domains. |
| Page stuck on "Loading…" | Check browser console. Firebase init failed — verify `.env.local` values and restart `bun run dev`. |
| Online players list is empty | Either no one else is signed in, or Firestore rules block reads. Verify rules in step 3.3. |
| Challenge sent but opponent never sees modal | Opponent must be signed in. Their listener only fires for `status: pending` challenges targeted at their uid. |
| Moves not syncing | Check Firestore rules — both players must be in the `whiteUid`/`blackUid` of the game doc. |
| `Missing or insufficient permissions` on move write | You're trying to move when it's not your turn, or you're not a player in the game. Check that `game.turn === myColor` and `game.whiteUid`/`blackUid` includes your uid. |

## 9. Limitations / known tradeoffs

- **No per-game time control** for online play (yet). The original chess game's clock modes only apply to offline/AI play. Online play uses a count-up timer showing how long the current player is taking.
- **No rematch button** in v1. After a game ends, both players return to the lobby. Either can issue a fresh challenge.
- **No chat**. The right rail shows only the move list. (Could be added later — Firestore `messages` subcollection under `/games/{id}/messages`.)
- **No reconnection handling** beyond Firestore's native resume. If a player closes their tab mid-game, the game doc stays in `playing` state forever. The other player can choose to resign or wait. (A "claim victory on disconnect" feature could be added by writing `lastSeenAt` on every move and checking staleness.)
- **Username uniqueness** is enforced by querying Firestore before sign-in. There's no transactional lock, so two simultaneous sign-ins with the same name could both succeed in a race. For a production app, add a Cloud Function that rejects duplicate `usernameLower` writes.
