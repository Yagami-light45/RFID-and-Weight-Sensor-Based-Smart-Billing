import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "Smart Billing Trolley",
    template: "%s · Smart Billing",
  },
  description: "RFID and weight-sensor billing for shopping trolleys",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-stone-100 font-sans text-stone-900">
        <header className="border-b border-stone-200 bg-white no-print">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Smart Billing
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-stone-600 hover:text-stone-900">
                Trolleys
              </Link>
              <Link href="/admin" className="text-stone-600 hover:text-stone-900">
                Admin
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
