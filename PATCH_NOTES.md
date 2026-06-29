# Patch Notes — Grandmaster's Arena (chess-fullstack-fixed)

This patch fixes the **blank chess board** issue observed at
`grandmaster-s-arena-nizo.vercel.app/index.html#game=...` where the player bars
render but the board stays empty.

## Root cause summary

The deployed `public/index.html` had several failure modes that all produced the
same symptom (blank board). The **primary** root cause was discovered after the
first patch surfaced the error:

> `⚠️ Uncaught TypeError: chess.inCheck is not a function`
> `Chess engine not loaded. Check that /chess.min.js is deployed.`

### THE primary bug — chess.js version mismatch (Fix 12, latest)

`public/index.html` was calling `chess.inCheck()` (camelCase, v1.x API), but
was loading **chess.js v0.10.3** from cdnjs which uses snake_case
(`in_check()`). The board ALWAYS crashed on every game, even when cdnjs was
reachable. This was the bug all along — every other "fix" was just defensive
plumbing.

`package.json` lists `chess.js@^1.4.0` (which the offline `chess.html` uses
correctly), but `public/index.html` was loading v0.10.3 from a hardcoded CDN
URL — version skew.

**Fix:** Replaced the vendored `chess.min.js` with a browser-IIFE bundle of
chess.js v1.4.0 (matching `package.json`), built with `bun build --format=iife`
from the official npm tarball, with `window.Chess = Chess` injected at the end.

All 10 API methods my code uses are verified present and working in v1.4.0:
`turn()`, `board()`, `get(sq)`, `inCheck()`, `moves({square, verbose})`,
`move({from, to, promotion})`, `fen()`, plus `findKing` helper pattern.

### Other defensive fixes (Fixes 1-11, from first patch)

These didn't fix the primary bug but make the app more robust:

1. **chess.js vendored locally** — no more CDN dependency
2. **Global error handler** — surfaces uncaught errors in the UI
3. **Inline error banner** — replaces `alert()` (which users dismiss and lose)
4. **`safeNewChess()` helper** — clear error if library missing
5. **Defensive `renderOnlineGame()`** — renders loading state instead of blank
6. **Defensive `renderBoard()`** — try/catch around every `chess.get()` call
7. **`joinOnlineGame()` improvements** — immediate render, permission-denied detection, stale callback guards
8. **`applyHash()` race fix** — called after auth resolves, so shared URLs work
9. **Guests blocked from online games** — clear error instead of silent failure
10. **`goHome()` doesn't clobber hash** — uses `replaceState`
11. **`cleanupOnline()` clears error banner** — no stale errors

---

## Files changed

### `public/chess.min.js` (NEW FILE — 88,287 bytes)

Browser-IIFE bundle of **chess.js v1.4.0** (matches `package.json`).

Built from the official npm tarball:
```bash
curl -o chess.tgz https://registry.npmjs.org/chess.js/-/chess.js-1.4.0.tgz
tar -xzf chess.tgz package/dist/esm/chess.js
# entry.js: import { Chess } from "./chess-src.js"; window.Chess = Chess;
bun build entry.js --outfile chess.min.js --format=iife
```

The result is a single file that:
- Exposes `window.Chess` (camelCase API matching v1.x)
- Works with plain `<script src="/chess.min.js"></script>` (no module loader needed)
- Has all the methods the patched `index.html` calls

### `public/index.html` (patched)

All changes are marked with `===== FIX:` comments in the source (24 markers total).

#### Fix 1 — Vendor chess.js locally

```diff
- <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
+ <script src="/chess.min.js"></script>
```

Plus a `DOMContentLoaded` check that surfaces a visible red banner if
`window.Chess` is not a function after load.

#### Fix 2-11 — Defensive plumbing

(See source comments — each marked with `===== FIX:`.)

#### Fix 12 — Replace v0.10.3 with v1.4.0 (THE actual bug fix)

The vendored `chess.min.js` is now v1.4.0 (matching `package.json`) instead
of v0.10.3. This means `chess.inCheck()`, `chess.isCheckmate()`, etc. all
work as the code expects. Previously, every call to `chess.inCheck()` threw
`TypeError: chess.inCheck is not a function` because v0.10.3 only had
`in_check()` (snake_case).

---

## Verification

### Smoke test — chess.js v1.4.0 API

`/home/z/my-project/scripts/test_chess_api.js` loads the bundled file in a
Node VM, creates a `Chess` instance, and calls every method my code uses:

```
✓ window.Chess is a function
✓ new Chess() works
✓ chess.turn() = w (expected "w")
✓ chess.board() returned 8 x 8 array
✓ chess.get("e2") = {"type":"p","color":"w"}
✓ chess.inCheck() = false (expected false at start)
✓ chess.moves({square:"e2", verbose:true}) returned 2 moves
✓ chess.move({from:"e2", to:"e4"}) = {"from":"e2","to":"e4","san":"e4"}
✓ after e4, chess.turn() = b (expected "b")
✓ chess.fen() = rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1
✓ chess.move() on illegal move: threw=true nullResult=false
✓ findKing(chess, "w") = e1 (expected "e1")

🎉 ALL TESTS PASSED
```

### HTML syntax check

All inline `<script>` blocks pass `new Function()` parsing:

```
Block 1: module script (skipped, 2550 chars)
Block 2: OK (1273 chars)
Block 3: OK (67405 chars)

✓ All script blocks are syntactically valid.
```

---

## Files NOT changed

- `public/chess.html` and `public/chess-game.html` — the offline chess game, untouched
- `firestore.rules` — security rules are correct as-is
- `next.config.ts`, `src/**`, `package.json`, etc. — no changes needed

---

## How to deploy

1. Replace your existing `public/index.html` with the patched version
2. Add `public/chess.min.js` to your repo (88 KB new file)
3. Commit & push to GitHub; Vercel will auto-redeploy
4. Open a game URL like `https://yoursite.vercel.app/index.html#game=XXXX`
   - Board should now render with pieces immediately
   - If anything else goes wrong, you'll see a red error banner with specifics

## If the board is STILL blank after deploying

Open browser DevTools (F12) → Console tab. Common remaining causes:

| Console error | Fix |
| --- | --- |
| `FirebaseError: Missing or insufficient permissions` on `/games/...` | You're not a participant. Sign in with the Google account that created/accepted the challenge. |
| `FirebaseError: No document to update` | The game doc was deleted. Create a new game via the lobby. |
| `chess.js library failed to load` | `public/chess.min.js` is missing from your deployment. Verify it's committed to git. |
| `Network error` when loading `/chess.min.js` | Vercel didn't deploy the `public/` folder. Check your build settings. |
