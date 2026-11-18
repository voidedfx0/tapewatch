import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TapeWatch | X Layer Intelligence",
  description: "Read-only X Layer processor and wallet intelligence workspace."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
