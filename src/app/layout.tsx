import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grandmaster's Arena | Chess with AI, Analysis & Online Play",
  description:
    "Play chess online with friends — Gmail or guest login, challenge by username, focus-mode board, real-time multiplayer backed by Firebase.",
  keywords: [
    "chess",
    "online chess",
    "multiplayer chess",
    "firebase chess",
    "next chess",
    "grandmaster arena",
  ],
  authors: [{ name: "Grandmaster's Arena" }],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Grandmaster's Arena",
    description: "Online chess with friends + AI analysis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Grandmaster's Arena",
    description: "Online chess with friends + AI analysis",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-stone-950 text-stone-100 min-h-screen`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
