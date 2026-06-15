import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Short EXP Manager",
  description: "Manage Short EXP transfers between 60008 and 60008-EXP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
