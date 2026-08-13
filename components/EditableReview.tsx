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
  TARGET_ROLE_CHAR_LIMIT,
} from "@/lib/answer-limits";
import { MAX_EXPERIENCE_ENTRIES, MAX_RESUME_ITERATIONS } from "@/lib/config/limits";
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
        onAdd={() => withSave(() => api.addEducation(profileId, { credential: "Nueva formación" }))}
      >
        {state.education.length === 0 && <Empty />}
        {state.education.map((e) => (
          <EducationCard
            key={e.id}
            entry={e}
            disabled={saving}
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
        onAdd={() =>
          withSave(() => api.addExperience(profileId, { experienceType: "other", rawDescription: "Nueva experiencia" }))
        }
      >
        {state.experience.length === 0 && <Empty />}
        {state.experience.map((e) => (
          <ExperienceCard
            key={e.id}
            entry={e}
            disabled={saving}
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

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-text-secondary">{label}</span>
      {children}
    </label>
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
  const [careerGoal, setCareerGoal] = useState(profile.careerGoal ?? "");
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Objetivo profesional</h3>
      <div className="flex flex-col gap-2">
        <Labeled label="Puesto deseado">
          <input
            className={inputClass}
            maxLength={TARGET_ROLE_CHAR_LIMIT}
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
          />
        </Labeled>
        <Labeled label="Objetivo (descripción)">
          <textarea
            className={inputClass}
            rows={2}
            maxLength={CAREER_GOAL_CHAR_LIMIT}
            value={careerGoal}
            onChange={(e) => setCareerGoal(e.target.value)}
          />
        </Labeled>
        <SaveRow disabled={disabled} onSave={() => onSave({ targetRole, careerGoal })} />
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
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold">Información personal</h3>
      <div className="grid grid-cols-2 gap-2">
        <Labeled label="Nombre"><input className={inputClass} value={v.firstName} onChange={set("firstName")} /></Labeled>
        <Labeled label="Apellidos"><input className={inputClass} value={v.lastName} onChange={set("lastName")} /></Labeled>
        <Labeled label="Correo"><input className={inputClass} value={v.email} onChange={set("email")} /></Labeled>
        <Labeled label="Teléfono"><input className={inputClass} value={v.phone} onChange={set("phone")} /></Labeled>
        <Labeled label="Ciudad"><input className={inputClass} value={v.city} onChange={set("city")} /></Labeled>
        <Labeled label="País"><input className={inputClass} value={v.country} onChange={set("country")} /></Labeled>
      </div>
      <div className="mt-2">
        <SaveRow disabled={disabled} onSave={() => onSave(v)} />
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
}: {
  entry: EducationEntryState;
  onSave: (b: Record<string, unknown>) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [v, setV] = useState({
    institution: entry.institution ?? "",
    credential: entry.credential ?? "",
    fieldOfStudy: entry.fieldOfStudy ?? "",
    endDate: entry.endDate ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Labeled label="Institución"><input className={inputClass} value={v.institution} onChange={set("institution")} /></Labeled>
        <Labeled label="Título / nivel"><input className={inputClass} value={v.credential} onChange={set("credential")} /></Labeled>
        <Labeled label="Área de estudio"><input className={inputClass} value={v.fieldOfStudy} onChange={set("fieldOfStudy")} /></Labeled>
        <Labeled label="Año de fin"><input className={inputClass} value={v.endDate} onChange={set("endDate")} /></Labeled>
      </div>
      <SaveRow disabled={disabled} onSave={() => onSave(v)} onDelete={onDelete} />
    </div>
  );
}

// ── Experience card ──
function ExperienceCard({
  entry,
  onSave,
  onDelete,
  disabled,
}: {
  entry: ExperienceEntryState;
  onSave: (b: Record<string, unknown>) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [v, setV] = useState({
    title: entry.title ?? "",
    organization: entry.organization ?? "",
    rawDescription: entry.rawDescription ?? entry.responsibilities.join(", ") ?? "",
  });
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Labeled label="Puesto / rol">
          <input className={inputClass} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Labeled>
        <Labeled label="Organización">
          <input className={inputClass} value={v.organization} onChange={(e) => setV({ ...v, organization: e.target.value })} />
        </Labeled>
      </div>
      <div className="mt-2">
        <Labeled label="¿Qué hacías?">
          <textarea
            className={inputClass}
            rows={2}
            maxLength={ENTRY_TEXT_CHAR_LIMIT}
            value={v.rawDescription}
            onChange={(e) => setV({ ...v, rawDescription: e.target.value })}
          />
        </Labeled>
      </div>
      <SaveRow disabled={disabled} onSave={() => onSave(v)} onDelete={onDelete} />
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
  const add = () => {
    const names = text.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 1);
    if (names.length > 0) {
      onAdd(names);
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
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Agregar habilidades (separadas por comas)"
        />
        <Button variant="secondary" onClick={add} disabled={disabled}>
          Agregar
        </Button>
      </div>
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
  const add = () => {
    const names = text.split(/[,;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (names.length > 0) {
      onChange([...interests, ...names]);
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
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Agregar intereses (separados por comas)"
        />
        <Button variant="secondary" onClick={add} disabled={disabled}>
          Agregar
        </Button>
      </div>
    </Card>
  );
}

function SaveRow({ onSave, onDelete, disabled }: { onSave: () => void; onDelete?: () => void; disabled: boolean }) {
  return (
    <div className="mt-2 flex items-center justify-end gap-3">
      {onDelete && (
        <button type="button" onClick={onDelete} disabled={disabled} className="text-xs text-red-600 hover:underline">
          Eliminar
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={disabled}
        className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-on disabled:opacity-50"
      >
        Guardar
      </button>
    </div>
  );
}
