-- Finalization: records when the user finalized (locked) the résumé for download.
-- NULL = not finalized. Regenerating/editing clears it so the CV must be
-- re-finalized before it can be downloaded again.
alter table resume_profiles
  add column if not exists finalized_at timestamptz;
