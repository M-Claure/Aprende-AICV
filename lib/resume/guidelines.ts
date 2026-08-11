import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads the user-editable résumé guidelines that the AI follows when generating
 * and analyzing a résumé. Read fresh on each call so edits to the file take
 * effect on the next generation without a restart. Falls back to a built-in
 * default if the file is missing/unreadable.
 *
 * Path: `resume-guidelines.md` at the project root, or $RESUME_GUIDELINES_PATH.
 * These are STYLE/FORMAT guidelines only — the factuality rules in the system
 * prompt always take precedence (no fabrication, even if the file asks for it).
 */
const DEFAULT_GUIDELINES = `Pautas de estilo (las reglas de veracidad del sistema tienen prioridad):
- Español, tono profesional, claro y conciso (idealmente 1 página).
- Resumen profesional de 2-4 frases orientado al puesto objetivo.
- Cada experiencia con 3-5 viñetas que empiezan con un verbo de acción y orientadas a resultados.
- Incluye cantidades solo si la persona las mencionó; conserva lo aproximado.
- Agrupa las habilidades por categoría; incluye idiomas con su nivel; intereses si aportan.
- No inventes ni exageres datos. No incluyas edad, foto, estado civil, religión ni datos sensibles.`;

export function getResumeGuidelines(): string {
  try {
    const path = process.env.RESUME_GUIDELINES_PATH || join(process.cwd(), "resume-guidelines.md");
    const text = readFileSync(path, "utf8").trim();
    return text.length > 0 ? text : DEFAULT_GUIDELINES;
  } catch {
    return DEFAULT_GUIDELINES;
  }
}
