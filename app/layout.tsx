import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { playfair } from "./fonts";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Snow Peak Way",
  description: "Snow Peak Way workshop registration and schedule",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Snow Peak Way",
  },
  icons: {
    apple: "/spw-logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a1a1a",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
