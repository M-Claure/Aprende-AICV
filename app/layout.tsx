import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { BrandHeader } from "@/components/BrandHeader";

/**
 * Aprende+ typefaces: Inter for body copy and Poppins for display type. Loaded
 * through next/font so they are self-hosted at build time — no runtime request
 * to a third party, and no layout shift. Exposed as CSS variables that
 * tailwind.config.ts maps to `font-main` / `font-heading`.
 *
 * Poppins ships 700/800 because the system sets H3 at 700 and Display/H1/H2 at
 * 800; Inter ships 400/600/700 for body, emphasis and small headings.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-main",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mi CV con IA — Aprende Institute",
  description: "Crea tu currículum profesional con ayuda de inteligencia artificial.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${poppins.variable}`}>
      <body className="bg-bg-primary font-main text-text-primary antialiased">
        <BrandHeader />
        {children}
      </body>
    </html>
  );
}
