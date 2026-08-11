import Image from "next/image";
import Link from "next/link";

/**
 * Aprende+ brand bar, rendered above every screen by app/layout.tsx.
 *
 * The isologo is assembled the same way the Aprende+ design system assembles it,
 * rather than shipped as one flat image: the isotipo (flame) as a PNG, then the
 * wordmark as live text in Poppins 800 — "Aprende" in plum with the "+" in coral.
 * Building it from markup keeps the wordmark crisp at any zoom, lets it inherit
 * the theme, and keeps it selectable and translatable.
 *
 * Brand rules honoured here: the flame is never recoloured (it keeps its crimson
 * inside the asset), the "+" is always coral, and the wordmark is plum on light
 * backgrounds. Source: aprende-plus-landing.vercel.app/design-system.html
 *
 * Its total height must stay in sync with `--brand-header-h` in globals.css
 * (4px rule + 64px bar = 68px = 4.25rem).
 */
export function BrandHeader() {
  return (
    <header className="border-b border-border bg-white">
      <div className="h-1 w-full bg-accent" aria-hidden />
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-5 sm:gap-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-[3px] font-heading text-[22px] font-extrabold leading-none text-brand-plum"
          aria-label="Aprende+ — inicio"
        >
          <Image
            src="/aprende-plus-isotipo.png"
            alt=""
            width={48}
            height={48}
            priority
            className="h-7 w-7"
          />
          <span aria-hidden>
            Aprende<span className="text-brand-coral">+</span>
          </span>
        </Link>

        <span className="h-6 w-px shrink-0 bg-border" aria-hidden />

        <span className="truncate font-heading text-base font-bold uppercase tracking-wide text-brand-plum sm:text-lg">
          Mi CV con IA
        </span>
      </div>
    </header>
  );
}
