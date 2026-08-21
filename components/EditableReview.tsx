"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CompletenessReport,
  EducationEntryState,
  ExperienceEntryState,
  PersonalInformation,
  ResumeProfile,
  SkillState,
} from "@/types";
import { api } from "@/lib/client/api";
import {
  CAREER_GOAL_CHAR_LIMIT,
  ENTRY_TEXT_CHAR_LIMIT,
  REVIEW_FIELD_CHAR_LIMITS as LIMITS,
  TARGET_ROLE_CHAR_LIMIT,
} from "@/lib/answer-limits";
import {
  MAX_EDUCATION_ENTRIES,
  MAX_EXPERIENCE_ENTRIES,
  MAX_RESUME_ITERATIONS,
} from "@/lib/config/limits";
import { isEducationBlank, isExperienceBlank } from "@/lib/entry-blankness";
import {
  MONTH_OPTIONS,
  formatExperienceDate,
  parseExperienceDate,
  yearOptions,
} from "@/lib/experience-dates";
import { EXPERIENCE_TYPE_OPTIONS, labelForType } from "@/lib/experience-types";
import { Button, Card, InstructionBanner, Spinner } from "./primitives";

interface ProfileData {
  profile: ResumeProfile;
  personalInformation: PersonalInformation | null;
  state: {
    education: EducationEntryState[];
    experience: ExperienceEntryState[];
    confirmedSkills: SkillState[];
    interests: string[];
    completeness: CompletenessReport;
  };
}

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-accent";

/**
 * The review/summary screen. Shows everything the user typed and lets them edit
 * it (objective, personal info, education, experience, skills) before generating.
 */
export function EditableReview({
  profileId,
  onGenerate,
  onBack,
  busy,
  generateLabel = "Generar mi currículum",
  backLabel = "Volver a las preguntas",
  explainNext = false,
}: {
  profileId: string;
  onGenerate: () => void;
  onBack?: () => void;
  busy: boolean;
  generateLabel?: string;
  backLabel?: string;
  /** When true, explain what happens after generating (the improvement loop and
   * its hard cap). Shown on the pre-generation review step, not on later edits. */
  explainNext?: boolean;
}) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const d = (await api.getProfile(profileId)) as unknown as ProfileData;
    setData(d);
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const withSave = useCallback(
    async (fn: () => Promise<unknown>) => {
      setSaving(true);
      try {
        await fn();
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  if (!data) {
    return (
      <Card>
        <Spinner label="Cargando tu información…" />
      </Card>
    );
  }

  const { profile, personalInformation, state } = data;
  const c = state.completeness;

  return (
    <div className="flex flex-col gap-4">
      <InstructionBanner icon="✅" title="Revisa tu información">
        Lee lo que escribiste abajo. Cambia o borra lo que quieras. Aprieta &quot;Guardar&quot; en cada
        parte que cambies. Cuando esté bien, aprieta el botón grande de abajo.
      </InstructionBanner>

      {/* Objetivo */}
      <ObjectiveEditor
        key={`obj-${profile.updatedAt}`}
        profile={profile}
        disabled={saving}
        onSave={(body) => withSave(() => api.updateProfile(profileId, body))}
      />

      {/* Información personal */}
      <PersonalEditor
        key={`pers-${personalInformation?.email ?? ""}-${personalInformation?.firstName ?? ""}`}
        info={personalInformation}
        disabled={saving}
        onSave={(body) => withSave(() => api.updatePersonalInfo(profileId, body))}
      />

      {/* Educación */}
      <Section
        title="Educación"
        addDisabled={saving || state.education.length >= MAX_EDUCATION_ENTRIES}
        hint={
          state.education.length >= MAX_EDUCATION_ENTRIES
            ? `Puedes tener ${MAX_EDUCATION_ENTRIES} estudios. Es el máximo. Borra uno si quieres agregar otro.`
            : undefined
        }
        // Deliberately EMPTY, not a "Nueva formación" placeholder: a placeholder
        // reads as filled in — to the résumé generator too — while an empty card is
        // flagged red and blocks generating until it is filled or deleted.
        onAdd={() => withSave(() => api.addEducation(profileId, {}))}
      >
        {state.education.length === 0 && <Empty />}
        {state.education.map((e) => (
          <EducationCard
            key={e.id}
            entry={e}
            disabled={saving}
            blank={isEducationBlank(e)}
            onSave={(body) => withSave(() => api.updateEducation(e.id, body))}
            onDelete={() => withSave(() => api.deleteEducation(e.id))}
          />
        ))}
      </Section>

      {/* Experiencia */}
      <Section
        title="Experiencia"
        addDisabled={saving || state.experience.length >= MAX_EXPERIENCE_ENTRIES}
        hint={
          state.experience.length >= MAX_EXPERIENCE_ENTRIES
            ? `Puedes tener ${MAX_EXPERIENCE_ENTRIES} experiencias. Es el máximo. Borra una si quieres agregar otra.`
            : undefined
        }
        // Empty, for the same reason as education above: "Nueva experiencia" would
        // travel into the résumé as if the person had written it.
        onAdd={() => withSave(() => api.addExperience(profileId, { experienceType: "other" }))}
      >
        {state.experience.length === 0 && <Empty />}
        {state.experience.map((e) => (
          <ExperienceCard
            key={e.id}
            entry={e}
            disabled={saving}
            blank={isExperienceBlank(e)}
            onSave={(body) => withSave(() => api.updateExperience(e.id, body))}
            onDelete={() => withSave(() => api.deleteExperience(e.id))}
          />
        ))}
      </Section>

      {/* Habilidades */}
      <SkillsEditor
        key={`skills-${state.confirmedSkills.length}`}
        skills={state.confirmedSkills}
        disabled={saving}
        onAdd={(names) => withSave(() => api.addSkills(profileId, names))}
        onRemove={(id) => withSave(() => api.rejectSkill(id))}
      />

      {/* Intereses */}
      <InterestsEditor
        key={`interests-${state.interests.length}`}
        interests={state.interests}
        disabled={saving}
        onChange={(list) => withSave(() => api.setInterests(profileId, list))}
      />

      {c.missingCriticalFields.length > 0 && (
        <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700">
          <p className="font-semibold">Para generar tu currículum aún falta:</p>
          <ul className="mt-1 list-disc pl-4">
            {c.missingCriticalFields.map((f) => (
              <li key={f.field}>{f.label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 border-t border-border bg-bg-primary py-3">
        {explainNext && (
          <div className="mb-3 rounded-xl bg-accent-light px-4 py-3 text-sm leading-snug text-text-primary">
            <p className="font-semibold">¿Qué pasa cuando aprietes el botón?</p>
            <ol className="mt-1 list-decimal pl-5">
              <li>Creamos tu currículum con lo que escribiste.</li>
              <li>
                Te damos ideas para mejorarlo. Puedes mejorarlo{" "}
                <strong>hasta {MAX_RESUME_ITERATIONS} veces</strong> (no más).
              </li>
              <li>Al final lo revisas y lo descargas.</li>
            </ol>
          </div>
        )}
        <div className="flex items-center justify-between">
          {onBack ? (
            <Button variant="text" onClick={onBack} disabled={busy || saving}>
              {backLabel}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onGenerate} disabled={busy || saving || !c.readyToGenerate}>
            {generateLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Section shell ──
function Section({
  title,
  onAdd,
  addDisabled = false,
  hint,
  children,
}: {
  title: string;
  onAdd: () => void;
  /** Blocks "+ Agregar" (e.g. the experience cap is reached). */
  addDisabled?: boolean;
  /** Short Spanish explanation shown when adding is blocked. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="text-xs font-semibold text-accent-dark hover:underline disabled:text-text-secondary disabled:no-underline disabled:opacity-50"
        >
          + Agregar
        </button>
      </div>
      {hint && <p className="mb-2 text-xs text-text-secondary">{hint}</p>}
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}

function Empty() {
  return <p className="text-xs text-text-secondary">Aún no hay entradas.</p>;
}

/**
 * The field caption, with the red asterisk when the field is required. Shared with
 * `MonthYearField`, which wraps two selects and so cannot use `Labeled`'s single
 * <label> — the asterisk must look identical in both.
 */
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="mb-1 block text-xs text-text-secondary">
      {label}
      {required && (
        <>
          <span className="font-bold text-red-600" aria-hidden>
            {" *"}
          </span>
          <span className="sr-only"> (obligatorio)</span>
        </>
      )}
    </span>
  );
}

/** Red, one-line "you still have to fill this in" note under a required field. */
function MissingNote({ text = "Falta llenar esto." }: { text?: string }) {
  return <span className="mt-0.5 block text-[11px] font-semibold text-red-600">{text}</span>;
}

function Labeled({
  label,
  required,
  children,
}: {
  label: string;
  /**
   * Renders the red asterisk. Use it only where the field really blocks something:
   * generating (personal info, education) or saving the card (every experience field).
   */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      {children}
    </label>
  );
}

/*
 * ── Character limits on this screen ──────────────────────────────────────────
 *
 * Every editable field carries a live "used / limit" counter. Two deliberate
 * choices, both matching the funnel's QuestionCard so the screens behave alike:
 *
 *  1. The limit comes from `REVIEW_FIELD_CHAR_LIMITS`, which the request schemas
 *     read too — so the number under the field is the number the API enforces,
 *     and cannot drift away from it.
 *  2. Fields are NOT hard-capped with `maxLength`. Pasted text is kept in full,
 *     shown in red, and Guardar is disabled until it fits — silently truncating
 *     what someone wrote is worse than telling them it is too long.
 */

/** Live "used / limit" readout; turns amber near the limit and red past it. */
function CharCount({ used, limit }: { used: number; limit: number }) {
  const over = used > limit;
  const near = !over && used >= Math.floor(limit * 0.9);
  return (
    <span
      className={`mt-0.5 block text-right text-[11px] tabular-nums ${
        over ? "font-semibold text-red-600" : near ? "text-amber-700" : "text-text-secondary"
      }`}
      aria-live="polite"
    >
      {over ? `${used} / ${limit} — quita ${used - limit}` : `${used} / ${limit}`}
    </span>
  );
}

/** True when any [value, limit] pair is over — used to block Guardar. */
function overAny(...pairs: Array<[string, number]>): boolean {
  return pairs.some(([value, limit]) => value.length > limit);
}

function CountedInput({
  label,
  value,
  limit,
  onChange,
  required,
  missing,
}: {
  label: string;
  value: string;
  limit: number;
  onChange: (v: string) => void;
  /** Show the red asterisk: this field gates generating, or saving its card. */
  required?: boolean;
  /**
   * Show the unfilled state. Separate from `required` on purpose: "correo o
   * teléfono" is two asterisked fields where filling EITHER is enough, so the red
   * outline may only appear when both are empty. Marking each one red as soon as it
   * is empty would be telling the person something untrue.
   */
  missing?: boolean;
}) {
  const over = value.length > limit;
  const flagged = over || missing;
  return (
    <Labeled label={label} required={required}>
      <input
        className={flagged ? `${inputClass} border-red-500 focus:border-red-500` : inputClass}
        aria-invalid={flagged}
        aria-required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {missing && !over && <MissingNote />}
      <CharCount used={value.length} limit={limit} />
    </Labeled>
  );
}

/**
 * Month + year dropdowns for one experience date.
 *
 * Dropdowns rather than a text box: nobody has to guess a format, and the value
 * they produce is exactly what the résumé's chronological sort parses. The month
 * stays OPTIONAL even when the field is required — plenty of people remember the
 * year but not the month, and a bare year still orders correctly — so `missing`
 * flags the YEAR only, and the asterisk is satisfied by a year alone.
 */
function MonthYearField({
  label,
  month,
  year,
  disabled = false,
  required,
  missing,
  onChange,
}: {
  label: string;
  month: string;
  year: string;
  disabled?: boolean;
  /** Show the red asterisk: this date gates saving the card. */
  required?: boolean;
  /** No year chosen yet: outline the year select and say what is missing. */
  missing?: boolean;
  onChange: (month: string, year: string) => void;
}) {
  const years = yearOptions(new Date().getFullYear());
  // A stored year older than the dropdown's reach must still round-trip instead of
  // silently blanking (and being wiped on the next save).
  const options = year && !years.includes(year) ? [year, ...years] : years;
  const selectClass = disabled ? `${inputClass} opacity-50` : inputClass;
  const yearClass = missing ? `${selectClass} border-red-500 focus:border-red-500` : selectClass;
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <div className="flex gap-2">
        <select
          className={selectClass}
          value={month}
          disabled={disabled}
          aria-label={`${label}: mes`}
          onChange={(e) => onChange(e.target.value, year)}
        >
          <option value="">Mes</option>
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className={yearClass}
          value={year}
          disabled={disabled}
          aria-invalid={missing}
          aria-required={required}
          aria-label={`${label}: año`}
          onChange={(e) => onChange(month, e.target.value)}
        >
          <option value="">Año</option>
          {options.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {missing && <MissingNote text="Falta elegir el año." />}
    </div>
  );
}

function CountedTextarea({
  label,
  value,
  limit,
  rows = 2,
  placeholder,
  onChange,
  required,
  missing,
}: {
  label: string;
  value: string;
  limit: number;
  rows?: number;
  placeholder?: string;
  onChange: (v: string) => void;
  /** Show the red asterisk: this field gates saving its card. */
  required?: boolean;
  /** Nothing typed yet: outline it and say so. */
  missing?: boolean;
}) {
  const over = value.length > limit;
  const flagged = over || missing;
  return (
    <Labeled label={label} required={required}>
      <textarea
        className={flagged ? `${inputClass} border-red-500 focus:border-red-500` : inputClass}
        aria-invalid={flagged}
        aria-required={required}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {missing && !over && <MissingNote />}
      <CharCount used={value.length} limit={limit} />
    </Labeled>
  );
}

// ── Objetivo ──
function ObjectiveEditor({
  profile,
  onSave,
  disabled,
}: {
  profile: ResumeProfile;
  onSave: (b: { targetRole?: string | null; careerGoal?: string | null }) => void;
  disabled: boolean;
}) {
  const [targetRole, setTargetRole] = useState(profile.targetRole ?? "");
  // Profiles captured before the funnel stopped writing one answer into both
  // fields still hold the job title in `careerGoal` too. Showing it there is
  // noise — an exact copy of the field above says nothing new — so the box starts
  // empty and invites a real description. Anything genuinely different (the
  // "no estoy segura" narrative answer) is shown as captured.
  const duplicatedFromRole =
    !!profile.careerGoal && profile.careerGoal.trim() === (profile.targetRole ?? "").trim();
  const [careerGoal, setCareerGoal] = useState(
    duplicatedFromRole ? "" : (profile.careerGoal ?? ""),
  );
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Objetivo profesional</h3>
      <div className="flex flex-col gap-2">
        <CountedInput
          label="Puesto deseado"
          value={targetRole}
          limit={TARGET_ROLE_CHAR_LIMIT}
          onChange={setTargetRole}
          required
          // Either field satisfies "objetivo", so this only turns red when both are empty.
          missing={targetRole.trim() === "" && careerGoal.trim() === ""}
        />
        <CountedTextarea
          label="Objetivo (opcional)"
          value={careerGoal}
          limit={CAREER_GOAL_CHAR_LIMIT}
          placeholder="Si quieres, escribe en una frase qué buscas. Puedes dejarlo vacío."
          onChange={setCareerGoal}
        />
        <SaveRow
          disabled={disabled}
          blocked={overAny([targetRole, TARGET_ROLE_CHAR_LIMIT], [careerGoal, CAREER_GOAL_CHAR_LIMIT])}
          onSave={() => onSave({ targetRole, careerGoal })}
        />
      </div>
    </Card>
  );
}

// ── Personal ──
function PersonalEditor({
  info,
  onSave,
  disabled,
}: {
  info: PersonalInformation | null;
  onSave: (b: Record<string, string | null>) => void;
  disabled: boolean;
}) {
  const [v, setV] = useState({
    firstName: info?.firstName ?? "",
    lastName: info?.lastName ?? "",
    email: info?.email ?? "",
    phone: info?.phone ?? "",
    city: info?.city ?? "",
    country: info?.country ?? "",
  });
  const set = (k: keyof typeof v) => (value: string) => setV({ ...v, [k]: value });
  const noContact = v.email.trim() === "" && v.phone.trim() === "";
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Información personal</h3>
      <div className="grid grid-cols-2 gap-2">
        <CountedInput
          label="Nombre"
          value={v.firstName}
          limit={LIMITS.firstName}
          onChange={set("firstName")}
          required
          missing={v.firstName.trim() === ""}
        />
        <CountedInput label="Apellidos" value={v.lastName} limit={LIMITS.lastName} onChange={set("lastName")} />
        {/* One contact channel is enough, so both carry the asterisk and neither
            turns red until both are empty. */}
        <CountedInput
          label="Correo"
          value={v.email}
          limit={LIMITS.email}
          onChange={set("email")}
          required
          missing={noContact}
        />
        <CountedInput
          label="Teléfono"
          value={v.phone}
          limit={LIMITS.phone}
          onChange={set("phone")}
          required
          missing={noContact}
        />
        <CountedInput label="Ciudad" value={v.city} limit={LIMITS.city} onChange={set("city")} />
        <CountedInput label="País" value={v.country} limit={LIMITS.country} onChange={set("country")} />
      </div>
      <div className="mt-2">
        <SaveRow
          disabled={disabled}
          blocked={overAny(
            [v.firstName, LIMITS.firstName],
            [v.lastName, LIMITS.lastName],
            [v.email, LIMITS.email],
            [v.phone, LIMITS.phone],
            [v.city, LIMITS.city],
            [v.country, LIMITS.country],
          )}
          onSave={() => onSave(v)}
        />
      </div>
    </Card>
  );
}

// ── Education card ──
function EducationCard({
  entry,
  onSave,
  onDelete,
  disabled,
  blank,
}: {
  entry: EducationEntryState;
  onSave: (b: Record<string, unknown>) => void;
  onDelete: () => void;
  disabled: boolean;
  /** Nothing typed yet: outlined in red, and generating is blocked until it is
   *  filled in or deleted. See `lib/entry-blankness.ts`. */
  blank?: boolean;
}) {
  const [v, setV] = useState({
    institution: entry.institution ?? "",
    credential: entry.credential ?? "",
    fieldOfStudy: entry.fieldOfStudy ?? "",
    endDate: entry.endDate ?? "",
  });
  const set = (k: keyof typeof v) => (value: string) => setV({ ...v, [k]: value });
  /*
   * Every field on this card is required — the asterisks say so, and Guardar stays
   * blocked until each one is filled. Same rule as `ExperienceCard`, and the same
   * limit: it gates SAVING THIS CARD, not generating the résumé, which is still the
   * completeness engine's server-side call (`readyToGenerate`).
   */
  const missing = {
    institution: v.institution.trim() === "",
    credential: v.credential.trim() === "",
    fieldOfStudy: v.fieldOfStudy.trim() === "",
    endDate: v.endDate.trim() === "",
  };
  const incomplete = Object.values(missing).some(Boolean);
  const tooLong = overAny(
    [v.institution, LIMITS.institution],
    [v.credential, LIMITS.credential],
    [v.fieldOfStudy, LIMITS.fieldOfStudy],
    [v.endDate, LIMITS.date],
  );
  return (
    <div className={blank ? blankCardClass : "rounded-lg border border-border p-3"}>
      {blank && <BlankCardNotice thing="estudio" />}
      <div className="grid grid-cols-2 gap-2">
        <CountedInput
          label="Institución"
          value={v.institution}
          limit={LIMITS.institution}
          onChange={set("institution")}
          required
          missing={missing.institution}
        />
        <CountedInput
          label="Título / nivel"
          value={v.credential}
          limit={LIMITS.credential}
          onChange={set("credential")}
          required
          missing={missing.credential}
        />
        <CountedInput
          label="Área de estudio"
          value={v.fieldOfStudy}
          limit={LIMITS.fieldOfStudy}
          onChange={set("fieldOfStudy")}
          required
          missing={missing.fieldOfStudy}
        />
        <CountedInput
          label="Año de fin"
          value={v.endDate}
          limit={LIMITS.date}
          onChange={set("endDate")}
          required
          missing={missing.endDate}
        />
      </div>
      <SaveRow
        disabled={disabled}
        blocked={tooLong || incomplete}
        blockedMessage={
          // Length wins the message: it is the one that needs an edit, not a fill-in.
          tooLong ? undefined : "Llena todo lo que tiene * para poder guardar."
        }
        onSave={() => onSave(v)}
        onDelete={onDelete}
      />
    </div>
  );
}

/** A blank card is outlined in red — it is the thing blocking "Generar". */
const blankCardClass = "rounded-lg border-2 border-red-500 bg-red-50/40 p-3";

function BlankCardNotice({ thing }: { thing: string }) {
  return (
    <p className="mb-2 text-xs font-semibold text-red-600">
      Esta tarjeta está vacía. Escribe tu {thing} o bórrala para poder crear tu currículum.
    </p>
  );
}

// ── Experience card ──
function ExperienceCard({
  entry,
  onSave,
  onDelete,
  disabled,
  blank,
}: {
  entry: ExperienceEntryState;
  onSave: (b: Record<string, unknown>) => void;
  onDelete: () => void;
  disabled: boolean;
  /** Nothing typed yet: outlined in red, and generating is blocked until it is
   *  filled in or deleted. See `lib/entry-blankness.ts`. */
  blank?: boolean;
}) {
  const start = parseExperienceDate(entry.startDate);
  const end = parseExperienceDate(entry.endDate);
  const [v, setV] = useState({
    title: entry.title ?? "",
    organization: entry.organization ?? "",
    rawDescription: entry.rawDescription ?? entry.responsibilities.join(", ") ?? "",
    // The funnel no longer lets a description overwrite the type chosen with the
    // counter's +/− buttons, so this is where a mis-selection gets corrected.
    experienceType: entry.experienceType,
    // Dates drive the résumé's newest-first ordering. Stored as free text, edited
    // here as month + year so nobody has to guess a format — see lib/experience-dates.
    startMonth: start.month,
    startYear: start.year,
    endMonth: end.month,
    endYear: end.year,
    isCurrent: entry.isCurrent,
  });
  /*
   * Every field on this card is required — the asterisks say so, and Guardar stays
   * blocked until each one is filled. Two deliberate exceptions:
   *
   *  - the end date is not asked for when "Sigo en esta experiencia" is checked, since
   *    that checkbox IS the answer (and checking it clears the date);
   *  - a date needs only its YEAR, not the month (see `MonthYearField`).
   *
   * This gates SAVING THIS CARD only. Whether the résumé can be generated is still the
   * completeness engine's call (`readyToGenerate`), which is server-side and unchanged.
   */
  const missing = {
    title: v.title.trim() === "",
    organization: v.organization.trim() === "",
    startDate: v.startYear.trim() === "",
    endDate: !v.isCurrent && v.endYear.trim() === "",
    rawDescription: v.rawDescription.trim() === "",
  };
  const incomplete = Object.values(missing).some(Boolean);
  const tooLong = overAny(
    [v.title, LIMITS.title],
    [v.organization, LIMITS.organization],
    [v.rawDescription, ENTRY_TEXT_CHAR_LIMIT],
  );
  return (
    <div className={blank ? blankCardClass : "rounded-lg border border-border p-3"}>
      {blank && <BlankCardNotice thing="experiencia" />}
      <div className="grid grid-cols-2 gap-2">
        <CountedInput
          label="Puesto / rol"
          value={v.title}
          limit={LIMITS.title}
          onChange={(title) => setV({ ...v, title })}
          required
          missing={missing.title}
        />
        <CountedInput
          label="Organización"
          value={v.organization}
          limit={LIMITS.organization}
          onChange={(organization) => setV({ ...v, organization })}
          required
          missing={missing.organization}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MonthYearField
          label="Empezó en"
          month={v.startMonth}
          year={v.startYear}
          required
          missing={missing.startDate}
          onChange={(startMonth, startYear) => setV({ ...v, startMonth, startYear })}
        />
        <MonthYearField
          label={v.isCurrent ? "Terminó en (sigues aquí)" : "Terminó en"}
          month={v.endMonth}
          year={v.endYear}
          disabled={v.isCurrent}
          required={!v.isCurrent}
          missing={missing.endDate}
          onChange={(endMonth, endYear) => setV({ ...v, endMonth, endYear })}
        />
      </div>
      <label className="mt-1 flex items-center gap-2 text-xs text-text-primary">
        <input
          type="checkbox"
          checked={v.isCurrent}
          onChange={(e) =>
            // Checking it clears the end date: an ongoing experience has no end,
            // and the résumé prints "Actualidad" there instead.
            setV(
              e.target.checked
                ? { ...v, isCurrent: true, endMonth: "", endYear: "" }
                : { ...v, isCurrent: false },
            )
          }
        />
        Sigo en esta experiencia
      </label>
      <div className="mt-2">
        {/* Required too, but a select always holds a value (an entry created from
            "+ Agregar" starts on "other"), so the asterisk can never be unmet. */}
        <Labeled label="Tipo de experiencia" required>
          <select
            className={inputClass}
            value={v.experienceType}
            onChange={(e) =>
              setV({ ...v, experienceType: e.target.value as ExperienceEntryState["experienceType"] })
            }
          >
            {EXPERIENCE_TYPE_OPTIONS.map(({ type, label }) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
            {/* Types the counter doesn't offer still need to round-trip rather
                than being silently rewritten to whatever option renders first. */}
            {!EXPERIENCE_TYPE_OPTIONS.some((o) => o.type === v.experienceType) && (
              <option value={v.experienceType}>{labelForType(v.experienceType)}</option>
            )}
          </select>
        </Labeled>
      </div>
      <div className="mt-2">
        <CountedTextarea
          label="¿Qué hacías?"
          value={v.rawDescription}
          limit={ENTRY_TEXT_CHAR_LIMIT}
          rows={3}
          onChange={(rawDescription) => setV({ ...v, rawDescription })}
          required
          missing={missing.rawDescription}
        />
      </div>
      <SaveRow
        disabled={disabled}
        blocked={tooLong || incomplete}
        blockedMessage={
          // Length wins the message: it is the one that needs an edit, not a fill-in.
          tooLong ? undefined : "Llena todo lo que tiene * para poder guardar."
        }
        onSave={() =>
          // Send exactly the fields the API takes: the month/year pairs are UI
          // state and get folded back into the stored free-text dates here.
          onSave({
            title: v.title,
            organization: v.organization,
            rawDescription: v.rawDescription,
            experienceType: v.experienceType,
            startDate: formatExperienceDate(v.startMonth, v.startYear),
            endDate: v.isCurrent ? "" : formatExperienceDate(v.endMonth, v.endYear),
            isCurrent: v.isCurrent,
          })
        }
        onDelete={onDelete}
      />
    </div>
  );
}

// ── Skills ──
function SkillsEditor({
  skills,
  onAdd,
  onRemove,
  disabled,
}: {
  skills: SkillState[];
  onAdd: (names: string[]) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  // A comma-separated box has no single character limit — the cap is per skill.
  // So the feedback is per item too, rather than a counter that would misstate it.
  const parsed = text.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 1);
  const tooLong = parsed.filter((s) => s.length > LIMITS.skillName);
  const add = () => {
    if (parsed.length > 0 && tooLong.length === 0) {
      onAdd(parsed);
      setText("");
    }
  };
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Habilidades confirmadas</h3>
      {skills.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-full bg-accent-light px-3 py-1 text-xs text-accent-dark">
              {s.name}
              <button type="button" onClick={() => onRemove(s.id)} disabled={disabled} className="font-bold">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={
            tooLong.length > 0 ? `${inputClass} border-red-500 focus:border-red-500` : inputClass
          }
          aria-invalid={tooLong.length > 0}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Agregar habilidades (separadas por comas)"
        />
        <Button variant="secondary" onClick={add} disabled={disabled || tooLong.length > 0}>
          Agregar
        </Button>
      </div>
      <p
        className={`mt-1 text-xs ${tooLong.length > 0 ? "font-semibold text-red-600" : "text-text-secondary"}`}
        aria-live="polite"
      >
        {tooLong.length > 0
          ? `Una habilidad pasa de ${LIMITS.skillName} letras (${tooLong[0]!.length}). Acórtala para agregarla.`
          : `Sepáralas con comas. Cada una hasta ${LIMITS.skillName} letras.`}
      </p>
    </Card>
  );
}

// ── Interests ──
function InterestsEditor({
  interests,
  onChange,
  disabled,
}: {
  interests: string[];
  onChange: (list: string[]) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  // Per-item cap, same reasoning as the skills box above.
  const parsed = text.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const tooLong = parsed.filter((s) => s.length > LIMITS.interest);
  const add = () => {
    if (parsed.length > 0 && tooLong.length === 0) {
      onChange([...interests, ...parsed]);
      setText("");
    }
  };
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Intereses</h3>
      {interests.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-wrap gap-2">
          {interests.map((name, i) => (
            <span key={`${name}-${i}`} className="flex items-center gap-1 rounded-full bg-accent-light px-3 py-1 text-xs text-accent-dark">
              {name}
              <button
                type="button"
                onClick={() => onChange(interests.filter((_, idx) => idx !== i))}
                disabled={disabled}
                className="font-bold"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          className={
            tooLong.length > 0 ? `${inputClass} border-red-500 focus:border-red-500` : inputClass
          }
          aria-invalid={tooLong.length > 0}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Agregar intereses (separados por comas)"
        />
        <Button variant="secondary" onClick={add} disabled={disabled || tooLong.length > 0}>
          Agregar
        </Button>
      </div>
      <p
        className={`mt-1 text-xs ${tooLong.length > 0 ? "font-semibold text-red-600" : "text-text-secondary"}`}
        aria-live="polite"
      >
        {tooLong.length > 0
          ? `Un interés pasa de ${LIMITS.interest} letras (${tooLong[0]!.length}). Acórtalo para agregarlo.`
          : `Sepáralos con comas. Cada uno hasta ${LIMITS.interest} letras.`}
      </p>
    </Card>
  );
}

function SaveRow({
  onSave,
  onDelete,
  disabled,
  blocked = false,
  blockedMessage,
}: {
  onSave: () => void;
  onDelete?: () => void;
  disabled: boolean;
  /**
   * Saving cannot go through: a field is over its limit (letting the API 422 instead
   * would be worse), or a required field is still empty.
   */
  blocked?: boolean;
  /** Why, in Spanish. Defaults to the over-the-limit case. */
  blockedMessage?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
      {blocked && (
        <span className="mr-auto text-xs font-semibold text-red-600">
          {blockedMessage ?? "Acorta lo que está marcado en rojo para poder guardar."}
        </span>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} disabled={disabled} className="text-xs text-red-600 hover:underline">
          Eliminar
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || blocked}
        className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-on disabled:opacity-50"
      >
        Guardar
      </button>
    </div>
  );
}
