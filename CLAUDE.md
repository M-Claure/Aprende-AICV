# CLAUDE.md — Mi CV con IA

Guidance for AI agents (and humans) working in this repository.

## Product purpose

**Mi CV con IA** is a Spanish-language AI resume builder. It guides a user through
creating a truthful professional résumé by asking **adaptive** questions (not a
fixed script), inferring **evidence-backed** skills the user must confirm, and
generating a résumé that contains **only confirmed information**. A user with no
formal employment can still complete a résumé through education, projects,
volunteering, caregiving, entrepreneurship, or other transferable experience.

All user-facing text is **Spanish**. Structured data is normalized and stored in
English field names for code clarity.

> The source-of-truth design is a **Pencil file** (`aiCV.pen`). This repo is primarily
> the **backend + AI orchestration + server-rendered HTML/PDF résumé** (`app/api/*`),
> plus a **minimal working React UI** (`app/page.tsx`, `app/cv/[id]/page.tsx`,
> `app/login/page.tsx`, `components/*`) that consumes those APIs so the product is
> usable end-to-end. The UI is intentionally lean — a fuller build should follow the
> Pencil design.

## Architecture

Dependencies point downward; the domain never imports infrastructure.

```
app/api/*  (route handlers: auth → validate → service → typed JSON)
   │
lib/services/answer-pipeline.ts · lib/resume/resume-generator.ts · lib/skills/*
   │
lib/question-engine/*  (completeness-engine, question-catalog, prioritizer, planner)  ← PURE, no I/O
   │                                             │
lib/repositories/*  (Store interface)     lib/ai/*  (AIProvider: mock ⇆ anthropic)
   │                                             │
Supabase (Postgres + Auth + RLS)          @anthropic-ai/sdk (server-only)
```

**Two-layer questioning:**
1. `completeness-engine.ts` (deterministic, no LLM) decides *which* sections/fields
   are eligible and computes the `CompletenessReport` + readiness.
2. `adaptive-planner.ts` picks and personalizes a question from catalog-derived
   candidates. `questionId`, `inputType`, `required`, `allowSkip`, and
   `nextAction` come from the **catalog**, never the model.

**Provider split (cost control):** Claude always handles **résumé generation +
analysis** (`ai`, the end of the funnel and each regenerate). The **funnel
provider** (`getFunnelProvider()`, exposed as `funnelAi`) is cost-aware:
- `AI_PROVIDER=mock` → a pure `MockAIProvider` (offline, tests, zero tokens).
- `AI_PROVIDER=anthropic` → a `HybridAIProvider` (`lib/ai/hybrid-provider.ts`) that
  sends the *narrative* capture that most affects résumé quality to Claude —
  `normalizeAnswer` for the rich sections (`experience`, `projects`, `languages`,
  `achievements`, `certifications`) and `extractInterests` — while keeping cheap
  ops (question planning, skill inference, simple-field normalization:
  name/contact/career goal/education) on the deterministic mock.

Because prompts drive model output shape, any prompt that returns JSON must
enumerate the **exact** schema field names + enum values (see
`buildResumeGenerationPrompt` / `buildNormalizerPrompt`); the corresponding Zod
schemas add a tolerant `z.preprocess` for common container-name drift
(`id`→`entryId`, `skills`→`skillIds`, `extractedData`→`updates`). Claude models
emit a `thinking` block that counts against `max_tokens`, so funnel/generation
calls use generous ceilings to avoid truncation.

### Key modules

| Path | Responsibility |
| --- | --- |
| `types/` | Domain model + `ResumeProfileState` (model-safe, PII-redacted) |
| `lib/env.ts` | Zod-validated, `server-only` config. Secrets never reach the client |
| `lib/repositories/` | `Store` interface + `MemoryStore` (dev/tests) + `SupabaseStore` |
| `lib/profile-state.ts` | Assembles `ResumeProfileState`, redacts PII, computes completeness |
| `lib/question-engine/` | completeness · catalog · prioritizer · adaptive planner |
| `lib/ai/` | `AIProvider` abstraction, `MockAIProvider`, `AnthropicProvider`, prompts, **Zod schemas** |
| `lib/skills/` | evidence-backed inference + confirm/reject/edit lifecycle |
| `lib/services/answer-pipeline.ts` | the spec §9 answer pipeline |
| `lib/resume/` | generator · HTML renderer · PDF (puppeteer) · source tracing · **analyzer** (improvement loop) · **proofreader** (final spelling/grammar/format pass before finalize) |
| `lib/analytics/` | Amplitude (HTTP API) with PII allow-list; no-op when unconfigured |
| `lib/services/funnel-telemetry.ts` | Records a question as *shown* (event + `QuestionState.lastShownQuestionId`) so funnel exit points are visible — see `docs/funnel-analytics.md` |
| `supabase/migrations/` | SQL schema + RLS |

## Coding conventions

- TypeScript `strict` + `noUncheckedIndexedAccess`. `tsc --noEmit` must pass.
- Domain field names are English camelCase; user-facing strings are Spanish.
- Route handlers stay thin: resolve context → validate body (Zod) → call a
  service → return via `ok`/`created`. Wrap bodies in `handleRoute` for consistent
  error envelopes: `{ data }` on success, `{ error: { code, message, details? } }` on error.
- Services accept dependencies (`store`, `ai`, `analytics`) as parameters (DI) so
  they are testable without Next/Supabase.
- Never import `lib/env`, `lib/supabase`, `lib/ai` (index), or `lib/analytics`
  from pure domain code — they are `server-only`. Pure engines import only `types`.

## Safety rules (enforced in CODE, not just prompts)

- Inferred skills are **always** created with status `suggested`; only an explicit
  user action makes them `confirmed`/`edited` (`lib/skills/`).
- Résumé generation reads only `confirmed`/`edited` skills and
  `confirmed`/`edited` entries; every generated bullet is **source-traced** and
  untraceable model output is dropped (`lib/resume/source-tracing.ts`).
- Prohibited inferences (leadership/management without evidence, language fluency,
  suggestions without evidence) are filtered in `isProhibitedSuggestion`.
- Approximate values are preserved verbatim; raw user wording is kept
  (`ConversationTurn.userAnswer`, `ExperienceEntry.rawDescription`).
- All AI output is validated with Zod before use (`lib/ai/schemas.ts`); the model
  can never return code/SQL/HTML through these shapes.
- Analytics never receives raw answers/PII — only allow-listed keys
  (`lib/analytics/events.ts`).
- We never request or store age, photo, marital status, religion, race, health,
  SSN, or immigration status.

## Database rules

- Every table has **RLS** enabled; a user can only touch rows under their own
  `resume_profiles`. `SupabaseStore` relies on RLS as defense-in-depth.
- Domain code touches the DB only through the `Store` interface — never raw SQL.
- The service-role key bypasses RLS and is **server-only** (used only for user
  provisioning). Schema changes go in a new `supabase/migrations/NNNN_*.sql`.

## AI factuality requirements

See `lib/ai/prompts.ts` → `SYSTEM_FACTUALITY` (used on every résumé-related call).
Use only user-provided/confirmed facts; never invent employers, titles, dates,
degrees, certifications, tools, or metrics; ask a follow-up when a critical fact
is missing; improve wording without changing meaning; return valid JSON only.

## Testing expectations

- **Unit** (`tests/unit/`, Vitest): completeness, prioritization, no-repeat/skip,
  skill status/confirm/reject, prohibited inference, readiness, generation from
  confirmed-only data, no-invented-facts, AI schema validation, analytics scrubbing.
- **E2E** (`tests/e2e/`, Playwright): the seven flows in spec §19, driven through
  the API against a production build in mock/memory mode.
- Always mock the AI provider in tests (`MockAIProvider`) — it obeys the same
  safety invariants and validates its own output against the shared Zod schemas.
- `tsc --noEmit`, `vitest run`, and `playwright test` must all pass before done.

## Commands

```bash
npm install                # install deps
npm run dev                # dev server (http://localhost:3000)
npm run build && npm start  # production build + serve
npm run typecheck          # tsc --noEmit
npm test                   # unit tests (vitest)
npm run test:e2e           # e2e tests (playwright; builds + starts the app)
npm run lint               # next lint
```

**Online-only:** this app cannot run offline. `AI_PROVIDER=mock` and
`PERSISTENCE=memory` are rejected at startup (`ONLINE_ONLY` in `lib/env.ts`), and
a runtime connectivity guard (`lib/connectivity.ts`, wired into `middleware.ts`)
returns **503** on every request when the host has no network. You must set
`AI_PROVIDER=anthropic` (+ `ANTHROPIC_API_KEY`) and `PERSISTENCE=supabase`
(+ Supabase URL/keys) — see `.env.example`. PDF export requires `puppeteer`
(installed). Note: this intentionally breaks the mock/memory-based unit + e2e
tests as written (flip `ONLINE_ONLY` to `false` to restore offline test runs).

## Configuration (env)

All via environment variables; never commit secrets. See `.env.example`.
`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AMPLITUDE_API_KEY`,
`PERSISTENCE`.

## Out of scope (do not add in milestone 1)

Job applications, job matching, cover letters, interview simulation, LinkedIn
publishing, and decorative multi-template themes. (A minimal React UI + Supabase
email/password auth now exist; a polished, design-faithful UI is future work.)
