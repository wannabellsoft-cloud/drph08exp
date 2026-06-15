import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Short EXP Manager",
  description: "Manage Short EXP transfers between 60008 and 60008-EXP",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Short EXP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  // Allow user scaling — important for accessibility on mobile
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
