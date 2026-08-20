import "server-only";
import { Errors } from "@/lib/errors";
import { getEnv } from "@/lib/env";

/**
 * Server-side PDF generation from rendered resume HTML.
 *
 * TWO implementations behind one interface, because the browser that renders the
 * PDF cannot be the same one in both places:
 *
 *  - `PuppeteerPdfGenerator` — full `puppeteer`, which downloads its own Chromium
 *    (~300 MB on disk). Correct for local development and CI.
 *  - `ServerlessPdfGenerator` — `puppeteer-core` driving `@sparticuz/chromium`, a
 *    Chromium build compressed for Lambda-style runtimes. Correct on Vercel.
 *
 * Why the split is not optional: a Vercel serverless function is capped at 250 MB
 * uncompressed, and full Chromium alone exceeds it, so the bundle cannot contain
 * it at any price. On top of that, `puppeteer`'s postinstall — the step that
 * fetches Chromium — is an install script, and npm now skips those unless they are
 * explicitly approved, so on Vercel the browser was never downloaded in the first
 * place. Either fact alone breaks every PDF render there.
 *
 * Both failures were SILENT: `ResumeArtifactWriter` is best-effort by design, so a
 * generation with no PDF still looked successful, and only the download surfaced
 * it — at the last step of the product. Hence the explicit selection below rather
 * than a try-puppeteer-then-fall-back chain, which would hide the same problem.
 */
export interface PdfGenerator {
  readonly available: boolean;
  generate(html: string): Promise<Uint8Array>;
}

/**
 * The résumé document is entirely self-contained — `resume-renderer.ts` emits no
 * <link>, <script>, url() or absolute URL, and its font stack is system fonts —
 * so "load" is the exact signal. `networkidle0` would wait out an extra idle
 * window for traffic that never happens, and puppeteer no longer accepts it for
 * setContent.
 */
const CONTENT_READY = { waitUntil: "load" } as const;

/** Print geometry — identical in both implementations, so output cannot drift. */
const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
} as const;

/**
 * Local/CI renderer: full `puppeteer` with its bundled Chromium.
 *
 * `puppeteer` is a devDependency, so this class is unusable in production — which
 * is the intent. The dynamic import keeps the app booting when it is absent
 * instead of failing at module load.
 */
export class PuppeteerPdfGenerator implements PdfGenerator {
  get available(): boolean {
    return true;
  }

  async generate(html: string): Promise<Uint8Array> {
    let puppeteer: typeof import("puppeteer");
    try {
      puppeteer = await import("puppeteer");
    } catch {
      throw Errors.internal(
        "La generación de PDF requiere puppeteer. Instálalo con `npm i -D puppeteer`.",
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, CONTENT_READY);
      return await page.pdf(PDF_OPTIONS);
    } finally {
      await browser.close();
    }
  }
}

/**
 * Serverless renderer: `puppeteer-core` + `@sparticuz/chromium`.
 *
 * `puppeteer-core` ships no browser, so the executable path, the sandbox flags a
 * read-only filesystem needs, and the viewport all come from `@sparticuz/chromium`.
 * The two packages are pinned to the SAME Chromium major (148) so the client is
 * never speaking a protocol the browser does not implement — a mismatch here fails
 * at render time, not at build time.
 */
export class ServerlessPdfGenerator implements PdfGenerator {
  get available(): boolean {
    return true;
  }

  async generate(html: string): Promise<Uint8Array> {
    let chromium: (typeof import("@sparticuz/chromium"))["default"];
    let puppeteer: typeof import("puppeteer-core");
    try {
      [{ default: chromium }, puppeteer] = await Promise.all([
        import("@sparticuz/chromium"),
        import("puppeteer-core"),
      ]);
    } catch {
      throw Errors.internal(
        "La generación de PDF requiere @sparticuz/chromium y puppeteer-core en este entorno.",
      );
    }

    // No WebGL is needed to lay out text, and skipping the graphics stack keeps the
    // cold start smaller — the setter is this package's documented switch for it.
    chromium.setGraphicsMode = false;

    // Launch exactly as @sparticuz/chromium 148 documents: the binary it ships is
    // the headless SHELL build, and its flags have to be merged through
    // `defaultArgs` for that mode. (Earlier versions exposed `chromium.headless`
    // and `chromium.defaultViewport`; 148 removed both — hence the literals.)
    const browser = await puppeteer.launch({
      args: puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      // A4 at 96 dpi. `page.pdf()` emulates print media, where the renderer's
      // `@media print` rule drops `.resume` to `width:auto` and the paper size
      // drives layout — so this only has to be a sane, fixed value.
      defaultViewport: { width: 794, height: 1123 },
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, CONTENT_READY);
      return await page.pdf(PDF_OPTIONS);
    } finally {
      await browser.close();
    }
  }
}

/**
 * Which renderer this process should use.
 *
 * `auto` looks for a serverless runtime rather than for `NODE_ENV=production`: a
 * self-hosted production server (a container, a VM) has a real filesystem and
 * should use the full browser, while a Vercel preview deploy runs in Lambda and
 * must not. `VERCEL` covers Vercel; `AWS_LAMBDA_FUNCTION_VERSION` covers Lambda
 * directly and is what Vercel's own runtime sets underneath.
 */
export function resolvePdfRenderer(
  mode: "auto" | "local" | "serverless",
  // A plain record, not `NodeJS.ProcessEnv`: Next's types make `NODE_ENV`
  // required there, which would force every caller to supply an irrelevant field.
  env: Record<string, string | undefined> = process.env,
): "local" | "serverless" {
  if (mode !== "auto") return mode;
  const serverless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_VERSION);
  return serverless ? "serverless" : "local";
}

let cached: PdfGenerator | null = null;

export function getPdfGenerator(): PdfGenerator {
  if (!cached) {
    cached =
      resolvePdfRenderer(getEnv().PDF_RENDERER) === "serverless"
        ? new ServerlessPdfGenerator()
        : new PuppeteerPdfGenerator();
  }
  return cached;
}

export function __setPdfGenerator(g: PdfGenerator | null): void {
  cached = g;
}
