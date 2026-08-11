-- Personal interests / hobbies as a lightweight list on the resume profile.
alter table resume_profiles
  add column if not exists interests text[] not null default '{}';
