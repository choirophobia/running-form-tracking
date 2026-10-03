"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalysisRow } from "@/lib/supabase/analyses";
import type { SessionPayload } from "@/lib/supabase/auth";

// Batch 6: the history sidebar's data — the signed-in user's saved
// analyses, newest first, from Batch 4's `GET /api/analyses` (RLS already
// scopes it to the caller). Paged with the API's own limit/offset/hasMore.

const PAGE_SIZE = 20;

export interface UseHistoryResult {
  analyses: AnalysisRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

export function useHistory(
  session: SessionPayload | null | undefined,
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>
): UseHistoryResult {
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Bumped to force a fresh first page (after saving, or switching account).
  const [generation, setGeneration] = useState(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await authedFetch(`/api/analyses?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.ok) throw new Error(`GET /api/analyses returned ${res.status}`);
        const body = (await res.json()) as { analyses: AnalysisRow[]; hasMore: boolean };
        setAnalyses((prev) => (offset === 0 ? body.analyses : [...prev, ...body.analyses]));
        setHasMore(body.hasMore);
      } catch (err) {
        console.error("Loading history failed:", err);
        setError("Couldn't load your history. Try again in a moment.");
      } finally {
        setLoading(false);
      }
    },
    [authedFetch]
  );

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      // Signed out: drop the previous account's list immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnalyses([]);
      setHasMore(false);
      return;
    }
    void fetchPage(0);
    // fetchPage's identity follows authedFetch, which is stable — keying on
    // the user id (not the whole session object) avoids refetching every
    // time the access token is merely refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, generation]);

  return {
    analyses,
    loading,
    error,
    hasMore,
    loadMore: () => void fetchPage(analyses.length),
    reload: () => setGeneration((g) => g + 1),
  };
}
