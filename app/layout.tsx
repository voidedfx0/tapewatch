import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./reference-dashboard.css";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: "TapeWatch | Website & X Layer Intelligence",
  description: "Monitor website changes, inspect integrity evidence, and explore X Layer token and circuit intelligence."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={spaceGrotesk.variable}>{children}</body>
    </html>
  );
}
