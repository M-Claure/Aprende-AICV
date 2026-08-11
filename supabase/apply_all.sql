-- Mi CV con IA — full database setup
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Combines migrations 0001 + 0002 + 0003 + 0004 + 0005 (run once on a fresh
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
