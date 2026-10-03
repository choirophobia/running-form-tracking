"use client";

import { useState, type FormEvent } from "react";
import type { UseHistoryResult } from "@/hooks/useHistory";
import type { UseSessionResult } from "@/hooks/useSession";
import { formatRecordedAt } from "./format";

// Batch 6: PRD Section 8's left sidebar — a reverse-chronological list of
// past analyses (Claude Desktop-style). Each entry: the date as the primary
// label, and — since the efficiency score doesn't exist yet (PRD Section 12
// open decision) — cadence as the quiet secondary line instead of a score.
// No progress delta for the same reason: there's no score to diff.
//
// Signed out, the sidebar holds the sign-in form instead, since history is
// meaningless without an account.

export function HistorySidebar({
  auth,
  history,
  selectedId,
  onSelect,
  onNewAnalysis,
}: {
  auth: UseSessionResult;
  history: UseHistoryResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewAnalysis: () => void;
}) {
  const { session } = auth;

  return (
    <aside className="border-b border-line px-6 py-6 md:sticky md:top-0 md:h-dvh md:w-72 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
      <h2 className="font-display text-xl uppercase tracking-wide text-ink">History</h2>

      {session === undefined ? null : session === null ? (
        <AuthForm auth={auth} />
      ) : (
        <>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-stone">
            <span className="truncate">{session.user.email}</span>
            <button onClick={auth.signOut} className="shrink-0 underline-offset-2 hover:text-ink hover:underline">
              Sign out
            </button>
          </div>

          <button
            onClick={onNewAnalysis}
            className={`mt-4 flex min-h-11 w-full items-center border px-3 text-left text-sm transition-colors ${
              selectedId === null ? "border-ink text-ink" : "border-line text-stone hover:border-ink hover:text-ink"
            }`}
          >
            New analysis
          </button>

          <HistoryList history={history} selectedId={selectedId} onSelect={onSelect} />
        </>
      )}
    </aside>
  );
}

function HistoryList({
  history,
  selectedId,
  onSelect,
}: {
  history: UseHistoryResult;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { analyses, loading, error, hasMore, loadMore } = history;

  if (analyses.length === 0) {
    if (loading) return <p className="mt-4 text-sm text-stone">Loading your runs…</p>;
    if (error) return <p className="mt-4 text-sm text-rust">{error}</p>;
    return (
      <p className="mt-4 max-w-prose text-sm text-stone">
        No saved runs yet. Analyze a video, then save it to start your history.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {/* Capped with its own scroll on small screens, where the sidebar
          stacks above the analyzer — a long history mustn't push "Choose a
          video" off the first screen. On md+ the whole sidebar scrolls. */}
      <ol className="max-h-56 overflow-y-auto border-t border-line md:max-h-none md:overflow-visible">
        {analyses.map((a) => {
          const selected = a.id === selectedId;
          return (
            <li key={a.id}>
              <button
                onClick={() => onSelect(a.id)}
                aria-current={selected ? "true" : undefined}
                className={`block w-full border-b border-l-2 border-b-line py-3 pr-2 pl-3 text-left transition-colors ${
                  selected ? "border-l-energy" : "border-l-transparent hover:border-l-stone"
                }`}
              >
                <span className={`block font-mono text-sm ${selected ? "text-ink" : "text-ink/80"}`}>
                  {formatRecordedAt(a.recorded_at)}
                </span>
                <span className="mt-0.5 block font-mono text-xs text-stone">
                  {a.cadence != null ? `${Math.round(a.cadence)} spm` : "cadence: not enough data"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {error && <p className="mt-3 text-sm text-rust">{error}</p>}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="mt-3 min-h-11 text-sm text-stone underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          {loading ? "Loading…" : "Show older runs"}
        </button>
      )}
    </div>
  );
}

function AuthForm({ auth }: { auth: UseSessionResult }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await (mode === "sign-in" ? auth.signIn : auth.signUp)(email, password);
    setBusy(false);
    if (err) setError(err);
  }

  const inputClass =
    "mt-1 block min-h-11 w-full border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-ink";

  return (
    <form onSubmit={handleSubmit} className="mt-3">
      <p className="text-sm text-stone">
        {mode === "sign-in" ? "Sign in to save runs and see your history." : "Create an account to keep your runs."}
      </p>
      <label className="mt-4 block text-xs text-stone">
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="mt-3 block text-xs text-stone">
        Password
        <input
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && <p className="mt-3 text-sm text-rust">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 inline-flex min-h-11 items-center border border-ink px-4 text-sm text-ink transition-colors hover:bg-ink hover:text-paper disabled:opacity-50"
      >
        {busy ? "One moment…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
        className="mt-3 block text-xs text-stone underline-offset-2 hover:text-ink hover:underline"
      >
        {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
