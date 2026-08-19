import type { Store } from "@/lib/repositories/store";

/**
 * Binary artifact storage for résumé PDFs.
 *
 * Kept behind an interface for the same reason `Store` and `AIProvider` are:
 * domain code depends on the shape, not on Supabase. `MemoryResumeFileStore`
 * lets the whole save-on-generate path be unit-tested with no network.
 *
 * ## One PDF per profile
 * The path is derived from the profile, not from the résumé *version*, and every
 * write replaces what was there. A profile therefore holds exactly one PDF — the
 * render of its most recent generation — so storage cannot grow without bound as
 * a user iterates, and "download" can never hand back a stale version.
 *
 * The trade-off is that older `generated_resumes` rows are not individually
 * downloadable. That is deliberate: nothing in the product offers version history,
 * and keeping a PDF per version would multiply PII at rest for no user-facing gain.
 */
export interface ResumeFileStore {
  /**
   * Write the profile's PDF, replacing any previous one. Returns the stored
   * object path, which is what gets recorded on `generated_resumes.pdfPath`.
   */
  putResumePdf(input: ResumePdfRef & { pdf: Uint8Array }): Promise<string>;
  /** Read the stored PDF back, or `null` when nothing is stored. */
  getResumePdf(input: ResumePdfRef): Promise<Uint8Array | null>;
  /** Remove it. Succeeds whether or not anything was there. */
  deleteResumePdf(input: ResumePdfRef): Promise<void>;
}

/** Identifies whose PDF, and for which profile. */
export interface ResumePdfRef {
  userId: string;
  profileId: string;
}

/**
 * Object path for a profile's PDF.
 *
 * The **user id must stay the first segment**: the Supabase Storage RLS policies
 * in `supabase/migrations/0006_resume_pdf_storage.sql` authorize on
 * `(storage.foldername(name))[1] = auth.uid()`, so changing this layout silently
 * changes who can read the file. Covered by `tests/unit/resume-pdf-storage.test.ts`.
 */
export function resumePdfPath({ userId, profileId }: ResumePdfRef): string {
  return `${userId}/${profileId}/curriculum.pdf`;
}

/** The bucket these objects live in. Private — reads go through the API. */
export const RESUME_BUCKET = "resumes";

/**
 * In-process implementation for tests and memory-mode dev. Replacement semantics
 * match the Supabase one: writing the same path overwrites.
 */
export class MemoryResumeFileStore implements ResumeFileStore {
  private readonly files = new Map<string, Uint8Array>();

  async putResumePdf({ pdf, ...ref }: ResumePdfRef & { pdf: Uint8Array }): Promise<string> {
    const path = resumePdfPath(ref);
    // Copy: the caller owns the buffer it passed and may reuse it.
    this.files.set(path, Uint8Array.from(pdf));
    return path;
  }

  async getResumePdf(ref: ResumePdfRef): Promise<Uint8Array | null> {
    const found = this.files.get(resumePdfPath(ref));
    return found ? Uint8Array.from(found) : null;
  }

  async deleteResumePdf(ref: ResumePdfRef): Promise<void> {
    this.files.delete(resumePdfPath(ref));
  }

  /** Test helper: how many distinct objects are stored. */
  get size(): number {
    return this.files.size;
  }
}

/** Narrow slice of `Store` the artifact writer needs — keeps its deps honest. */
export type ResumeRowUpdater = Pick<Store, "updateGeneratedResume">;
