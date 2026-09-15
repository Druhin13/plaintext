import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "plaintext",
  description: "Hide a secret inside ordinary-looking text. Everything stays on your device.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
