"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not sign in.");

      // The redirect target comes from the URL, so it is kept to this app —
      // an absolute one would let a crafted link bounce you somewhere else.
      const next = params.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="actions" style={{ marginTop: "1rem" }}>
        <button className="primary" type="submit" disabled={busy || password.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}

/**
 * Which commit this deploy was built from.
 *
 * "The change is not there" and "the change has not shipped yet" look
 * identical from inside the app, and telling them apart meant guessing from
 * asset hashes — which are not comparable between one machine's build and
 * another's, so the guess was worthless. Netlify puts the commit in COMMIT_REF
 * at build time; this is simply it, said out loud.
 *
 * It sits on the sign-in page because that is the only page reachable without
 * the password, which is exactly when you need to ask the question.
 */
function builtFrom(): string | null {
  const ref = process.env.NEXT_PUBLIC_COMMIT_REF;
  return ref ? ref.slice(0, 7) : null;
}

export default function LoginPage() {
  const build = builtFrom();

  return (
    <main className="page" style={{ maxWidth: "26rem" }}>
      <div className="hero">
        <h1>ListFlow</h1>
        <p>Enter the password to open your shop tools.</p>
      </div>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      {build && (
        <p className="hint" style={{ textAlign: "center" }}>
          build <code>{build}</code>
        </p>
      )}
    </main>
  );
}
