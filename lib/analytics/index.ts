import "server-only";
import { getEnv } from "@/lib/env";
import { sanitizeProps, type AnalyticsEvent, type AnalyticsProps } from "./events";

export type { AnalyticsEvent, AnalyticsProps } from "./events";

export interface Analytics {
  track(event: AnalyticsEvent, props: AnalyticsProps, userId?: string): void;
}

/** No-op analytics — used when AMPLITUDE_API_KEY is not configured or in tests. */
export class NoopAnalytics implements Analytics {
  track(_event: AnalyticsEvent, _props: AnalyticsProps, _userId?: string): void {
    /* intentionally does nothing */
  }
}

/**
 * Amplitude analytics via the HTTP API v2 (no SDK dependency). Events are sent
 * fire-and-forget; failures are logged but never block the request. Properties
 * are sanitized to the allow-list before sending (no raw answers / PII).
 */
export class AmplitudeAnalytics implements Analytics {
  constructor(private readonly apiKey: string) {}

  track(event: AnalyticsEvent, props: AnalyticsProps, userId?: string): void {
    const safe = sanitizeProps(props);
    const payload = {
      api_key: this.apiKey,
      events: [
        {
          event_type: event,
          user_id: userId,
          // Use the profile id as a stable insert/device anchor when no user id.
          device_id: userId ? undefined : (safe.resumeProfileId as string | undefined),
          event_properties: safe,
        },
      ],
    };
    void fetch("https://api2.amplitude.com/2/httpapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("[analytics] amplitude error", err));
  }
}

let cached: Analytics | null = null;

export function getAnalytics(): Analytics {
  if (cached) return cached;
  const env = getEnv();
  cached = env.AMPLITUDE_API_KEY ? new AmplitudeAnalytics(env.AMPLITUDE_API_KEY) : new NoopAnalytics();
  return cached;
}

export function __setAnalytics(a: Analytics | null): void {
  cached = a;
}
