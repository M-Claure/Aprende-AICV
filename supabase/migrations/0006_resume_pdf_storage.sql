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
