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
    const provider = RICH_CAPTURE_SECTIONS.has(params.section) ? this.capable : this.deterministic;
    return provider.normalizeAnswer(params);
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
