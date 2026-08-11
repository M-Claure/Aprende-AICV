import "server-only";
import { Errors } from "@/lib/errors";

/**
 * Server-side PDF generation from rendered resume HTML.
 *
 * Uses headless Chromium via Puppeteer, imported dynamically so the app boots
 * even when Puppeteer isn't installed (e.g. a lean CI image). If it's missing,
 * export returns a clear error instead of crashing at module load.
 *
 * The interface allows swapping the implementation (e.g. an external PDF service
 * or @sparticuz/chromium on serverless) without touching callers.
 */
export interface PdfGenerator {
  readonly available: boolean;
  generate(html: string): Promise<Uint8Array>;
}

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
        "La generación de PDF requiere puppeteer. Instálalo con `npm i puppeteer`.",
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      });
      return pdf;
    } finally {
      await browser.close();
    }
  }
}

let cached: PdfGenerator | null = null;
export function getPdfGenerator(): PdfGenerator {
  if (!cached) cached = new PuppeteerPdfGenerator();
  return cached;
}

export function __setPdfGenerator(g: PdfGenerator | null): void {
  cached = g;
}
