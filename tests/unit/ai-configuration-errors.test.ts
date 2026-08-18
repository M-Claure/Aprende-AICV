/**
 * A misconfigured server must not look like a misbehaving model.
 *
 * An invalid key, a key without access to the deployment, a deployment name that
 * does not exist, or a request the deployment rejects outright all fail on every
 * attempt. Retrying them burns three API calls and then reports "La IA no devolvió
 * una respuesta válida" — which points whoever is debugging at prompts and Zod
 * schemas instead of at the config.
 */
import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureOpenAIProvider } from "@/lib/ai/azure-openai-provider";
import { isAppError } from "@/lib/errors";
import { experienceState, personalState } from "../helpers/factories";
import { computeCompleteness } from "@/lib/question-engine/completeness-engine";
import { completenessInput } from "../helpers/factories";
import type { ResumeProfileState } from "@/types";

const BASE_URL = "https://example-resource.cognitiveservices.azure.com/openai/v1";

function state(): ResumeProfileState {
  const base = completenessInput({
    careerGoal: "Asistente administrativa",
    personalInformation: personalState({ firstName: "María", hasEmail: true }),
    experience: [experienceState({ rawDescription: "Ayudaba en el negocio" })],
  });
  return { ...base, completeness: computeCompleteness(base) };
}

/** Replaces the provider's SDK client with one whose every call throws `err`. */
function providerThatThrows(err: unknown, model = "gpt-5.3-codex") {
  const provider = new AzureOpenAIProvider("azure-test-key", BASE_URL, model);
  const create = vi.fn().mockRejectedValue(err);
  // `client` is TypeScript-private only; swapping it is how we exercise the
  // failure mapping without making a network call.
  (provider as unknown as { client: { responses: { create: unknown } } }).client = {
    responses: { create },
  };
  return { provider, create };
}

const apiError = (Ctor: new (...a: never[]) => Error, status: number, type: string) =>
  new (Ctor as unknown as new (
    status: number,
    error: unknown,
    message: string,
    headers: undefined,
  ) => Error)(status, { error: { type, message: "boom" } }, "boom", undefined);

const normalizeParams = () => ({
  section: "experience" as const,
  questionId: "experience_type_counts",
  questionText: "¿Qué tipos de experiencia has tenido?",
  rawAnswer: JSON.stringify({ caregiving: 2 }),
  state: state(),
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("configuration failures fail fast", () => {
  it("maps an invalid API key to service_unavailable after ONE attempt", async () => {
    const { provider, create } = providerThatThrows(
      apiError(OpenAI.AuthenticationError, 401, "invalid_api_key"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(provider.normalizeAnswer(normalizeParams())).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && err.code === "service_unavailable",
    );
    // The point of the change: no retry storm on an unfixable error.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("names the real cause in details, not in the user-facing message", async () => {
    // Azure answers an unknown deployment with 404 DeploymentNotFound, so this is
    // also what a typo'd AZURE_OPENAI_MODEL looks like from here.
    const { provider } = providerThatThrows(
      apiError(OpenAI.NotFoundError, 404, "DeploymentNotFound"),
      "gpt-does-not-exist",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await provider.normalizeAnswer(normalizeParams());
      throw new Error("should have thrown");
    } catch (err) {
      if (!isAppError(err)) throw err;
      // User-facing copy stays simple Spanish and blames nobody.
      expect(err.message).not.toContain("AZURE_OPENAI_MODEL");
      expect(err.message.toLowerCase()).toContain("servicio de ia");
      // The diagnosis lives in details + the server log.
      expect(JSON.stringify(err.details)).toContain("gpt-does-not-exist");
      expect(JSON.stringify(err.details)).toContain("AZURE_OPENAI_MODEL");
    }
  });

  it("maps a key without deployment access to service_unavailable", async () => {
    const { provider, create } = providerThatThrows(
      apiError(OpenAI.PermissionDeniedError, 403, "permission_error"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(provider.normalizeAnswer(normalizeParams())).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && err.code === "service_unavailable",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails fast on a rejected request instead of retrying it three times", async () => {
    // A 400 is a request this deployment will never accept — an unsupported
    // reasoning effort, an unknown parameter, blocked input. Retrying it identically
    // just bills three times for the same rejection.
    const { provider, create } = providerThatThrows(
      apiError(OpenAI.BadRequestError, 400, "invalid_request_error"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(provider.normalizeAnswer(normalizeParams())).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && err.code === "service_unavailable",
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("transient failures still retry", () => {
  it("retries a rate limit three times, then reports an AI validation error", async () => {
    const { provider, create } = providerThatThrows(
      apiError(OpenAI.RateLimitError, 429, "rate_limit_exceeded"),
    );

    await expect(provider.normalizeAnswer(normalizeParams())).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && err.code === "ai_validation_error",
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("retries a connection error rather than giving up on the first failure", async () => {
    const { provider, create } = providerThatThrows(new OpenAI.APIConnectionError({}));

    await expect(provider.normalizeAnswer(normalizeParams())).rejects.toSatisfy(
      (err: unknown) => isAppError(err) && err.code === "ai_validation_error",
    );
    expect(create).toHaveBeenCalledTimes(3);
  });
});
