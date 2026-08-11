-- Terms & conditions consent: proof that the user agreed before starting the
-- résumé builder. `terms_accepted_at` is the moment of acceptance (server
-- stamped) and `terms_version` is the exact version of the text they accepted
-- (see lib/legal/terms.ts). NULL = legacy profile created before consent was
-- required. RLS is unchanged: these columns live on resume_profiles, which is
-- already restricted to the owning user.
alter table resume_profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;
