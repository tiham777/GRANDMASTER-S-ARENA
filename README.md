# Grandmaster's Arena — Chess Web App

A polished, feature-rich chess web app with AI opponents, online multiplayer, an AI coach, and beautiful customization.

## Features

- **Play vs AI** — 5 difficulty levels (Beginner → Master) with a real minimax + alpha-beta pruning engine
- **Play Online** — Real-time multiplayer via WebSocket (socket.io). Create a room, share the code, play a friend
- **Local 2P** — Pass-and-play with a friend on the same device
- **AI Coach** — After each game vs AI, get a post-game analysis from an AI mentor (strengths, mistakes, practice tips)
- **8 Board Themes** — Classic Walnut, Tournament Green, Midnight, Oceanic, Sunset, Arctic Ice, Royal Purple, Sandstone Desert
- **6 Piece Sets** — Classic Staunton, Realistic 3D, Tournament, Marble Lux, Neon Glow, CBurnett
- **Game Stats** — Win/loss/draw tracking, win rate, streaks, recent games table
- **Rich UI** — Light/dark themes, splash animation, game-start animation, win/lose animations, focus mode
- **Sound Effects** — Synthesized move/capture/check/castle/promote/victory/defeat sounds (Web Audio API, no files)
- **PGN Export** — Copy or download any game as PGN
- **Rematch** — Request a rematch in online games with color swapping

## Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript
- **Styling**: Tailwind CSS 4 + shadcn/ui
- **Game Logic**: chess.js + react-chessboard v5
- **AI Engine**: Custom minimax with alpha-beta pruning, piece-square tables, quiescence search
- **Online**: socket.io (mini-service on port 3001)
- **Database**: Prisma ORM (SQLite for local dev)
- **AI Coach**: z-ai-web-dev-sdk (GLM LLM)
- **State**: Zustand (persisted settings)
- **Animations**: Framer Motion

## Quick Start (Local Development)

```bash
# Install dependencies
bun install

# Set up the database
bun run db:push

# Start the dev server (port 3000)
bun run dev
```

Open http://localhost:3000

### Online Multiplayer (Local)

The online mode requires the chess-online mini-service:

```bash
cd mini-services/chess-online
bun install
bun run dev
```

This starts the socket.io server on port 3001. The Caddy gateway (port 81) forwards WebSocket connections automatically.

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add -A
git commit -m "Grandmaster's Arena — chess web app"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub repo
2. Vercel auto-detects Next.js — keep the defaults
3. Add environment variables:
   - `DATABASE_URL` — Use a Vercel-compatible database (see below)
4. Click **Deploy**

### 3. Database Setup for Vercel

SQLite doesn't work on Vercel (serverless = no persistent filesystem). Use one of:

**Option A: Vercel Postgres (recommended, free tier)**
1. In Vercel dashboard → Storage → Create Postgres database
2. Copy the `DATABASE_URL` connection string
3. Add it as an environment variable
4. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
5. Run `bun run db:push` locally with the Postgres URL to create tables

**Option B: Keep SQLite for stats only (stats won't persist on Vercel)**
- The app works fine without a database — stats just won't save. All gameplay features work.

### 4. Online Multiplayer on Vercel

The online mode uses a separate socket.io server. To deploy it:

**Option A: Deploy as a separate Vercel serverless function (not recommended — WebSockets don't work well on serverless)**

**Option B: Deploy the mini-service to Railway/Render/Fly.io (recommended)**
1. Deploy `mini-services/chess-online/` as a separate Node.js service
2. Set the service URL in the frontend (update the `ONLINE_PORT` or connection URL in `src/hooks/useOnlineChess.ts`)
3. Update the Caddy/gateway config to forward WebSocket connections

**Option C: Skip online mode**
- The app works perfectly for vs AI, Local 2P, and AI Coach without the online service.

### 5. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No* | Database connection string. `file:./db/custom.db` for local SQLite. Use Postgres on Vercel. |
| `ZAI_API_KEY` | No** | z-ai-web-dev-sdk API key (for AI Coach). The SDK may work without it in the sandbox. |

\* Without a database, game stats won't persist. All gameplay still works.
\** Without the API key, the AI Coach feature won't work. All other features work.

## Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── page.tsx              # Single-page app with view router
│   │   ├── layout.tsx           # Root layout + ThemeProvider + SplashScreen
│   │   ├── globals.css          # Chess theme CSS (dark/light, animations)
│   │   └── api/
│   │       ├── coach/route.ts   # LLM AI Coach endpoint
│   │       ├── games/route.ts   # Game history CRUD
│   │       └── stats/route.ts   # Player stats
│   ├── components/
│   │   ├── chess/               # HomeView, GameView, OnlineGameView, etc.
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── SplashScreen.tsx     # Opening animation
│   │   ├── ThemeToggle.tsx      # Light/dark toggle
│   │   └── theme-provider.tsx   # next-themes wrapper
│   ├── hooks/
│   │   ├── useOnlineChess.ts    # Socket.io hook for online play
│   │   └── use-toast.ts         # Toast notifications
│   └── lib/
│       ├── chessAI.ts           # Minimax engine (5 difficulty levels)
│       ├── chessPieces.tsx      # SVG piece renderers (6 sets)
│       ├── chessSound.ts        # Web Audio sound synthesizer
│       ├── chessThemes.ts       # Board themes, piece sets, openings
│       ├── chessStore.ts        # Zustand store (persisted settings)
│       ├── coachTypes.ts        # AI Coach type definitions
│       ├── db.ts                # Prisma client
│       ├── gameApi.ts           # Game persistence helpers
│       └── onlineTypes.ts       # Online multiplayer types
├── mini-services/
│   └── chess-online/            # Socket.io server (port 3001)
│       ├── index.ts             # Server logic (rooms, moves, rematch)
│       └── package.json
├── prisma/
│   └── schema.prisma            # Database schema (Game + PlayerStats)
├── public/                      # Static assets
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Scripts

```bash
bun run dev        # Start dev server (port 3000)
bun run lint       # Run ESLint
bun run db:push    # Push Prisma schema to database
bun run db:generate # Generate Prisma client
```

## License

MIT — free to use, modify, and deploy.
