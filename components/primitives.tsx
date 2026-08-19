"use client";

import type { ReactNode } from "react";

/**
 * Shared presentational primitives matching the Pencil design tokens.
 *
 * Brand-agnostic by construction: every colour here is a *semantic* token
 * (`accent`, `text-secondary`, `border`) that the active brand fills in via CSS
 * custom properties, so these components are never touched when a brand is added.
 * See `docs/branding.md`.
 */

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "text";
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    // `accent-on` rather than a hard-coded white or ink: the readable label
    // colour for an accent fill differs per brand (see lib/brand/brands/*.ts).
    primary: "bg-accent text-accent-on hover:bg-accent-hover",
    secondary: "bg-white text-text-primary border border-border hover:bg-gray-50",
    text: "text-accent-dark hover:underline px-3",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-white p-5 shadow-soft ${className}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 flex justify-between text-xs text-text-secondary">
          <span>{label}</span>
          <span>{pct}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * A prominent "what to do now" banner shown at the very top of every screen.
 * Written for low-literacy readers: a large icon, a short bold title, and one
 * plain-language sentence. Kept visually distinct (left stripe + tinted card)
 * so it always reads as the on-screen instruction, not body content.
 */
export function InstructionBanner({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border-l-4 border-accent bg-accent-light px-4 py-3">
      {icon && (
        <span className="text-2xl leading-none" aria-hidden>
          {icon}
        </span>
      )}
      <div>
        <p className="text-sm font-bold text-accent-dark">{title}</p>
        <p className="mt-0.5 text-base leading-snug text-text-primary">{children}</p>
      </div>
    </div>
  );
}

export function AiBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-light text-sm font-bold text-accent-dark">
        IA
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-ai-bubble px-4 py-3 text-sm leading-relaxed text-text-primary">
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-text-secondary">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
