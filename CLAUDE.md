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
> `components/*`) that consumes those APIs so the product is
> usable end-to-end. The UI is intentionally lean — a fuller build should follow the
> Pencil design.

## Architecture

Dependencies point downward; the domain never imports infrastructure.

```
middleware.ts  (online guard → brand resolution → Supabase session refresh)
   │
app/layout.tsx  (brand fonts + inlined :root theme + BrandProvider + header)
   │
app/api/*  (route handlers: auth → validate → service → typed JSON)
   │
lib/services/answer-pipeline.ts · lib/resume/resume-generator.ts · lib/skills/*
   │
lib/question-engine/*  (completeness-engine, question-catalog, prioritizer, planner)  ← PURE, no I/O
   │                                             │
lib/repositories/*  (Store)  ·  lib/storage/*  (ResumeFileStore)   lib/ai/*  (AIProvider: mock ⇆ azure)
   │                                             │
Supabase (Postgres + Auth + RLS)          openai SDK → Azure OpenAI (server-only)
```

**Progress bar:** the number the user watches is `state.funnelProgress`
(`lib/question-engine/funnel-progress.ts`), **not**
`completeness.overallScore`. `overallScore` is a data-quality score — a weighted
average over five buckets — and it made a bad bar three ways: most funnel
questions land in an already-saturated bucket or inside `background`, which is a
`max()`, so it *stalled* (three consecutive questions moved it 0 points); the
education/experience buckets *average* over entries, so adding one moved it
*backwards*; and readiness fires while the optional buckets are empty, so
finishing the funnel left it in the seventies. `funnelProgress` measures questions
handled over questions handled plus questions left, against the same
`eligibleQuestions` pool the funnel itself follows. It reaches 100 only at a
terminus — the funnel running out of questions, or a résumé being generated
(`runGeneration`, for the user who becomes ready early and generates with optional
questions outstanding). `overallScore` keeps its old jobs: readiness, the review
dashboard, and the model prompt.

`estimateFunnelProgress` is pure and may dip when an answer opens follow-ups;
`assembleProfileState` floors it at the persisted value and `advanceFunnelProgress`
(write side, once per answer in the pipeline) guarantees at least a point of
movement, so the bar is monotone and never parks.

**Two-layer questioning:**
1. `completeness-engine.ts` (deterministic, no LLM) decides *which* sections/fields
   are eligible and computes the `CompletenessReport` + readiness.
2. `adaptive-planner.ts` picks and personalizes a question from catalog-derived
   candidates. `questionId`, `inputType`, `required`, `allowSkip`, and
   `nextAction` come from the **catalog**, never the model.

**Provider split (cost control):** the paid model always handles **résumé
generation + analysis** (`ai`, the end of the funnel and each regenerate). The
**funnel provider** (`getFunnelProvider()`, exposed as `funnelAi`) is cost-aware:
- `AI_PROVIDER=mock` → a pure `MockAIProvider` (offline, tests, zero tokens).
- `AI_PROVIDER=azure` → a `HybridAIProvider` (`lib/ai/hybrid-provider.ts`) that
  sends the *narrative* capture that most affects résumé quality to the model —
  `normalizeAnswer` for the rich sections (`experience`, `projects`, `languages`,
  `achievements`, `certifications`, `education`) and `extractInterests` — while
  keeping cheap ops (question planning, skill inference, simple-field
  normalization: name/contact/career goal) on the deterministic mock. Individual
  question ids can opt back out of the model inside a rich section when the answer
  carries no narrative (`MECHANICAL_QUESTION_IDS`: the experience counter payload,
  and the experience/education date answers).

**The AI backend is Azure OpenAI** (`lib/ai/azure-openai-provider.ts`), reached with
the stock `openai` SDK pointed at the resource's **v1** endpoint
(`…/openai/v1`) — that surface speaks plain OpenAI wire format, so there is no
`api-version` parameter and no Azure-specific client. Requests use the **Responses**
API, the only surface the `*-codex` models are served on, and pass `store: false` so
the résumé text is not retained server-side. Cost is controlled per operation via
`reasoning.effort`: `none` for mechanical extraction (verified 0 reasoning tokens),
`high` for résumé generation, `medium` for the critique. Prompt caching is automatic
on this platform — no cache markers — which is why stable instructions go in
`instructions` and the variable input in `input`.

Because prompts drive model output shape, any prompt that returns JSON must
enumerate the **exact** schema field names + enum values (see
`buildResumeGenerationPrompt` / `buildNormalizerPrompt`); the corresponding Zod
schemas add a tolerant `z.preprocess` for common container-name drift
(`id`→`entryId`, `skills`→`skillIds`, `extractedData`→`updates`). Reasoning tokens
count against `max_output_tokens`, so funnel/generation calls use generous ceilings
to avoid truncation, and a truncated reply is retried with *more* room rather than
the same ceiling.

### Key modules

| Path | Responsibility |
| --- | --- |
| `types/` | Domain model + `ResumeProfileState` (model-safe, PII-redacted) |
| `lib/env.ts` | Zod-validated, `server-only` config. Secrets never reach the client |
| `lib/brand/` | multi-brand system: configs · registry · pure host resolution · `:root` theme emitter · server/client accessors |
| `components/marketing/` | branded surfaces: shared hero + per-brand headers, dispatched via a registry |
| `lib/repositories/` | `Store` interface + `MemoryStore` (dev/tests) + `SupabaseStore` |
| `lib/storage/` | `ResumeFileStore` interface + `MemoryResumeFileStore` + Supabase Storage impl — one saved résumé PDF per improvement round |
| `lib/profile-state.ts` | Assembles `ResumeProfileState`, redacts PII, computes completeness |
| `lib/question-engine/` | completeness · catalog · prioritizer · adaptive planner · funnel progress |
| `lib/ai/` | `AIProvider` abstraction, `MockAIProvider`, `AzureOpenAIProvider`, prompts, **Zod schemas** |
| `lib/skills/` | evidence-backed inference + confirm/reject/edit lifecycle |
| `lib/services/answer-pipeline.ts` | the spec §9 answer pipeline |
| `lib/resume/` | generator · HTML renderer · PDF (two renderers: puppeteer local, `@sparticuz/chromium` serverless) · **artifact writer** (saves the PDF on every generation) · source tracing · **analyzer** (improvement loop) · **proofreader** (final spelling/grammar/format pass before finalize) |
| `lib/analytics/` | Amplitude (HTTP API) with PII allow-list; no-op when unconfigured |
| `lib/services/funnel-telemetry.ts` | Records a question as *shown* (event + `QuestionState.lastShownQuestionId`) so funnel exit points are visible — see `docs/funnel-analytics.md` |
| `lib/repositories/funnel-entities.ts` | entity construction shared by every `Store` impl, so `MemoryStore` and `SupabaseStore` cannot drift on defaults |
| `supabase/migrations/` | SQL schema + RLS |

## Brand system (multi-brand, one repo)

The app serves **two marketing brands from one build**: `rumbo-latino` (warm,
learner-facing, rumbolatino.com) and `aprende` (Aprende Institute — formal,
institutional). See
`docs/branding.md` for the design and `docs/switching-brands.md` for the operator
runbook; the rules that constrain code:

- **Only marketing is branded.** Palette, typography, header, landing hero,
  metadata and marketing copy. The funnel, question engine, AI orchestration,
  `Store` and analytics are shared and brand-agnostic. **The generated résumé is
  deliberately NOT themed** — it is the user's document, so
  `lib/resume/resume-renderer.ts` keeps its own neutral print palette.
- **The brand is chosen from the request host**, resolved once in `middleware.ts`
  and stamped on `x-brand`. Precedence: `?brand=` → cookie →
  `BRAND_HOST_OVERRIDES` → host match → `DEFAULT_BRAND` → `rumbo-latino`.
  `lib/brand/resolve.ts` is pure and holds the rules. The brand gates styling and
  copy only — never data access, never a permission. Note `DEFAULT_BRAND` sits
  *below* the host match: it cannot flip a domain a brand already claims (that is
  what `BRAND_HOST_OVERRIDES` is for), and an unregistered value throws rather than
  falling back silently.
- **`BrandConfig` is pure, serializable data** (`lib/brand/brands/*.ts`): no React,
  no `next/*`, no `server-only`, no I/O. That is what lets edge middleware,
  Server Components and Client Components all read the same object. Per-brand
  *components* are registered separately in `components/marketing/registry.tsx`,
  so configs never depend on the UI layer.
- **`tailwind.config.ts` contains no brand colours.** Every token resolves to
  `rgb(var(--c-…) / <alpha-value>)`, filled in by the `:root` block that
  `app/layout.tsx` inlines. Adding a brand touches no CSS and no shared component.
- **Tokens are semantic, not literal** — `accent`, `text-primary`, `border`; never
  `coral` or `plum`. Product components must use only semantic tokens. The literal
  values (`brand-strong`, `brand-mark`, `brand-support`) are for the marketing
  layer alone.
- **Contrast is enforced, not hoped for.** `tests/unit/brand-theme.test.ts` asserts
  WCAG AA (4.5:1) for every registered brand. Five Rumbo Latino pairs sit below AA
  — its white-on-coral CTA label (2.73:1) and its secondary grey — because those
  are rumbolatino.com's own values and brand fidelity was chosen over contrast by
  the product owner. They are *pinned* per brand and per pair, so they cannot
  widen and a new brand inherits no exemption. See `KNOWN_BELOW_AA` and
  `docs/branding.md`.
- **Reuse first, fork deliberately.** Prefer a shared config-driven component with
  a layout variant (`MarketingHero` serves both brands). Register a per-brand
  component only when one component would need a flag per visual decision (the two
  headers). A registered component must be presentational — `brand` as a prop, no
  server APIs.
- **Adding a brand** = a config file + one line in `lib/brand/registry.ts` + fonts
  in `app/fonts.ts` + assets in `public/brands/<id>/` (icons included — there is no
  `app/icon.*` convention file, since it would compete with the per-brand ones). `BrandId` is derived from the
  registry keys, so every `Record<BrandId, …>` becomes a compile error until the new
  brand is handled. The brand tests then cover it automatically.

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

## No accounts (no login, no sign-up)

The product never asks anyone for a password. A visitor reads the hero, presses the
CTA and is in the funnel; the identity the database needs is created *for* them.

- **`resolveUserId()` (`lib/auth.ts`) is the whole mechanism.** It returns the
  session's user when there is one, and otherwise **starts a guest session**:
  `signInAnonymously()` first, falling back to a service-role-provisioned account
  with random, never-stored credentials for projects that have anonymous sign-ins
  disabled. Either way the browser carries the normal Supabase session cookies.
- **The data model did not change.** A guest is a real `auth.users` row, so
  `funnel.user_id`'s foreign key, every `auth.uid()` RLS policy and the Storage
  folder rule all keep working untouched — per-user isolation is still enforced by
  Postgres, not by the absence of a login screen.
- **Mint the guest in a route handler only.** A Server Component cannot set cookies
  (`lib/supabase/server.ts` swallows the throw), so a session created there would not
  persist and every request would mint another guest — and another résumé. This is why
  `getRequestContext` is the only caller, and why middleware refreshes sessions but
  never creates them.
- **The cookie is the only handle on a résumé.** Clearing site data or switching
  device starts a fresh one; there is deliberately no recovery flow, because there is
  no identity left to prove ownership with. Accept that trade or add real accounts —
  do not add a half-way "enter your email to recover" path.
- **Operationally** this needs *either* "Allow anonymous sign-ins" enabled on the
  Supabase project (Authentication → Sign In / Providers) *or*
  `SUPABASE_SERVICE_ROLE_KEY` set. With neither, every request fails with a logged
  configuration error.
- There is no `/login` route, no sign-out, and no browser-side Supabase client. Do
  not reintroduce one; a 401 from the API is now a bug, not a prompt to log in.

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

## Saved résumé PDFs

Every generation renders a PDF and **replaces the one stored for its improvement
round**, so a user always has a current file, a download is a storage read rather
than a Chromium launch, and the rounds accumulate into a history you can open in
order to see the résumé improve (`0006_resume_pdf_storage.sql` created the bucket;
`0008_resume_pdf_per_stage.sql` introduced the per-round layout).

- **One object per round**, in the private `resumes` bucket, written with `upsert`:
  `<user_id>/<resume_profile_id>/curriculum.pdf` for the initial generation and
  `…/iteration-N.pdf` after round N. At most four per profile, since
  `MAX_RESUME_ITERATIONS` is 3. Stage 0 keeps the name `curriculum.pdf` so the
  objects written before 0008 are not orphaned.
- **`GeneratedResume.stage` is the ROUND, not the version.** It is derived in
  `resolveStage` (`lib/resume/resume-generator.ts`) as `iteration + 1` — the same
  expression `POST /iterations` uses to pick a table — which is what makes the PDF
  at stage N and the answers in `iteration_N` the same round. Deriving it from the
  version instead would let a mid-round `regenerate-section` or `proofread` consume
  the next round's object; those re-render the round on file (`proofreadAndRerender`
  passes `stage: resume.stage` explicitly).
- **Storage growth is bounded by the round cap, not by regenerations.** Within a
  round every write overwrites, so a user who regenerates twenty times still holds
  four PDFs. A PDF *per version* would be unbounded and would multiply PII at rest
  for no user-facing gain.
- **The user id must stay the first path segment** — the Storage RLS policies
  authorize on `(storage.foldername(name))[1] = auth.uid()`. Pinned by
  `tests/unit/resume-pdf-storage.test.ts`, along with the per-round file names.
- **The save is best-effort and never throws.** A PDF is derived data; losing a
  finished résumé because Chromium hiccuped would be far worse than a missing file
  the download path re-renders (and back-fills) anyway. Failures are logged and
  visible as the gap between `resume_generated` and `resume_pdf_stored`.
- **The seam is `ResumeArtifactWriter`** (`lib/resume/resume-artifacts.ts`), injected
  into `generateResume` / `proofreadAndRerender` — the only two functions that create
  a résumé. Enforcing it there rather than in each of the four routes is what makes
  "every generation replaces its round's PDF" true by construction. It also stamps
  the path onto every `iteration_N` row of the round (`setIterationResumePdf`), which
  is what makes the history browsable from the table. The parameter is optional so
  unit tests run without Chromium; routes always pass `resumeArtifacts` from the
  request context.
- The render runs **inside the generation lock**, so concurrent requests cannot race
  to overwrite a round's stored file with different versions.

## PDF rendering (two browsers, one interface)

`lib/resume/pdf-generator.ts` has two implementations of `PdfGenerator`, chosen by
runtime — not by `NODE_ENV`:

- **`PuppeteerPdfGenerator`** — full `puppeteer`, which downloads its own Chromium
  (~300 MB on disk). A **devDependency**: local development, CI, and any
  self-hosted server with a real filesystem.
- **`ServerlessPdfGenerator`** — `puppeteer-core` + `@sparticuz/chromium`, a
  Brotli-compressed Chromium built for Lambda-style runtimes. Vercel.

Why both are necessary: a Vercel function is capped at **250 MB uncompressed** and
full Chromium alone exceeds it, so that bundle can never contain it. Independently,
`puppeteer`'s postinstall — the step that fetches Chromium — is an install script,
and npm now skips those unless approved, so on Vercel the browser was never
downloaded either. Both failures are **silent**: `ResumeArtifactWriter` is
best-effort, so generation still looked fine and only the download surfaced it, at
the very last step of the product.

Rules that follow:

- **`resolvePdfRenderer` keys off the RUNTIME** (`VERCEL`, `AWS_LAMBDA_FUNCTION_VERSION`),
  overridable with `PDF_RENDERER=local|serverless`. `NODE_ENV=production` is not the
  signal — a container in production should use the full browser.
- **The two Chromium majors must match their client.** `puppeteer-core` and
  `@sparticuz/chromium` are both pinned to **148**; a protocol mismatch fails at
  render time, not at build time. Bump them together.
- **Launch flags come from `@sparticuz/chromium`, per its own version's README.**
  148 removed `chromium.headless` and `chromium.defaultViewport`, so the
  headless-**shell** flags are merged via `puppeteer.defaultArgs({ args, headless:
  "shell" })`. Check the installed README before changing this.
- **`@sparticuz/chromium` must stay in `serverComponentsExternalPackages`**
  (`next.config.mjs`) so its `bin/*.br` archives are traced as files instead of
  bundled. The traced `export-pdf` function is ~86 MB with it.
- **Every route that can render a PDF sets `maxDuration = 60` and `runtime =
  "nodejs"`** — generate, regenerate-section, proofread, export-pdf. A Chromium
  cold start plus a model call exceeds Vercel's 10s default.
- The serverless path **cannot be launch-tested off Linux**, so
  `tests/unit/pdf-renderer-selection.test.ts` pins the selection logic and asserts
  both packages resolve with the API the launch code uses. That is the guard against
  a deploy-only break.

## Database schema (4 tables)

```
funnel        one row per résumé — profile columns + the eight capture sections,
              the funnel Q&A and the question state, all as JSONB, plus the
              CURRENT generated résumé (resume_id/_content/_html/_version/
              _stage/_pdf)
iteration_1   \
iteration_2    >  the improvement round's questions and answers, each row also
iteration_3   /   naming the PDF that round produced (resume_pdf)
```

`0007_simplified_schema.sql` collapsed 13 tables into five;
`0008_resume_pdf_per_stage.sql` dropped `resume_pdfs` for the fifth. The rules that
follow:

- **There is exactly ONE generated résumé per profile**, on the `funnel` row.
  `resume_pdfs` was named for its path column but was really the résumé table
  (`content` + `html` are what the CV page, preview, analyzer, proofreader and
  download all read) and was joined 1:1 in every path that touched it, so it became
  columns. `getGeneratedResume(id)` therefore answers "is `id` still the current
  résumé?" — and `updateGeneratedResume` filters on `resume_id`, so a late PDF write
  from a superseded generation finds no row instead of clobbering a newer path.
- **`resume_version` counts generations; `resume_stage` is the round.** A proofread
  or section regeneration bumps the version without claiming a round. See **Saved
  résumé PDFs** above.
- **Dropping `resume_pdfs` gave up per-version content history.** What survives per
  round is the rendered PDF, not diffable JSON. That was the accepted trade for
  per-round history at bounded PII.
- **JSONB columns hold DOMAIN objects verbatim** — camelCase, exactly the shapes in
  `types/domain.ts`. What the Supabase editor shows is what the app sees, and there
  is no row↔domain mapping layer to keep in sync.
- **Entity defaults live in `lib/repositories/funnel-entities.ts`**, shared by both
  stores. That is what keeps the safety invariant structural: a skill is built
  `suggested`, so no store can default it to `confirmed`.
- **Editing one entry rewrites its array.** `SupabaseStore` does that
  read-modify-write under an optimistic `revision` guard and retries a lost race.
  Never bypass it with a raw update — a concurrent edit would be lost.
- **Entry lookups by id use JSONB containment**, backed by the GIN indexes the
  migration creates — and the filter value must be a **pre-serialized JSON
  string**: `.contains(column, JSON.stringify([{ id }]))`. Passing the array
  itself encodes as a Postgres *array* literal (`postgrest-js` does
  `value.join(',')`), which sends `cs.{[object Object]}` and fails every call with
  "invalid input syntax for type json". Both stores are exercised by unit tests on
  `MemoryStore`, so only `tests/unit/supabase-entry-lookup.test.ts` guards this.
- **Postgres no longer validates entry shape.** There are no per-entry FKs or CHECKs
  inside the JSONB; TypeScript and the Zod schemas at the AI boundary are the
  enforcement. The invariants that matter were always in code (`lib/skills/`,
  `lib/resume/source-tracing.ts`).
- **`MAX_RESUME_ITERATIONS` must stay 3** — there is one table per round, so a
  different cap would address a table that does not exist
  (`tests/unit/iterations.test.ts` pins this).
- **The improvement-round counter is server state** (`funnel.iteration`), enforced by
  `POST /generate`. It used to be localStorage, where clearing site data reset it.
- The `iteration_N` rows are an **audit log**: the answers are applied to `funnel`
  through the normal pipeline, so deleting one loses the record, not résumé content.
  Their `resume_pdf` is the exception worth knowing — it is the only pointer to the
  round's PDF, so deleting the rows orphans those bytes in the bucket.
- `users` is gone; `funnel.user_id` references `auth.users` directly.

## Database rules

- Every table has **RLS** enabled; a user can only touch rows under their own
  `funnel` row. `SupabaseStore` relies on RLS as defense-in-depth.
- Domain code touches the DB only through the `Store` interface — never raw SQL.
- The service-role key bypasses RLS and is **server-only** (used only for user
  provisioning). Schema changes go in a new `supabase/migrations/NNNN_*.sql`, and
  are appended to `supabase/apply_all.sql` for fresh-project setup.
- **Storage** follows the same rule: the `resumes` bucket is private and its
  `storage.objects` policies restrict every operation to the caller's own folder.
  Binary artifacts go through the `ResumeFileStore` interface, never a raw client.

## AI factuality requirements

See `lib/ai/prompts.ts` → `SYSTEM_FACTUALITY` (used on every résumé-related call).
Use only user-provided/confirmed facts; never invent employers, titles, dates,
degrees, certifications, tools, or metrics; ask a follow-up when a critical fact
is missing; improve wording without changing meaning; return valid JSON only.

## Testing expectations

- **Unit** (`tests/unit/`, Vitest): completeness, prioritization, no-repeat/skip,
  skill status/confirm/reject, prohibited inference, readiness, generation from
  confirmed-only data, no-invented-facts, AI schema validation, analytics scrubbing,
  brand resolution precedence, and per-brand palette completeness + WCAG contrast.
- **E2E** (`tests/e2e/`, Playwright): the seven flows in spec §19, driven through
  the API against a production build in mock/memory mode.
- Always mock the AI provider in tests (`MockAIProvider`) — it obeys the same
  safety invariants and validates its own output against the shared Zod schemas.
- `tsc --noEmit` and `vitest run` must pass before done. `playwright test` must too
  whenever it can run — while `ONLINE_ONLY` is `true` it cannot boot its mock-mode
  server, so e2e coverage is only meaningful with that flag flipped.

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
`AI_PROVIDER=azure` (+ `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`) and
`PERSISTENCE=supabase` (+ Supabase URL/keys) — see `.env.example`. PDF export
requires a browser — see **PDF rendering** above. Note: this intentionally breaks the **e2e** suite,
which boots the app with `AI_PROVIDER=mock` + `PERSISTENCE=memory` (see
`playwright.config.ts`) — flip `ONLINE_ONLY` to `false` to run it. The **unit** suite
is unaffected: it injects `MockAIProvider`/`MemoryStore` directly and never parses the
environment, so `vitest run` passes as-is.

## Configuration (env)

All via environment variables; never commit secrets. See `.env.example`.
`AI_PROVIDER`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_MODEL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AMPLITUDE_API_KEY`, `PERSISTENCE`, `PDF_RENDERER`,
`DEFAULT_BRAND`, `BRAND_HOST_OVERRIDES`.

## Out of scope (do not add in milestone 1)

Job applications, job matching, cover letters, interview simulation, LinkedIn
publishing, and decorative multi-template themes. (A minimal React UI exists, with no
login at all — see "No accounts" above; a polished, design-faithful UI is future
work.
Note: the **brand** system is not a "theme" system — it swaps marketing identity
per host, not résumé templates, which remain single and neutral.)
