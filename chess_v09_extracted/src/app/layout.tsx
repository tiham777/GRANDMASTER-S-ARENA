import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { SplashScreen } from "@/components/SplashScreen";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grandmaster's Arena — Chess",
  description:
    "Play chess against an AI with 5 difficulty levels, challenge a friend online, and master the royal game.",
  keywords: ["chess", "chess game", "AI chess", "play chess online", "react-chessboard", "chess.js"],
  authors: [{ name: "Grandmaster's Arena" }],
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icon.svg",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Grandmaster's Arena",
  },
  openGraph: {
    title: "Grandmaster's Arena — Chess",
    description:
      "Play chess against an AI, challenge a friend online, and master the royal game.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <SplashScreen />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
