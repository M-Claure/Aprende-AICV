-- ─────────────────────────────────────────────────────────────────────────────
-- Mi CV con IA — apply to an EXISTING project (currently at migration 0007).
--
-- Contains migration 0008 only, wrapped in one transaction: if anything fails,
-- the whole thing rolls back and your database is untouched. Nothing is
-- half-applied.
--
-- 0008  drops `resume_pdfs`, moves the current résumé onto `funnel`, and adds a
--       `resume_pdf` path column to `funnel` and to `iteration_1..3` so each
--       improvement round keeps its own PDF
--
-- TAKE A BACKUP FIRST. It drops `resume_pdfs` once the latest résumé per profile
-- has been copied onto its `funnel` row; the older versions' content and html are
-- NOT carried across and are gone with the table.
--
-- If your project is still at 0005, run RUN_IN_SUPABASE.sql first.
-- Check with:  select to_regclass('public.resume_pdfs'), to_regclass('public.funnel');
-- Both non-null means you are at 0007 and this is the right file.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Drop `resume_pdfs`; put the résumé on `funnel`, and a PDF path on every stage.
--
-- ── What this is for ─────────────────────────────────────────────────────────
-- The product has three improvement rounds (`iteration_1..3`), but only ever had
-- ONE stored PDF: `<user_id>/<funnel_id>/curriculum.pdf`, overwritten by every
-- generation. So there was no way to see how a user's résumé actually changed as
-- they answered more questions — the only artifact was the final state.
--
-- Now each ROUND owns its own object, and the row that produced it names it:
--
--   funnel.resume_pdf        <user_id>/<funnel_id>/curriculum.pdf    (initial)
--   iteration_1.resume_pdf   <user_id>/<funnel_id>/iteration-1.pdf   (after round 1)
--   iteration_2.resume_pdf   <user_id>/<funnel_id>/iteration-2.pdf   (after round 2)
--   iteration_3.resume_pdf   <user_id>/<funnel_id>/iteration-3.pdf   (after round 3)
--
-- `funnel.resume_pdf` always names the CURRENT résumé's object, whichever round
-- that is; the `iteration_N` columns are the historical snapshots. Open them in
-- order and you see the résumé improve.
--
-- ── What this costs, stated plainly ──────────────────────────────────────────
--  * Up to FOUR PDFs per user instead of one. 0006 deliberately kept a single
--    object so storage could not grow as a user iterated and PII at rest stayed
--    minimal; that trade is now reversed, on purpose, because per-round history
--    is the point. The cap is still hard (4), since MAX_RESUME_ITERATIONS is 3.
--  * No per-version content history. `resume_pdfs` accumulated one row per
--    generation with its own `content` + `html`; those columns move to `funnel`
--    and hold only the CURRENT résumé. What survives per round is the rendered
--    PDF, not diffable JSON.
--
-- ── Why the résumé moves onto `funnel` ───────────────────────────────────────
-- `resume_pdfs` was named for its path column but was really the generated-résumé
-- table: `content` (professionalSummary + the six section blocks, each bullet
-- still carrying its source trace) and `html` are what the CV page, the preview,
-- the analyzer, the proofreader and the download all read. There is exactly one
-- current résumé per funnel row, so the table was a 1:1 join in every code path
-- that touched it. It collapses into columns.
--
-- Idempotent. Run it once; re-running is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The current résumé, on `funnel`
-- ─────────────────────────────────────────────────────────────────────────────
alter table funnel
  -- Identity of the current generated résumé, carried over from `resume_pdfs.id`.
  -- Kept because it changes on every generation, which is what makes it usable
  -- as the analysis cache key (`lib/resume/analysis-cache.ts`) — and what lets a
  -- write from a superseded generation find no row instead of clobbering a newer
  -- résumé's PDF path.
  add column if not exists resume_id uuid,
  -- The whole generated document, exactly the shape `resume_pdfs.content` held.
  add column if not exists resume_content jsonb not null default '{}'::jsonb,
  add column if not exists resume_html    text   not null default '',
  -- Monotonic per-generation counter, carried over from `resume_pdfs.version`.
  -- Counts EVERY generation, including proofreads and section regenerations —
  -- which is why it is not the same thing as the round below.
  add column if not exists resume_version int    not null default 0,
  -- Which improvement round the current résumé belongs to, and therefore which
  -- object holds it: 0 = the initial generation, 1..3 = after that round.
  -- Distinct from `iteration` (rounds COMPLETED): a regeneration mid-round
  -- re-renders the open round's PDF without consuming a round.
  add column if not exists resume_stage   int    not null default 0,
  -- Storage object path of the current résumé's PDF; null until one is stored.
  add column if not exists resume_pdf     text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'funnel_resume_stage_range'
  ) then
    alter table funnel
      add constraint funnel_resume_stage_range check (resume_stage between 0 and 3);
  end if;
end $$;

comment on column funnel.resume_content is
  'The current generated résumé: professionalSummary + the six section blocks, '
  'camelCase, exactly types/domain.ts GeneratedResume. Bullets keep their source traces.';
comment on column funnel.resume_pdf is
  'Storage path of the CURRENT résumé''s PDF in the private "resumes" bucket. '
  'Points at curriculum.pdf before the first improvement round and at '
  'iteration-N.pdf after round N — the same object iteration_N.resume_pdf names.';
comment on column funnel.resume_stage is
  'Improvement round the current résumé belongs to (0 = initial). Selects the PDF object.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A PDF path on each round
-- ─────────────────────────────────────────────────────────────────────────────
-- `iteration_N` holds one row per QUESTION, not one per round, so every row of a
-- round carries that round's path: the generation that closes the round stamps
-- them all. Repeating the value beats a nullable-except-the-last-row column —
-- any row you happen to open tells you which PDF that round produced.
do $$
declare
  n int;
begin
  for n in 1..3 loop
    execute format(
      'alter table iteration_%s add column if not exists resume_pdf text', n
    );
    execute format(
      'comment on column iteration_%s.resume_pdf is %L', n,
      'Storage path of the PDF rendered when this round closed. Same value on '
      'every row of the round; null until the round''s regeneration runs.'
    );
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Move the latest résumé across, then drop the table
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the latest version moves: it is the only one the app ever read, and it is
-- the only one whose `pdf_path` still names live bytes (every generation
-- overwrote the single object).
--
-- `resume_stage` is left at its 0 default for migrated rows. Existing PDFs all
-- live at curriculum.pdf regardless of which round produced them, so claiming a
-- round here would name an object that was never written. Pre-existing profiles
-- therefore have no per-round history — there is none to recover — and their next
-- generation starts populating it.
do $$
begin
  if to_regclass('public.resume_pdfs') is null then
    return; -- already migrated
  end if;

  update funnel f
     set resume_id      = r.id,
         resume_content = coalesce(r.content, '{}'::jsonb),
         resume_html    = coalesce(r.html, ''),
         resume_version = coalesce(r.version, 0),
         resume_pdf     = r.pdf_path
    from (
      select distinct on (funnel_id) funnel_id, id, content, html, version, pdf_path
        from resume_pdfs
       order by funnel_id, version desc, created_at desc
    ) r
   where r.funnel_id = f.id;
end $$;

drop table if exists resume_pdfs cascade;

COMMIT;
