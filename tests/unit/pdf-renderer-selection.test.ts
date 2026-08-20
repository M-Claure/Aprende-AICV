/**
 * Which PDF renderer runs where.
 *
 * Getting this wrong is invisible until someone downloads a résumé: on Vercel the
 * full-puppeteer path has no browser at all (its Chromium is ~300 MB, over the
 * 250 MB function limit, and npm skips the postinstall that fetches it), while
 * locally the serverless path has a Linux-only binary. Both failures surface at
 * render time, and `ResumeArtifactWriter` swallows the generation-side one — so the
 * selection is pinned here.
 */
import { describe, expect, it } from "vitest";
import { ServerlessPdfGenerator, resolvePdfRenderer } from "@/lib/resume/pdf-generator";

describe("resolvePdfRenderer", () => {
  it("picks serverless on Vercel", () => {
    expect(resolvePdfRenderer("auto", { VERCEL: "1" })).toBe("serverless");
  });

  it("picks serverless on bare Lambda", () => {
    expect(resolvePdfRenderer("auto", { AWS_LAMBDA_FUNCTION_VERSION: "$LATEST" })).toBe("serverless");
  });

  it("picks local everywhere else", () => {
    expect(resolvePdfRenderer("auto", {})).toBe("local");
    // A self-hosted production server has a real filesystem: NODE_ENV is not the
    // signal, the runtime is.
    expect(resolvePdfRenderer("auto", { NODE_ENV: "production" })).toBe("local");
  });

  it("obeys an explicit override in both directions", () => {
    expect(resolvePdfRenderer("local", { VERCEL: "1" })).toBe("local");
    expect(resolvePdfRenderer("serverless", {})).toBe("serverless");
  });
});

describe("serverless renderer dependencies", () => {
  /**
   * Its Chromium binary is Linux-only, so a launch cannot run on a dev Mac and is
   * deliberately not attempted here (it would also make the unit suite depend on a
   * ~300 MB download). What this does catch is the failure mode that would
   * otherwise only appear on Vercel: a dependency that isn't installed, or a
   * version whose API no longer matches the launch code.
   */
  it("resolves both packages and exposes the API the launch uses", async () => {
    expect(new ServerlessPdfGenerator().available).toBe(true);

    const chromium = (await import("@sparticuz/chromium")).default;
    expect(Array.isArray(chromium.args)).toBe(true);
    expect(typeof chromium.executablePath).toBe("function");

    const puppeteerCore = await import("puppeteer-core");
    // 148 dropped `chromium.headless`/`defaultViewport`, so the flags for the
    // headless-shell build have to come through `defaultArgs`.
    expect(typeof puppeteerCore.defaultArgs).toBe("function");
  });
});
