-- Mi CV con IA — full database setup
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Combines migrations 0001 + 0002 + 0003 + 0004 + 0005 + 0006 + 0007 (run once on a fresh
-- project). Every statement is idempotent from 0002 onward, so re-running this
-- file on an existing project safely applies only what is missing.

-- ============ 0001_init.sql ============
-- ─────────────────────────────────────────────────────────────────────────────
-- Mi CV con IA — initial schema
-- Postgres (Supabase). Row-Level Security is enabled on every table so a user
-- can only read/write rows belonging to their own resume profiles.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────────
create type resume_status as enum (
  'draft', 'collecting_information', 'ready_for_review',
  'generating', 'generated', 'archived'
);

create type resume_section as enum (
  'career_goal', 'personal_information', 'education', 'experience',
  'skills', 'certifications', 'languages', 'projects', 'achievements', 'review'
);

create type experience_type as enum (
  'formal_employment', 'self_employment', 'business_owner', 'freelance',
  'informal_work', 'family_business', 'volunteering', 'internship',
  'school_project', 'caregiving', 'personal_project', 'other'
);

create type skill_origin as enum (
  'user_entered', 'education_inference', 'experience_inference',
  'project_inference', 'certification_inference'
);

create type skill_status as enum ('suggested', 'confirmed', 'rejected', 'edited');

create type confirmation_status as enum ('confirmed', 'needs_review', 'edited', 'rejected');

create type entry_source as enum ('user_entered', 'ai_extracted');

create type proficiency_level as enum ('basic', 'intermediate', 'advanced', 'expert');

create type language_level as enum ('basico', 'intermedio', 'avanzado', 'nativo');

create type project_type as enum ('personal', 'academic', 'professional', 'volunteer', 'other');

-- ── updated_at helper ─────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── users (app profile, 1:1 with auth.users) ───────────────────────────────────
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  preferred_language text not null default 'es',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

-- ── resume_profiles ─────────────────────────────────────────────────────────
create table resume_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  status resume_status not null default 'draft',
  target_role text,
  career_goal text,
  location text,
  progress_percentage int not null default 0 check (progress_percentage between 0 and 100),
  current_section resume_section,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resume_profiles_user_id_idx on resume_profiles(user_id);
create trigger resume_profiles_updated_at before update on resume_profiles
  for each row execute function set_updated_at();

-- ── personal_information (1:1) ────────────────────────────────────────────────
create table personal_information (
  resume_profile_id uuid primary key references resume_profiles(id) on delete cascade,
  first_name text,
  last_name text,
  city text,
  state text,
  country text,
  phone text,
  email text,
  linkedin_url text,
  portfolio_url text
);

-- ── education_entries ─────────────────────────────────────────────────────────
create table education_entries (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  institution text,
  credential text,
  field_of_study text,
  location text,
  start_date text,
  end_date text,
  is_current boolean not null default false,
  relevant_coursework text[] not null default '{}',
  projects text[] not null default '{}',
  achievements text[] not null default '{}',
  source entry_source not null default 'user_entered',
  confirmation_status confirmation_status not null default 'confirmed',
  created_at timestamptz not null default now()
);
create index education_entries_profile_idx on education_entries(resume_profile_id);

-- ── experience_entries ────────────────────────────────────────────────────────
create table experience_entries (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  experience_type experience_type not null default 'other',
  title text,
  organization text,
  location text,
  start_date text,
  end_date text,
  is_current boolean not null default false,
  raw_description text,
  responsibilities text[] not null default '{}',
  accomplishments text[] not null default '{}',
  tools text[] not null default '{}',
  people_served text,
  metrics text[] not null default '{}',
  source entry_source not null default 'user_entered',
  confirmation_status confirmation_status not null default 'confirmed',
  created_at timestamptz not null default now()
);
create index experience_entries_profile_idx on experience_entries(resume_profile_id);

-- ── skills ────────────────────────────────────────────────────────────────────
create table skills (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  name text not null,
  category text not null default 'general',
  proficiency proficiency_level,
  origin skill_origin not null default 'user_entered',
  evidence text,
  source_entry_id uuid,
  status skill_status not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index skills_profile_idx on skills(resume_profile_id);
-- Prevent duplicate suggestions of the same skill within a profile.
create unique index skills_profile_name_uidx on skills(resume_profile_id, lower(name));
create trigger skills_updated_at before update on skills
  for each row execute function set_updated_at();

-- ── certifications ────────────────────────────────────────────────────────────
create table certifications (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  name text not null,
  issuing_organization text,
  issue_date text,
  expiration_date text,
  credential_id text,
  credential_url text,
  confirmation_status confirmation_status not null default 'confirmed',
  created_at timestamptz not null default now()
);
create index certifications_profile_idx on certifications(resume_profile_id);

-- ── languages ─────────────────────────────────────────────────────────────────
create table languages (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  name text not null,
  speaking_level language_level,
  reading_level language_level,
  writing_level language_level,
  include_on_resume boolean not null default true,
  created_at timestamptz not null default now()
);
create index languages_profile_idx on languages(resume_profile_id);

-- ── projects ──────────────────────────────────────────────────────────────────
create table projects (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  name text not null,
  project_type project_type,
  organization text,
  start_date text,
  end_date text,
  description text,
  responsibilities text[] not null default '{}',
  outcomes text[] not null default '{}',
  tools text[] not null default '{}',
  confirmation_status confirmation_status not null default 'confirmed',
  created_at timestamptz not null default now()
);
create index projects_profile_idx on projects(resume_profile_id);

-- ── achievements ──────────────────────────────────────────────────────────────
create table achievements (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  title text not null,
  organization text,
  date text,
  description text,
  confirmation_status confirmation_status not null default 'confirmed',
  created_at timestamptz not null default now()
);
create index achievements_profile_idx on achievements(resume_profile_id);

-- ── conversation_turns ────────────────────────────────────────────────────────
create table conversation_turns (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  question_id text not null,
  section resume_section not null,
  assistant_message text not null,
  user_answer text,
  normalized_answer jsonb,
  skipped boolean not null default false,
  created_at timestamptz not null default now()
);
create index conversation_turns_profile_idx on conversation_turns(resume_profile_id, created_at);

-- ── question_states (1:1) ─────────────────────────────────────────────────────
create table question_states (
  resume_profile_id uuid primary key references resume_profiles(id) on delete cascade,
  asked_question_ids text[] not null default '{}',
  skipped_question_ids text[] not null default '{}',
  completed_sections resume_section[] not null default '{}',
  active_section resume_section,
  last_question_id text,
  last_updated_at timestamptz not null default now()
);

-- ── generated_resumes ─────────────────────────────────────────────────────────
create table generated_resumes (
  id uuid primary key default gen_random_uuid(),
  resume_profile_id uuid not null references resume_profiles(id) on delete cascade,
  version int not null default 1,
  professional_summary text not null default '',
  skills jsonb not null default '[]',
  experience jsonb not null default '[]',
  education jsonb not null default '[]',
  certifications jsonb not null default '[]',
  projects jsonb not null default '[]',
  languages jsonb not null default '[]',
  html text not null default '',
  pdf_url text,
  created_at timestamptz not null default now()
);
create index generated_resumes_profile_idx on generated_resumes(resume_profile_id, version);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table users enable row level security;
alter table resume_profiles enable row level security;
alter table personal_information enable row level security;
alter table education_entries enable row level security;
alter table experience_entries enable row level security;
alter table skills enable row level security;
alter table certifications enable row level security;
alter table languages enable row level security;
alter table projects enable row level security;
alter table achievements enable row level security;
alter table conversation_turns enable row level security;
alter table question_states enable row level security;
alter table generated_resumes enable row level security;

-- users: a user sees only their own row.
create policy users_self on users
  for all using (id = auth.uid()) with check (id = auth.uid());

-- resume_profiles: owned by user_id.
create policy resume_profiles_owner on resume_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables: access allowed when the parent profile belongs to the user.
-- (Applied via a helper predicate repeated per table.)
create policy personal_information_owner on personal_information for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy education_entries_owner on education_entries for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy experience_entries_owner on experience_entries for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy skills_owner on skills for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy certifications_owner on certifications for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy languages_owner on languages for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy projects_owner on projects for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy achievements_owner on achievements for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy conversation_turns_owner on conversation_turns for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy question_states_owner on question_states for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

create policy generated_resumes_owner on generated_resumes for all
  using (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()))
  with check (resume_profile_id in (select id from resume_profiles where user_id = auth.uid()));

-- ── Auto-provision public.users row on signup ──────────────────────────────────
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ============ 0002_interests.sql ============
-- Personal interests / hobbies as a lightweight list on the resume profile.
alter table resume_profiles
  add column if not exists interests text[] not null default '{}';

-- ============ 0003_finalized_at.sql ============
-- Finalization: records when the user finalized (locked) the résumé for download.
-- NULL = not finalized. Regenerating/editing clears it so the CV must be
-- re-finalized before it can be downloaded again.
alter table resume_profiles
  add column if not exists finalized_at timestamptz;

-- ============ 0004_terms_consent.sql ============
-- Terms & conditions consent: proof the user agreed before starting the builder.
-- terms_accepted_at = when they accepted (server stamped); terms_version = the
-- exact text version accepted (see lib/legal/terms.ts). NULL = legacy profile.
alter table resume_profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

-- ============ 0005_funnel_telemetry.sql ============
-- Funnel telemetry: makes "where did the user quit" and "where do users
-- struggle" answerable in SQL. time_spent_ms + attempt_number are the per-answer
-- effort signals; last_shown_question_id is the real exit point (last_question_id
-- only records questions that got a response). See docs/funnel-analytics.md.
alter table conversation_turns
  add column if not exists time_spent_ms int
    check (time_spent_ms is null or time_spent_ms >= 0),
  add column if not exists attempt_number int not null default 1;

alter table question_states
  add column if not exists last_shown_question_id text,
  add column if not exists last_shown_at timestamptz;

create index if not exists conversation_turns_question_idx
  on conversation_turns(question_id);

create index if not exists question_states_last_shown_idx
  on question_states(last_shown_at);

-- ============ 0006_resume_pdf_storage.sql ============
-- Saved résumé PDFs.
--
-- Until now the PDF was rendered on every download and never persisted: the
-- `generated_resumes.pdf_url` column existed but was never written. Résumés are
-- now rendered and stored on every generation, so a user always has a current
-- file and a download is a storage read rather than a Chromium launch.
--
-- ── One object per profile ───────────────────────────────────────────────────
-- The object path is `<user_id>/<resume_profile_id>/curriculum.pdf` and each
-- generation OVERWRITES it. A profile therefore holds exactly one PDF — the
-- render of its latest generation. Consequences, both intended:
--   * storage cannot grow without bound as a user iterates on their CV;
--   * a download can never return a stale version;
--   * older generated_resumes rows are not individually downloadable. Nothing in
--     the product offers version history, and a PDF per version would multiply
--     PII at rest for no user-facing gain.
--
-- ── Why the user id is the FIRST path segment ────────────────────────────────
-- The policies below authorize on `(storage.foldername(name))[1] = auth.uid()`,
-- which is the standard Supabase Storage ownership pattern. `resumePdfPath()` in
-- lib/storage/resume-file-store.ts must keep producing that layout — changing it
-- silently changes who can read the file, so it is pinned by a unit test.
--
-- Everything here is idempotent; safe to re-run.

-- ── Bucket ───────────────────────────────────────────────────────────────────
-- Private. There is no public URL for a résumé: reads go through the API, which
-- re-checks profile ownership before streaming bytes.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- ── RLS on the objects ───────────────────────────────────────────────────────
-- Defense-in-depth behind the API's own ownership check: even a bug that
-- computed the wrong path cannot write into, or read from, another user's folder.
drop policy if exists "resumes_read_own" on storage.objects;
create policy "resumes_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "resumes_insert_own" on storage.objects;
create policy "resumes_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Upsert of an existing object is an UPDATE, so replacement needs this one too.
drop policy if exists "resumes_update_own" on storage.objects;
create policy "resumes_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "resumes_delete_own" on storage.objects;
create policy "resumes_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Column rename ────────────────────────────────────────────────────────────
-- `pdf_url` was scaffolding that never held a value; what we store is a storage
-- object PATH (signed URLs expire, so a URL would rot in the row). Renaming is
-- safe precisely because the column has always been null.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generated_resumes'
      and column_name = 'pdf_url'
  ) then
    alter table generated_resumes rename column pdf_url to pdf_path;
  end if;
end $$;

comment on column generated_resumes.pdf_path is
  'Storage object path in the private "resumes" bucket. One PDF per profile: '
  'every generation overwrites it, so only the latest version''s path is current.';

-- ============ 0007_simplified_schema.sql ============
-- Schema simplification: 13 tables → 5.
--
--   funnel        everything captured during the funnel, one row per résumé
--   resume_pdfs   every generated résumé and its stored PDF
--   iteration_1   \
--   iteration_2    >  the improvement round's questions and answers
--   iteration_3   /
--
-- ── What changed and why ─────────────────────────────────────────────────────
-- The old schema normalized eight capture sections (personal_information,
-- education_entries, experience_entries, skills, certifications, languages,
-- projects, achievements) plus conversation_turns and question_states into their
-- own tables. That buys per-row querying nobody was doing: a profile is a single
-- user's small, capped document (≤4 experiences, ≤2 education entries) that the
-- app always loads whole, via `assembleProfileState`. The cost was 13 tables, 13
-- RLS policies and ~700 lines of row↔domain mapping.
--
-- They are now JSONB columns on `funnel`, holding the DOMAIN objects verbatim
-- (camelCase keys, exactly the shapes in types/domain.ts). That is deliberate:
-- what you see in the Supabase editor is precisely what the app sees, and the
-- mapping layer disappears instead of being rewritten.
--
-- ── What this costs, stated plainly ──────────────────────────────────────────
--  * No per-entry foreign keys or CHECK constraints inside the JSONB. Entry
--    shape is enforced in TypeScript and by the Zod schemas on the AI boundary,
--    not by Postgres. The safety invariants that matter (skills start as
--    `suggested`; only confirmed/edited data reaches a résumé) were always
--    enforced in code — see lib/skills/ and lib/resume/source-tracing.ts.
--  * Updating one entry rewrites the row's array. `SupabaseStore` does that
--    read-modify-write under an optimistic `revision` guard so a concurrent
--    write cannot silently clobber another.
--  * `users` is gone. It mirrored auth.users and was kept in sync by a trigger;
--    funnel.user_id now references auth.users directly.
--
-- Everything is idempotent, and existing rows are migrated before the old tables
-- are dropped. Run it once; re-running is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- Conversion helpers (dropped at the end — they exist only for the backfill)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function mcv_snake_to_camel(txt text)
returns text language sql immutable as $$
  select string_agg(case when i = 1 then part else initcap(part) end, '')
  from unnest(string_to_array(txt, '_')) with ordinality as t(part, i);
$$;

-- Rewrites a row's snake_case keys to the camelCase the domain model uses.
-- `linkedin_url` is the one field whose domain name is not a mechanical
-- transform (`linkedInUrl`, capital I), so it is special-cased.
create or replace function mcv_camelize(obj jsonb)
returns jsonb language sql immutable as $$
  select coalesce(
    jsonb_object_agg(
      case key when 'linkedin_url' then 'linkedInUrl' else mcv_snake_to_camel(key) end,
      value
    ),
    '{}'::jsonb
  )
  from jsonb_each(obj);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. funnel — everything from the funnel
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists funnel (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- profile
  status resume_status not null default 'draft',
  target_role text,
  career_goal text,
  location text,
  interests text[] not null default '{}',
  progress_percentage int not null default 0 check (progress_percentage between 0 and 100),
  current_section resume_section,
  finalized_at timestamptz,
  terms_accepted_at timestamptz,
  terms_version text,

  -- captured sections, as domain objects (was 8 tables)
  personal_information jsonb not null default '{}'::jsonb,
  education jsonb not null default '[]'::jsonb,
  experience jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  certifications jsonb not null default '[]'::jsonb,
  languages jsonb not null default '[]'::jsonb,
  projects jsonb not null default '[]'::jsonb,
  achievements jsonb not null default '[]'::jsonb,

  -- funnel Q&A + progress (was conversation_turns + question_states)
  conversation jsonb not null default '[]'::jsonb,
  question_state jsonb not null default '{}'::jsonb,

  -- Improvement-loop position, 0–3. Previously kept in the browser's
  -- localStorage, which meant the cap reset on a new device or a cleared cache.
  -- It is server state now, and MAX_RESUME_ITERATIONS is enforced against it.
  iteration int not null default 0 check (iteration between 0 and 3),

  -- Optimistic-concurrency guard. Every write to a JSONB list bumps this and
  -- asserts the value it read, so two concurrent edits cannot lose one another.
  revision bigint not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists funnel_user_id_idx on funnel(user_id);
-- Entry lookups arrive with only an entry id (updateExperience(entryId, …)), so
-- the store finds the owning row by JSONB containment. GIN makes that an index
-- scan rather than a sequential one.
create index if not exists funnel_education_gin on funnel using gin (education jsonb_path_ops);
create index if not exists funnel_experience_gin on funnel using gin (experience jsonb_path_ops);
create index if not exists funnel_skills_gin on funnel using gin (skills jsonb_path_ops);
create index if not exists funnel_certifications_gin on funnel using gin (certifications jsonb_path_ops);
create index if not exists funnel_languages_gin on funnel using gin (languages jsonb_path_ops);
create index if not exists funnel_projects_gin on funnel using gin (projects jsonb_path_ops);
create index if not exists funnel_achievements_gin on funnel using gin (achievements jsonb_path_ops);

drop trigger if exists funnel_updated_at on funnel;
create trigger funnel_updated_at before update on funnel
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. resume_pdfs — every generated résumé and its stored PDF
-- ─────────────────────────────────────────────────────────────────────────────
-- `content` holds the whole generated document (summary + the six section
-- blocks, each bullet still carrying its source trace) as one object, rather
-- than the seven separate columns it used to occupy.
create table if not exists resume_pdfs (
  id uuid primary key default gen_random_uuid(),
  funnel_id uuid not null references funnel(id) on delete cascade,
  version int not null default 1,
  content jsonb not null default '{}'::jsonb,
  html text not null default '',
  pdf_path text,
  created_at timestamptz not null default now()
);
create index if not exists resume_pdfs_funnel_idx on resume_pdfs(funnel_id, version desc);

comment on column resume_pdfs.pdf_path is
  'Storage object path in the private "resumes" bucket. One PDF per funnel row: '
  'every generation overwrites it, so only the latest version''s path is current.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3–5. iteration_1 / iteration_2 / iteration_3
-- ─────────────────────────────────────────────────────────────────────────────
-- One table per improvement round, as requested, each holding the question that
-- was asked and the answer that came back. They are an audit log of the round:
-- the answers are also applied to `funnel` through the normal pipeline, so
-- deleting a row here loses the record, not the résumé content.
--
-- Note the shape is identical three times over. That is a deliberate, accepted
-- trade for having three browsable tabs: a fourth round would need a migration,
-- and any column change has to be made three times. MAX_RESUME_ITERATIONS in
-- lib/config/limits.ts must stay at 3 to match.
do $$
declare
  n int;
begin
  for n in 1..3 loop
    execute format($fmt$
      create table if not exists iteration_%s (
        id uuid primary key default gen_random_uuid(),
        funnel_id uuid not null references funnel(id) on delete cascade,
        question_id text not null,
        question text not null,
        answer text,
        created_at timestamptz not null default now()
      );
      create index if not exists iteration_%s_funnel_idx on iteration_%s(funnel_id);
    $fmt$, n, n, n);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill from the old schema, then drop it
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.resume_profiles') is null then
    return; -- fresh project: nothing to migrate
  end if;

  -- 0006 renames generated_resumes.pdf_url -> pdf_path. Repeat it here rather
  -- than assume it ran: applying this file to a database still at 0005 would
  -- otherwise fail deep inside the backfill, with the old tables already half
  -- read. Both are no-ops once the column has its new name.
  if to_regclass('public.generated_resumes') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'generated_resumes'
         and column_name = 'pdf_url'
     ) then
    alter table generated_resumes rename column pdf_url to pdf_path;
  end if;

  insert into funnel (
    id, user_id, status, target_role, career_goal, location, interests,
    progress_percentage, current_section, finalized_at, terms_accepted_at,
    terms_version, personal_information, education, experience, skills,
    certifications, languages, projects, achievements, conversation,
    question_state, created_at, updated_at
  )
  select
    p.id, p.user_id, p.status, p.target_role, p.career_goal, p.location,
    coalesce(p.interests, '{}'), p.progress_percentage, p.current_section,
    p.finalized_at, p.terms_accepted_at, p.terms_version,
    coalesce((select mcv_camelize(to_jsonb(x)) from personal_information x
              where x.resume_profile_id = p.id), '{}'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from education_entries x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from experience_entries x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.created_at) from skills x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from certifications x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from languages x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from projects x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.id) from achievements x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select jsonb_agg(mcv_camelize(to_jsonb(x)) order by x.created_at) from conversation_turns x
              where x.resume_profile_id = p.id), '[]'::jsonb),
    coalesce((select mcv_camelize(to_jsonb(x)) from question_states x
              where x.resume_profile_id = p.id), '{}'::jsonb),
    p.created_at, p.updated_at
  from resume_profiles p
  on conflict (id) do nothing;

  if to_regclass('public.generated_resumes') is not null then
    insert into resume_pdfs (id, funnel_id, version, content, html, pdf_path, created_at)
    select
      g.id, g.resume_profile_id, g.version,
      jsonb_build_object(
        'professionalSummary', coalesce(g.professional_summary, ''),
        'skills',         coalesce(g.skills, '[]'::jsonb),
        'experience',     coalesce(g.experience, '[]'::jsonb),
        'education',      coalesce(g.education, '[]'::jsonb),
        'certifications', coalesce(g.certifications, '[]'::jsonb),
        'projects',       coalesce(g.projects, '[]'::jsonb),
        'languages',      coalesce(g.languages, '[]'::jsonb)
      ),
      coalesce(g.html, ''), g.pdf_path, g.created_at
    from generated_resumes g
    where exists (select 1 from funnel f where f.id = g.resume_profile_id)
    on conflict (id) do nothing;
  end if;
end $$;

drop table if exists generated_resumes cascade;
drop table if exists question_states cascade;
drop table if exists conversation_turns cascade;
drop table if exists achievements cascade;
drop table if exists projects cascade;
drop table if exists languages cascade;
drop table if exists certifications cascade;
drop table if exists skills cascade;
drop table if exists experience_entries cascade;
drop table if exists education_entries cascade;
drop table if exists personal_information cascade;
drop table if exists resume_profiles cascade;

-- `users` mirrored auth.users and was maintained by a trigger; funnel.user_id
-- references auth.users directly now, so both go.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_auth_user() cascade;
drop table if exists users cascade;

drop function if exists mcv_camelize(jsonb);
drop function if exists mcv_snake_to_camel(text);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table funnel enable row level security;
alter table resume_pdfs enable row level security;
alter table iteration_1 enable row level security;
alter table iteration_2 enable row level security;
alter table iteration_3 enable row level security;

drop policy if exists funnel_owner on funnel;
create policy funnel_owner on funnel
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists resume_pdfs_owner on resume_pdfs;
create policy resume_pdfs_owner on resume_pdfs
  for all
  using (exists (select 1 from funnel f where f.id = funnel_id and f.user_id = auth.uid()))
  with check (exists (select 1 from funnel f where f.id = funnel_id and f.user_id = auth.uid()));

do $$
declare
  n int;
begin
  for n in 1..3 loop
    execute format($fmt$
      drop policy if exists iteration_%s_owner on iteration_%s;
      create policy iteration_%s_owner on iteration_%s
        for all
        using (exists (select 1 from funnel f where f.id = funnel_id and f.user_id = auth.uid()))
        with check (exists (select 1 from funnel f where f.id = funnel_id and f.user_id = auth.uid()));
    $fmt$, n, n, n, n);
  end loop;
end $$;
