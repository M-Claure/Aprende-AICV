# Funnel analytics — where users quit, where they struggle

Two independent sources answer these questions:

- **Postgres** — one row per turn in `conversation_turns`, plus the current exit
  point in `question_states`. Authoritative, complete, and reliable at the small
  cohort sizes this product runs at. Start here.
- **Amplitude** — the event stream (`lib/analytics/events.ts`). Better for
  time-series, retention curves, and segmenting by device.

> **Do not wrap these queries in database views.** `conversation_turns` and
> `question_states` are RLS-protected per user; a view owned by `postgres` would
> bypass RLS for any role that can select it. Run these ad hoc in the Supabase SQL
> editor (or from a service-role job), which is already outside RLS.

## The two timestamps that matter

| Column | Meaning |
| --- | --- |
| `question_states.last_question_id` | The last question the user **responded to** |
| `question_states.last_shown_question_id` | The last question the user **was served** |

When a profile stalls, the second one is the exit point — the screen they were
looking at when they gave up. The first one only tells you the last screen they
got *past*.

## 1. Where do users quit?

Exit points, ranked. A profile counts as stalled when it was served a question,
never finished, and has been idle for a day.

```sql
select qs.last_shown_question_id as question_id,
       count(*)                  as stalled_profiles
from question_states qs
join resume_profiles p on p.id = qs.resume_profile_id
where p.finalized_at is null
  and qs.last_shown_at < now() - interval '24 hours'
group by 1
order by stalled_profiles desc;
```

## 2. Exit rate per question

Raw stall counts are biased toward early questions (everyone sees them). This
normalizes: of everyone who reached a question, what share never got past it?

```sql
with answered as (
  select question_id, count(distinct resume_profile_id) as answered_profiles
  from conversation_turns
  group by 1
),
stalled as (
  select qs.last_shown_question_id as question_id, count(*) as stalled_profiles
  from question_states qs
  join resume_profiles p on p.id = qs.resume_profile_id
  where p.finalized_at is null
    and qs.last_shown_at < now() - interval '24 hours'
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
select question_id,
       count(distinct resume_profile_id)                          as users,
       round(avg(attempt_number), 2)                              as avg_attempts,
       count(*) filter (where attempt_number > 1)                 as re_answers,
       round(avg((skipped)::int), 3)                              as skip_rate,
       percentile_cont(0.5) within group (order by time_spent_ms) as median_ms,
       percentile_cont(0.9) within group (order by time_spent_ms) as p90_ms
from conversation_turns
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
select question_id,
       count(*) filter (where (normalized_answer->>'needsConfirmation')::bool) as unclear,
       count(*)                                                                as total,
       round(avg(((normalized_answer->>'needsConfirmation')::bool)::int), 3)   as unclear_rate
from conversation_turns
where normalized_answer is not null
group by 1
having count(*) >= 5
order by unclear_rate desc;
```

## 5. How far do abandoned profiles get?

```sql
select width_bucket(p.progress_percentage, 0, 100, 10) * 10 as progress_bucket,
       count(*)                                             as profiles
from resume_profiles p
join question_states qs on qs.resume_profile_id = p.id
where p.finalized_at is null
  and qs.last_shown_at < now() - interval '24 hours'
group by 1
order by 1;
```

## Amplitude side

The event stream mirrors the same model:

- `adaptive_question_shown` → `adaptive_question_answered`, grouped by
  `questionId`, is the drop-off funnel. **Count distinct users, not raw events** —
  a page refresh re-serves the same question and re-emits `shown`.
- `adaptive_question_skipped` carries `questionId`, `timeSpentMs`,
  `attemptNumber`, and `deviceCategory`.
- `deviceCategory` (`mobile` / `tablet` / `desktop`) is currently **event-only** —
  it is not persisted to `conversation_turns`, so device segmentation has to
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
