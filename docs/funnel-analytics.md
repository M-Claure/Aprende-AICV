# Funnel analytics — where users quit, where they struggle

Two independent sources answer these questions:

- **Postgres** — the `funnel` table. Each row carries its whole Q&A history in
  `conversation` (a JSONB array of turns) and its current exit point in
  `question_state`. Authoritative, complete, and reliable at the small cohort
  sizes this product runs at. Start here.
- **Amplitude** — the event stream (`lib/analytics/events.ts`). Better for
  time-series, retention curves, and segmenting by device.

> **Do not wrap these queries in database views.** `funnel` is RLS-protected per
> user; a view owned by `postgres` would bypass RLS for any role that can select
> it. Run these ad hoc in the Supabase SQL editor (or from a service-role job),
> which is already outside RLS.

> **Turns are JSONB, not rows.** Since the schema was simplified
> (`0007_simplified_schema.sql`) a turn is an element of `funnel.conversation`, so
> every query below expands it with `jsonb_array_elements` and reads camelCase
> keys — `turn->>'questionId'`, not a `question_id` column. The `turns` CTE that
> most queries open with reproduces the old per-row shape, so the analysis below
> it reads the same as it always did.

## The two timestamps that matter

| Field | Meaning |
| --- | --- |
| `funnel.question_state->>'lastQuestionId'` | The last question the user **responded to** |
| `funnel.question_state->>'lastShownQuestionId'` | The last question the user **was served** |
| `funnel.question_state->>'lastShownAt'` | When that question was served (ISO text — cast it) |

When a profile stalls, the second one is the exit point — the screen they were
looking at when they gave up. The first one only tells you the last screen they
got *past*.

## 1. Where do users quit?

Exit points, ranked. A profile counts as stalled when it was served a question,
never finished, and has been idle for a day.

```sql
select question_state->>'lastShownQuestionId' as question_id,
       count(*)                               as stalled_profiles
from funnel
where finalized_at is null
  and (question_state->>'lastShownAt')::timestamptz < now() - interval '24 hours'
group by 1
order by stalled_profiles desc;
```

## 2. Exit rate per question

Raw stall counts are biased toward early questions (everyone sees them). This
normalizes: of everyone who reached a question, what share never got past it?

```sql
with answered as (
  select t.turn->>'questionId' as question_id, count(distinct f.id) as answered_profiles
  from funnel f, lateral jsonb_array_elements(f.conversation) as t(turn)
  group by 1
),
stalled as (
  select question_state->>'lastShownQuestionId' as question_id, count(*) as stalled_profiles
  from funnel
  where finalized_at is null
    and (question_state->>'lastShownAt')::timestamptz < now() - interval '24 hours'
  group by 1
)
select coalesce(a.question_id, s.question_id)   as question_id,
       coalesce(a.answered_profiles, 0)         as got_past_it,
       coalesce(s.stalled_profiles, 0)          as quit_here,
       round(coalesce(s.stalled_profiles, 0)::numeric
             / nullif(coalesce(a.answered_profiles, 0)
                    + coalesce(s.stalled_profiles, 0), 0), 3) as exit_rate
from answered a
full outer join stalled s on s.question_id = a.question_id
order by exit_rate desc nulls last, quit_here desc;
```

## 3. Where do users struggle?

Four struggle signals in one ranking. Read them together — a question can be slow
because it's hard *or* because it's genuinely open-ended.

```sql
with turns as (
  select f.id                                    as resume_profile_id,
         t.turn->>'questionId'                   as question_id,
         (t.turn->>'attemptNumber')::int         as attempt_number,
         (t.turn->>'skipped')::bool              as skipped,
         (t.turn->>'timeSpentMs')::int           as time_spent_ms,
         t.turn->'normalizedAnswer'              as normalized_answer
  from funnel f, lateral jsonb_array_elements(f.conversation) as t(turn)
)
select question_id,
       count(distinct resume_profile_id)                          as users,
       round(avg(attempt_number), 2)                              as avg_attempts,
       count(*) filter (where attempt_number > 1)                 as re_answers,
       round(avg((skipped)::int), 3)                              as skip_rate,
       percentile_cont(0.5) within group (order by time_spent_ms) as median_ms,
       percentile_cont(0.9) within group (order by time_spent_ms) as p90_ms
from turns
group by 1
having count(distinct resume_profile_id) >= 5   -- suppress tiny samples
order by median_ms desc nulls last;
```

- **`re_answers` > 0** — users went back and redid this question. Strongest
  confusion signal available.
- **High `skip_rate`** — the question is unanswerable, irrelevant, or intimidating.
- **High `p90_ms` with a normal median** — most users are fine, a minority is
  stuck. Usually a wording problem for one audience segment.
- **Caveat on `avg_attempts`:** questions asked once per entry (`experience_add`)
  legitimately repeat. There, a high count means "many entries", not "struggle".
  Cross-check against `re_answers` on single-shot questions.

## 4. Answers that the model could not interpret

`normalized_answer.needsConfirmation` is the AI saying "I'm not sure I understood
this." Clusters here mean the question invites answers the normalizer can't parse.

```sql
with turns as (
  select t.turn->>'questionId'      as question_id,
         t.turn->'normalizedAnswer' as normalized_answer
  from funnel f, lateral jsonb_array_elements(f.conversation) as t(turn)
)
select question_id,
       count(*) filter (where (normalized_answer->>'needsConfirmation')::bool) as unclear,
       count(*)                                                                as total,
       round(avg(((normalized_answer->>'needsConfirmation')::bool)::int), 3)   as unclear_rate
from turns
where normalized_answer is not null and normalized_answer <> 'null'::jsonb
group by 1
having count(*) >= 5
order by unclear_rate desc;
```

## 5. How far do abandoned profiles get?

```sql
select width_bucket(progress_percentage, 0, 100, 10) * 10 as progress_bucket,
       count(*)                                           as profiles
from funnel
where finalized_at is null
  and (question_state->>'lastShownAt')::timestamptz < now() - interval '24 hours'
group by 1
order by 1;
```

## 6. How much does the improvement loop get used?

New with the simplified schema: the round counter is server state, and each round's
questions and answers are logged in their own table.

```sql
select iteration, count(*) as profiles
from funnel
group by 1
order by 1;

-- What gets asked, and how often it actually gets answered, per round.
select 1 as round, question_id, count(*) as asked,
       count(answer) as answered from iteration_1 group by 1,2
union all
select 2, question_id, count(*), count(answer) from iteration_2 group by 1,2
union all
select 3, question_id, count(*), count(answer) from iteration_3 group by 1,2
order by round, asked desc;
```

## Amplitude side

The event stream mirrors the same model:

- `adaptive_question_shown` → `adaptive_question_answered`, grouped by
  `questionId`, is the drop-off funnel. **Count distinct users, not raw events** —
  a page refresh re-serves the same question and re-emits `shown`.
- `adaptive_question_skipped` carries `questionId`, `timeSpentMs`,
  `attemptNumber`, and `deviceCategory`.
- `deviceCategory` (`mobile` / `tablet` / `desktop`) is currently **event-only** —
  it is not persisted to `funnel.conversation`, so device segmentation has to
  happen in Amplitude. Adding a column would make query 3 splittable by device.

## Known gaps

- **`funnel_abandoned` is declared but never emitted.** Query 1 derives the same
  thing on demand. If you want it as an event (for Amplitude retention curves), a
  scheduled job over query 1 should emit it.
- **The client-side "add another experience" card** (`NEW_EXPERIENCE_QUESTION` in
  `app/cv/[id]/page.tsx`) is synthesized in the browser and never passes through
  the server, so it emits no `adaptive_question_shown` and does not update
  `last_shown_question_id`. Users who quit on that specific card are attributed to
  the previous question.
- **Client-side errors are invisible.** `handleError` in the flow page does not
  report to analytics, so an API failure looks identical to a user losing interest.
