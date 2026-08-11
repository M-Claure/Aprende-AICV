import { describe, expect, it } from "vitest";
import { sanitizeProps } from "@/lib/analytics/events";
import { NoopAnalytics } from "@/lib/analytics";

describe("analytics sanitizeProps (spec §18 — no raw answers / PII)", () => {
  it("keeps only allow-listed properties", () => {
    const out = sanitizeProps({
      resumeProfileId: "p1",
      section: "experience",
      completenessScore: 42,
      skipped: false,
      // These must be dropped:
      rawAnswer: "Vivo en Calle Falsa 123 y mi teléfono es 999",
      email: "user@example.com",
      firstName: "María",
      phone: "999888777",
    });
    expect(out).toEqual({
      resumeProfileId: "p1",
      section: "experience",
      completenessScore: 42,
      skipped: false,
    });
    expect(out).not.toHaveProperty("rawAnswer");
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("firstName");
  });

  it("drops non-primitive values", () => {
    const out = sanitizeProps({ resumeProfileId: "p1", section: { nested: true } as unknown as string });
    expect(out).toEqual({ resumeProfileId: "p1" });
  });

  it("NoopAnalytics.track never throws", () => {
    const a = new NoopAnalytics();
    expect(() => a.track("resume_generated", { resumeProfileId: "p1" }, "u1")).not.toThrow();
  });
});
