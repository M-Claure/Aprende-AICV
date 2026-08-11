/**
 * Server-side HTML/CSS resume renderer. Produces a self-contained HTML document
 * (inline CSS, no external assets) suitable for preview and for PDF printing.
 * Styling mirrors the Pencil "Resume Preview" design.
 *
 * SECURITY: all dynamic strings are HTML-escaped — resume content comes from
 * user/AI text and must never be injected as markup.
 */
import type {
  GeneratedCertificationBlock,
  GeneratedEducationBlock,
  GeneratedExperienceBlock,
  GeneratedLanguageBlock,
  GeneratedProjectBlock,
  GeneratedSkillGroup,
} from "@/types";

export interface ResumeRenderModel {
  fullName: string;
  headline: string | null;
  location: string | null;
  contact: {
    email?: string | null;
    phone?: string | null;
    linkedIn?: string | null;
    portfolio?: string | null;
  };
  professionalSummary: string;
  skills: GeneratedSkillGroup[];
  experience: GeneratedExperienceBlock[];
  education: GeneratedEducationBlock[];
  certifications: GeneratedCertificationBlock[];
  projects: GeneratedProjectBlock[];
  languages: GeneratedLanguageBlock[];
  interests: string[];
}

export function renderResumeHtml(model: ResumeRenderModel): string {
  const contactLine = [
    model.location,
    model.contact.email,
    model.contact.phone,
    model.contact.linkedIn,
    model.contact.portfolio,
  ]
    .filter(Boolean)
    .map((v) => esc(String(v)))
    .join(" &nbsp;·&nbsp; ");

  const sections: string[] = [];

  if (model.professionalSummary.trim()) {
    sections.push(section("Resumen profesional", `<p class="summary">${esc(model.professionalSummary)}</p>`));
  }

  if (model.experience.length > 0) {
    sections.push(section("Experiencia", model.experience.map(renderExperience).join("")));
  }

  if (model.education.length > 0) {
    sections.push(section("Educación", model.education.map(renderEducation).join("")));
  }

  if (model.skills.length > 0) {
    sections.push(section("Habilidades", model.skills.map(renderSkillGroup).join("")));
  }

  if (model.projects.length > 0) {
    sections.push(section("Proyectos", model.projects.map(renderProject).join("")));
  }

  if (model.certifications.length > 0) {
    sections.push(section("Certificaciones", model.certifications.map(renderCertification).join("")));
  }

  if (model.languages.length > 0) {
    sections.push(section("Idiomas", `<ul class="inline">${model.languages.map(renderLanguage).join("")}</ul>`));
  }

  if (model.interests.length > 0) {
    sections.push(
      section("Intereses", `<ul class="inline">${model.interests.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`),
    );
  }

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(model.fullName)} — Currículum</title>
<style>${CSS}</style>
</head>
<body>
<main class="resume">
  <header class="head">
    <h1>${esc(model.fullName)}</h1>
    ${model.headline ? `<p class="headline">${esc(model.headline)}</p>` : ""}
    ${contactLine ? `<p class="contact">${contactLine}</p>` : ""}
  </header>
  ${sections.join("\n")}
</main>
</body>
</html>`;
}

// ── Block renderers ──
function renderExperience(e: GeneratedExperienceBlock): string {
  const heading = [e.title, e.organization].filter(Boolean).map((v) => esc(String(v))).join(" — ");
  return `<article class="entry">
    <div class="entry-head">
      <span class="entry-title">${heading || "Experiencia"}</span>
      <span class="entry-dates">${esc(dateRange(e.startDate, e.endDate, e.isCurrent))}</span>
    </div>
    ${e.location ? `<div class="entry-sub">${esc(e.location)}</div>` : ""}
    ${bullets(e.bullets.map((b) => b.text))}
  </article>`;
}

function renderEducation(e: GeneratedEducationBlock): string {
  const heading = [e.credential, e.fieldOfStudy].filter(Boolean).map((v) => esc(String(v))).join(" — ");
  return `<article class="entry">
    <div class="entry-head">
      <span class="entry-title">${heading || esc(e.institution ?? "Educación")}</span>
      <span class="entry-dates">${esc(dateRange(e.startDate, e.endDate, e.isCurrent))}</span>
    </div>
    ${e.institution ? `<div class="entry-sub">${esc(e.institution)}</div>` : ""}
    ${bullets(e.details.map((b) => b.text))}
  </article>`;
}

function renderProject(p: GeneratedProjectBlock): string {
  return `<article class="entry">
    <div class="entry-head"><span class="entry-title">${esc(p.name)}</span></div>
    ${bullets(p.bullets.map((b) => b.text))}
  </article>`;
}

function renderSkillGroup(g: GeneratedSkillGroup): string {
  return `<div class="skill-group">
    <span class="skill-cat">${esc(g.category)}:</span>
    <span class="skill-list">${g.skills.map((s) => esc(s)).join(", ")}</span>
  </div>`;
}

function renderCertification(c: GeneratedCertificationBlock): string {
  const meta = [c.issuingOrganization, c.issueDate].filter(Boolean).map((v) => esc(String(v))).join(" · ");
  return `<div class="cert"><span class="cert-name">${esc(c.name)}</span>${meta ? ` <span class="cert-meta">${meta}</span>` : ""}</div>`;
}

function renderLanguage(l: GeneratedLanguageBlock): string {
  return `<li>${esc(l.name)}${l.level ? ` <span class="lang-level">(${esc(l.level)})</span>` : ""}</li>`;
}

// ── helpers ──
function section(title: string, body: string): string {
  return `<section class="section"><h2>${esc(title)}</h2>${body}</section>`;
}

function bullets(items: string[]): string {
  const clean = items.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return `<ul>${clean.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function dateRange(start: string | null, end: string | null, isCurrent: boolean): string {
  const startText = start?.trim();
  const endText = isCurrent ? "Actualidad" : end?.trim();
  if (startText && endText) return `${startText} – ${endText}`;
  return endText ?? startText ?? "";
}

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
/* Black-and-white résumé. Hierarchy comes from weight, size, letter-spacing and
   rule width instead of colour, so it prints identically on any printer, survives
   photocopying and faxing, and never burns colour ink. --muted is a true grey,
   kept dark enough (7.5:1 on white) to stay legible in a scanned copy. */
:root { --accent:#000000; --ink:#000000; --muted:#4A4A4A; --line:#B8B8B8; }
* { box-sizing: border-box; }
body { margin:0; background:#F2F2F2; color:var(--ink); font-family:'Source Sans 3','Source Sans Pro',Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.resume { max-width:800px; margin:0 auto; background:#fff; padding:48px 56px; }
.head { border-bottom:2px solid var(--accent); padding-bottom:16px; margin-bottom:20px; }
.head h1 { margin:0; font-size:28px; font-weight:700; letter-spacing:-0.01em; }
.headline { margin:4px 0 0; font-size:15px; color:var(--accent); font-weight:600; }
.contact { margin:8px 0 0; font-size:12px; color:var(--muted); }
.section { margin-bottom:22px; }
.section h2 { font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--accent); border-bottom:1px solid var(--line); padding-bottom:4px; margin:0 0 10px; }
.summary { margin:0; font-size:13.5px; line-height:1.55; }
.entry { margin-bottom:14px; }
.entry-head { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
.entry-title { font-weight:600; font-size:14px; }
.entry-dates { font-size:12px; color:var(--muted); white-space:nowrap; }
.entry-sub { font-size:12.5px; color:var(--muted); margin-top:2px; }
.entry ul, .section > ul { margin:6px 0 0; padding-left:18px; }
.entry li, .section li { font-size:13px; line-height:1.5; margin-bottom:3px; }
.skill-group { font-size:13px; margin-bottom:5px; }
.skill-cat { font-weight:600; }
.cert { font-size:13px; margin-bottom:4px; }
.cert-name { font-weight:600; }
.cert-meta, .lang-level { color:var(--muted); }
ul.inline { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:6px 18px; }
ul.inline li { font-size:13px; }
@media print { body { background:#fff; } .resume { padding:0; max-width:none; } }
`;
