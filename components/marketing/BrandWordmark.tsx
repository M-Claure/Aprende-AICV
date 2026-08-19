import Image from "next/image";
import Link from "next/link";
import type { BrandConfig } from "@/lib/brand/types";

/**
 * The isologo, assembled from the brand config. Shared by every brand's header —
 * the *chrome* around it differs per brand, the mark itself does not need to.
 *
 * Two assembly modes, because brands lock their logos up differently:
 *
 * `lockup` — one image containing mark and wordmark together. Used when the
 * lockup is the asset and re-typesetting it would be off-brand.
 *
 * `mark-and-wordmark` — the mark as an image, the wordmark as **live text**. This
 * is how rumbolatino.com itself assembles its isologo, and it beats a flat image:
 * the wordmark stays crisp at any zoom, inherits the theme, and stays selectable
 * and translatable. `accentSuffix` is the trailing run that takes the accent
 * colour — " Latino" in "Rumbo Latino".
 *
 * Brand rules honoured here: the mark is never recoloured — it keeps its own
 * colour inside the asset — and the wordmark uses the dark brand anchor
 * (`brand-strong`) so it stays legible on any light surface.
 */
export function BrandWordmark({ brand, className = "" }: { brand: BrandConfig; className?: string }) {
  const { logo } = brand;

  if (logo.kind === "lockup") {
    // Scale to the configured height, preserving the asset's aspect ratio.
    const width = Math.round((logo.lockup.width * logo.displayHeight) / logo.lockup.height);
    return (
      <Link
        href="/"
        className={`flex shrink-0 items-center ${className}`}
        aria-label={`${brand.name} — inicio`}
      >
        <Image
          src={logo.lockup.src}
          alt={logo.lockup.alt}
          width={width}
          height={logo.displayHeight}
          priority
          style={{ height: logo.displayHeight, width: "auto" }}
        />
      </Link>
    );
  }

  return (
    <Link
      href="/"
      className={`flex shrink-0 items-center font-heading font-extrabold leading-none text-brand-strong ${className}`}
      style={{ gap: logo.markGap }}
      aria-label={`${brand.name} — inicio`}
    >
      <Image
        src={logo.mark.src}
        alt={logo.mark.alt}
        width={logo.mark.width}
        height={logo.mark.height}
        priority
        style={{ height: logo.displayHeight, width: logo.displayHeight }}
      />
      {/* aria-hidden: the accessible name is on the link, so a screen reader
          does not read the wordmark twice. */}
      <span aria-hidden>
        {logo.wordmark.text}
        {logo.wordmark.accentSuffix && (
          <span className="text-accent">{logo.wordmark.accentSuffix}</span>
        )}
      </span>
    </Link>
  );
}
