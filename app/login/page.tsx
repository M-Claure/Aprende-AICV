"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button, Card, InstructionBanner } from "@/components/primitives";
import { useBrand } from "@/lib/brand/context";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const brand = useBrand();
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Revisa tu correo para confirmar tu cuenta, luego inicia sesión.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo autenticar.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <main className="mx-auto flex min-h-page max-w-md flex-col items-center justify-center px-6">
        <Card>
          <h1 className="text-lg font-semibold">Inicio de sesión no requerido</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Supabase no está configurado, así que la aplicación funciona en modo local sin cuentas.
          </p>
          <div className="mt-4">
            <Button onClick={() => router.push("/")}>Ir al inicio</Button>
          </div>
        </Card>
      </main>
    );
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none focus:border-accent";

  return (
    <main className="mx-auto flex min-h-page max-w-md flex-col items-center justify-center gap-4 px-6">
      <div className="w-full">
        <InstructionBanner
          icon="🔐"
          title={mode === "signin" ? "Entra a tu cuenta" : "Crea tu cuenta"}
        >
          {brand.auth.bannerBody}
        </InstructionBanner>
      </div>

      <Card className="w-full">
        <h1 className="text-xl font-bold">{mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}</h1>
        <p className="mt-1 text-sm text-text-secondary">{brand.auth.subtitle}</p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <input
            className={inputClass}
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <Button type="submit" disabled={busy}>
            {mode === "signin" ? "Entrar" : "Registrarme"}
          </Button>
        </form>

        {message && <p className="mt-3 text-sm text-accent-dark">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 text-sm text-accent-dark hover:underline"
        >
          {mode === "signin" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </Card>
    </main>
  );
}
