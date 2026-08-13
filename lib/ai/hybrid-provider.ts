import "server-only";
import type { ResumeSection } from "@/types";
import type {
  AIProvider,
  AnalyzeResumeParams,
  ExtractInterestsParams,
  NormalizeAnswerParams,
  PlanQuestionParams,
  ProofreadResumeParams,
  ResumeGenerationInput,
  SuggestSkillsParams,
} from "./provider";
import type {
  AnswerNormalization,
  InterestsExtraction,
  PlannerDecision,
  ProofreadResult,
  ResumeAnalysisPayload,
  ResumeContent,
  SuggestedSkillPayload,
} from "./schemas";

/**
 * Funnel sections whose free-text answers are narrative/structured enough to
 * benefit from real LLM parsing (e.g. "English and Spanish, perfectly" →
 * structured languages with levels). Simple/structured sections (name, contact,
 * career goal, education, certifications) stay on the deterministic parser.
 */
const RICH_CAPTURE_SECTIONS = new Set<ResumeSection>([
  "experience",
  "projects",
  "languages",
  "achievements",
  "certifications",
  /*
   * Education belongs here, despite looking like a "simple field".
   *
   * One answer routinely contains a level, a school and a subject — "Terminé la
   * secundaria en el Colegio Nacional y estudié seis meses de administración" — and
   * the deterministic parser cannot split that: it dropped the WHOLE sentence into
   * `credential` and left `institution` and `fieldOfStudy` null. The résumé then
   * showed a run-on heading and no school at all, which is not a rendering problem
   * but a capture one. Splitting a narrative into fields is exactly what the model
   * is for; with thinking off and low effort it is one of the cheapest calls we make.
   */
  "education",
]);

/**
 * Questions inside a rich section whose answers still carry NO narrative, and so
 * have nothing for Claude to interpret. Routing by section alone sent these to
 * Claude purely for belonging to `experience`:
 *
 *  - `experience_type_counts` — a machine-written JSON payload of counts per type
 *    (`{"caregiving":2}`), built by the counter UI, not typed by a person.
 *  - `experience_dates` — a date, now asked once per experience. The deterministic
 *    parser and `lib/experience-dates.ts` already own every format this product
 *    accepts, and they are what orders the résumé.
 *
 * With four experiences that is five of roughly eleven experience calls removed
 * per résumé, at no cost to quality: there is no wording here to improve.
 */
const MECHANICAL_QUESTION_IDS = new Set([
  "experience_type_counts",
  "experience_dates",
  "education_dates",
]);

/**
 * Cost-aware funnel provider used when AI_PROVIDER=anthropic. It routes the
 * per-answer capture that most affects résumé quality to Claude (`capable`) and
 * keeps cheap/deterministic operations (question planning, skill inference,
 * simple-field normalization) on the mock (`deterministic`). Résumé generation
 * and analysis always use Claude.
 */
export class HybridAIProvider implements AIProvider {
  readonly name = "hybrid";

  constructor(
    private readonly capable: AIProvider,
    private readonly deterministic: AIProvider,
  ) {}

  planNextQuestion(params: PlanQuestionParams): Promise<PlannerDecision> {
    return this.deterministic.planNextQuestion(params);
  }

  normalizeAnswer(params: NormalizeAnswerParams): Promise<AnswerNormalization> {
    // Question id wins over section: a mechanical answer inside a rich section
    // still has nothing worth paying Claude to read.
    const rich =
      RICH_CAPTURE_SECTIONS.has(params.section) && !MECHANICAL_QUESTION_IDS.has(params.questionId);
    return (rich ? this.capable : this.deterministic).normalizeAnswer(params);
  }

  suggestSkills(params: SuggestSkillsParams): Promise<SuggestedSkillPayload[]> {
    return this.deterministic.suggestSkills(params);
  }

  extractInterests(params: ExtractInterestsParams): Promise<InterestsExtraction> {
    return this.capable.extractInterests(params);
  }

  generateResumeContent(input: ResumeGenerationInput): Promise<ResumeContent> {
    return this.capable.generateResumeContent(input);
  }

  analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisPayload> {
    return this.capable.analyzeResume(params);
  }

  proofreadResume(params: ProofreadResumeParams): Promise<ProofreadResult> {
    return this.capable.proofreadResume(params);
  }
}
