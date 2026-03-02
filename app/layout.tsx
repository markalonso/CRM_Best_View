import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRM Best View",
  description: "Architecture scaffold for AI-powered CRM intake"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
