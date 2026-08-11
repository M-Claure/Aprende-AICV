-- Funnel telemetry: make "where did the user quit" and "where do users struggle"
-- answerable directly in SQL, not only in Amplitude. Cohort volumes here are
-- small enough that product-analytics sampling is unreliable, and the database
-- already holds one row per turn — it just lacked the effort signals.
--
-- conversation_turns gains the per-answer effort signals:
--   time_spent_ms  — wall time between the question being shown and submitted,
--                    as reported by the client (already collected, previously
--                    forwarded to Amplitude only and then discarded).
--   attempt_number — nth time this question_id has been recorded for this
--                    profile. >1 means the user came back and re-answered it.
--                    Note: for questions asked once per entry (experience_add)
--                    a high attempt_number means "many entries", not "struggle";
--                    read it together with the question's catalog semantics.
--
-- question_states gains the last question the user was *shown*. This is the real
-- exit point: last_question_id only ever records questions that were answered or
-- skipped, so the screen someone abandoned was previously invisible.
--
-- RLS is unchanged — both tables are already restricted to the owning user.

alter table conversation_turns
  add column if not exists time_spent_ms int
    check (time_spent_ms is null or time_spent_ms >= 0),
  add column if not exists attempt_number int not null default 1;

alter table question_states
  add column if not exists last_shown_question_id text,
  add column if not exists last_shown_at timestamptz;

-- Funnel aggregations group by question_id across every profile.
create index if not exists conversation_turns_question_idx
  on conversation_turns(question_id);

-- Exit-point aggregation scans for stalled profiles by recency.
create index if not exists question_states_last_shown_idx
  on question_states(last_shown_at);
