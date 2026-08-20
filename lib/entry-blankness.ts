/**
 * "Is this entry completely empty?" — one definition, used by the completeness
 * engine (which blocks generation) and by the Review screen (which marks the card
 * red). Two copies would let the screen say a card is fine while the server
 * refuses to generate, or worse, the other way round.
 *
 * Why this exists: an entry can be created without content. The experience counter
 * step opens one entry per experience the person counted and the describe step
 * fills them one by one, so an abandoned count leaves an empty entry behind; the
 * Review screen's "+ Agregar" opens one directly. Nothing used to stop such an
 * entry from reaching the résumé — `hasMeaningfulBackground` counted entries by
 * array LENGTH — and it then reached the improvement loop, where it has no name for
 * a question to refer to. That is what produced «Cuéntame más sobre «<id>»».
 *
 * BLANK is deliberately strict: nothing at all was typed. An entry with a job
 * title but no description is thin, not blank — the funnel and the improvement loop
 * are there to draw that detail out, and refusing to generate over it would trap
 * someone who genuinely has little to say.
 *
 * Pure module: no I/O, no server-only imports, so a Client Component can import it.
 */

const blank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;
const empty = (v: readonly string[] | null | undefined): boolean => !v || v.length === 0;

/** An experience entry with nothing in it: no label, no description, no detail. */
export function isExperienceBlank(e: {
  title: string | null;
  organization: string | null;
  rawDescription: string | null;
  responsibilities: readonly string[];
  accomplishments: readonly string[];
  tools: readonly string[];
}): boolean {
  return (
    blank(e.title) &&
    blank(e.organization) &&
    blank(e.rawDescription) &&
    empty(e.responsibilities) &&
    empty(e.accomplishments) &&
    empty(e.tools)
  );
}

/** An education entry with nothing in it: no credential, school, field or courses. */
export function isEducationBlank(e: {
  credential: string | null;
  institution: string | null;
  fieldOfStudy: string | null;
  relevantCoursework: readonly string[];
}): boolean {
  return (
    blank(e.credential) &&
    blank(e.institution) &&
    blank(e.fieldOfStudy) &&
    empty(e.relevantCoursework)
  );
}

/** A project entry with nothing in it. */
export function isProjectBlank(p: {
  name: string;
  description: string | null;
  responsibilities: readonly string[];
  outcomes: readonly string[];
  tools: readonly string[];
}): boolean {
  return (
    blank(p.name) &&
    blank(p.description) &&
    empty(p.responsibilities) &&
    empty(p.outcomes) &&
    empty(p.tools)
  );
}
