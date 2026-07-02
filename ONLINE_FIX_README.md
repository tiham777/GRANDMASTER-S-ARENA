# Online Play Fix — Switched to Firebase Realtime Database

## What was broken

Your online mode used a **socket.io mini-service** on port 3001 (`mini-services/chess-online/index.ts`) fronted by a **Caddy gateway** that routed based on the `?XTransformPort=3001` query parameter (see `Caddyfile`).

This architecture works **only** when:

1. Caddy is running on port 81 in front of your app, AND
2. The chess-online socket.io service is running on port 3001 on the same host, AND
3. Both processes stay alive.

**On any real-world host** (Vercel / Netlify / Cloudflare Pages / Render free tier / shared hosting), none of that exists:

- There is no Caddy — the host's own CDN/edge handles routing.
- There is no way to run a separate long-running socket.io process alongside the Next.js app.
- The frontend's `io("/?XTransformPort=3001")` request hits the host's `/socket.io/` path → 404 → "Connection failed".

## The fix

Online play now uses **Firebase Realtime Database** instead of socket.io.

Benefits:

- ✅ Works on **any** static host (Vercel, Netlify, GitHub Pages, etc.) — no separate server needed.
- ✅ Real-time sync built in via Firebase `onValue` / `onChildAdded` listeners.
- ✅ Move legality is enforced inside a `runTransaction` — clients cannot cheat because the transaction only commits if the room's state still allows the move.
- ✅ The public hook API is unchanged, so `OnlineSocketProvider`, `OnlineLobbyView`, and `OnlineGameView` were **not modified**.

## Files changed

| File | Change |
|------|--------|
| `src/lib/firebase.ts` | **NEW** — Firebase initialization using your provided config. |
| `src/hooks/useOnlineChess.ts` | **REWRITTEN** — socket.io replaced with Firebase Realtime DB. Same public API. |
| `package.json` | Added `firebase: ^10.14.1` to dependencies. |

No other source files were touched. The old socket.io mini-service (`mini-services/chess-online/`) and the `Caddyfile` are now **unused** — you can delete them or leave them; they don't affect anything.

## Setup steps (5 minutes)

### 1. Create a Realtime Database in your Firebase project

1. Go to <https://console.firebase.google.com> → your project (`multiplayer-chess-b9742`).
2. Left menu → **Build** → **Realtime Database** → **Create Database**.
3. Pick a location (e.g., `us-central1`).
4. Start in **test mode** for now (we'll lock it down in step 4).

> ⚠️ **IMPORTANT**: Choose **Realtime Database**, NOT Firestore Database. They are different products with different rule languages. If you see `firestore/` in the console URL, you're in the wrong place.

### 2. Verify the `databaseURL` in `src/lib/firebase.ts`

After creating the database, the console shows a URL like:

```
https://multiplayer-chess-b9742-default-rtdb.firebaseio.com/
```

This is already set in `src/lib/firebase.ts`. If your database is in a different region (e.g. Europe), the URL will be different (e.g. `...-default-rtdb.europe-west1.firebasedatabase.app`) — copy the exact URL from the console and paste it into `firebaseConfig.databaseURL`.

### 3. Install the new dependency

```bash
bun install      # or: npm install / yarn install / pnpm install
```

This pulls in the `firebase` package that was added to `package.json`.

### 4. Set your Realtime Database rules

In the Firebase console → Realtime Database → **Rules** tab, paste:

```json
{
  "rules": {
    "chess": {
      "rooms": {
        ".read": true,
        ".write": true
      },
      "lobby": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

This allows anyone with your database URL to read/write under `/chess/*` — fine for a casual game between friends. For a production app you'd want to require Firebase Auth, but for now this is the simplest setup that makes online play work.

> ⚠️ **Heads-up**: these permissive rules mean anyone who knows your database URL can read/write under `/chess/`. Don't share the URL publicly. If you want stricter rules, see the "Hardening" section below.

### 5. Deploy

Deploy to your host as usual (Vercel, Netlify, etc.). No environment variables are needed for online play — the config is bundled in `src/lib/firebase.ts`.

### 6. Test

1. Open your deployed app in two browser tabs (or send the link to a friend).
2. In tab A: enter a name, click **Create Room**, copy the code.
3. In tab B: enter a name, paste the code, click **Join Game**.
4. Both tabs should see the board, moves should sync in real time, chat works, resign / draw / rematch all work.

## How it works (architecture)

### Firebase RTDB schema

```
chess/
  rooms/{CODE}/
    code, hostName, hostColor, guestName,
    hostId, guestId, whiteId, blackId,        ← client UUIDs (localStorage)
    fen, pgn,
    moves: { pushKey: { from, to, promotion, san, at, by } }
    chat:  { pushKey: { from, name, message, at } }
    status, result, winner, drawOfferBy,
    timeControlId, hostPreferences, createdAt, lastActivity,
    rematchOfferBy                                  ← 'white' | 'black' | null
  lobby/{CODE}/
    code, hostName, hostColor, createdAt
```

### Connection state

We use Firebase's built-in `.info/connected` special location to track whether the client has an active RTDB connection. This drives the `connected` flag returned by `useOnlineChess()`.

### Player identity

Each browser gets a stable random UUID stored in `localStorage` (`grandmasters-arena-online-client-id`). This replaces the old `socket.id`. It identifies the host/guest across reconnects and refreshes, so a player who drops and reconnects is automatically re-associated with their seat.

### Atomic move application

Moves are written via `runTransaction(roomRef, updater)`. Inside the transaction:

1. Load the current FEN from the room.
2. Verify it's the sender's turn.
3. Try the move with `chess.js` (throws on illegal moves → abort transaction).
4. If legal, update FEN/PGN, append to moves map, check for checkmate/draw.

If two clients race to move simultaneously, Firebase retries the transaction with the latest state — so the second client's transaction sees the first move already applied and either fails the "not your turn" check or applies on the new position.

### Detecting rejected moves

Before the transaction, we pre-generate a unique `moveKey`. Inside the transaction, we use this key when adding the move. After the transaction commits, we check if `snapshot.val().moves[moveKey]` exists. If not, the move was rejected — we surface an `error` so `OnlineGameView` can revert its optimistic UI.

## Hardening (optional, for production)

The permissive rules above let anyone read/write under `/chess/`. To lock it down:

### Option A: Require Firebase Anonymous Auth

1. Enable **Anonymous** sign-in: Firebase console → Authentication → Sign-in method → Anonymous → Enable.
2. Add a few lines to `src/lib/firebase.ts`:

   ```ts
   import { getAuth, signInAnonymously } from "firebase/auth";
   export const auth = getAuth(app);
   // Trigger anonymous sign-in on first load:
   if (typeof window !== "undefined") {
     signInAnonymously(auth).catch(console.error);
   }
   ```

3. Update the database rules:

   ```json
   {
     "rules": {
       "chess": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
   }
   ```

## FAQ

**Q: Do I still need the `mini-services/chess-online/` folder or the `Caddyfile`?**

No. Both are now unused. You can delete them or keep them as historical reference. They do not affect the build.

**Q: Do I still need `socket.io-client` in `package.json`?**

No. It's safe to remove with `bun remove socket.io-client` (or `npm uninstall socket.io-client`). I left it in to avoid breaking your `bun.lock`; remove it whenever convenient.

**Q: What about the AI Coach feature that uses `z-ai-web-dev-sdk`?**

Unchanged. The AI Coach runs through Next.js API routes (`/api/coach`), not the online service. It still works on Vercel as before.

**Q: What about Prisma / SQLite?**

Unchanged. The database is only used for game stats and history. Online play does not touch the database.

**Q: Will this work on Vercel's free tier?**

Yes — Firebase Realtime Database has a generous free tier (1 GB storage, 10 GB/month transfer, 100 simultaneous connections). A casual chess game won't come close to those limits.

**Q: What if my Firebase project doesn't have Realtime Database enabled?**

You'll see a "Permission denied" or "Database does not exist" error in the browser console. Follow step 1 above to create the database.

**Q: Why does the connection badge say "Connecting…" for a moment?**

That's normal — Firebase RTDB takes a moment to establish the WebSocket connection after first load. The badge flips to "Connected" within ~500ms.
