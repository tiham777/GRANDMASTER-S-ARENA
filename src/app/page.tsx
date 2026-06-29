import { redirect } from "next/navigation";

// The actual chess app lives in /public/index.html (vanilla JS, handles
// Firebase login + online multiplayer + lobby). /public/chess.html is the
// standalone offline chess game (NOT connected to Firebase login).
// We redirect `/` → `/index.html` so the user's app takes over immediately.
export default function Home() {
  redirect("/index.html");
}
