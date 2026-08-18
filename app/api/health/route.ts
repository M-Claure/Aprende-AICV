import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness probe + which providers are active (no secrets). */
export function GET() {
  const env = getEnv();
  return NextResponse.json({
    data: {
      status: "ok",
      aiProvider: env.AI_PROVIDER,
      persistence: env.PERSISTENCE,
      model: env.AI_PROVIDER === "azure" ? env.AZURE_OPENAI_MODEL : null,
    },
  });
}
