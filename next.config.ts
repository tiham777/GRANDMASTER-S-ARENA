import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Serve the user's vanilla-JS multiplayer chess app at the root URL.
  // /public/index.html is the main entry (login + lobby + online game).
  // /public/chess.html is the original offline chess game (vs AI + Pass & Play),
  //   loaded in an iframe by index.html — NOT connected to Firebase login.
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
    ];
  },
};

export default nextConfig;
