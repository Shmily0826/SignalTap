import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnalysisResult,
  ExtractedContent,
  RelevanceProfile,
  SourceReference,
} from "@signaltap/schemas";
import { requestAnalysis, submitFeedback } from "../api";
import {
  cacheKey,
  clearHistory,
  contentFingerprint,
  deleteCached,
  getCached,
  getSettings,
  listHistory,
  putCached,
  saveSettings,
  Settings,
  StoredAnalysis,
} from "../store";

type Phase = "idle" | "extracting" | "analyzing" | "done" | "error";
type View = "analysis" | "history" | "settings";

const STAGES = [
  "Extracting page",
  "Organizing content",
  "Comparing viewpoints",
  "Creating source-linked analysis",
];

const SCOPE_LABEL: Record<string, string> = {
  full_page: "Full page",
  loaded_content: "Loaded content",
  visible_content: "Visible text",
  transcript: "Transcript",
};

const PROFILE_LABEL: Record<RelevanceProfile, string> = {
  general: "General reader",
  developer: "Developer",
  student: "Student",
  researcher: "Researcher",
  product_manager: "Product manager",
  creator: "Creator",
};

async function getActiveTab(): Promise<number | null> {
  const params = new URLSearchParams(location.search);
  const t = params.get("tabId");
  if (t && /^\d+$/.test(t)) return Number(t);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [view, setView] = useState<View>("analysis");
  const [stageIndex, setStageIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);

  const [tabId, setTabId] = useState<number | null>(null);
  const [pageTitle, setPageTitle] = useState<string>("");
  const [extracted, setExtracted] = useState<ExtractedContent | null>(null);
  const [adapterId, setAdapterId] = useState("");
  const [adapterVersion, setAdapterVersion] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [missingExcerpt, setMissingExcerpt] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState("");
  const [cacheKeyOf, setCacheKeyOf] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<StoredAnalysis[]>([]);

  const controllerRef = useRef<AbortController | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const didAutoRunRef = useRef(false);

  const extractFromTab = useCallback(async (tabId: number) => {
    const attempt = async () => {
      const r = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT" });
      if (!r?.ok) throw new Error("extraction failed");
      return r as {
        extracted: ExtractedContent;
        adapterId: string;
        adapterVersion: string;
      };
    };
    try {
      return await attempt();
    } catch {
      // Content script may not be injected yet; ask the background to inject.
      await chrome.runtime.sendMessage({ type: "INJECT_CONTENT", tabId });
      return await attempt();
    }
  }, []);

  const stopStages = () => {
    if (stageTimerRef.current) clearInterval(stageTimerRef.current);
    stageTimerRef.current = null;
  };

  const runAnalysis = useCallback(
    async (profileOverride?: RelevanceProfile) => {
      if (!tabId) return;
      setPhase("extracting");
      setError("");
      setNotice("");
      setMissingExcerpt(null);
      stopStages();

      try {
        const { extracted, adapterId, adapterVersion } = await extractFromTab(tabId);
        setExtracted(extracted);
        setAdapterId(adapterId);
        setAdapterVersion(adapterVersion);
        setPageTitle(extracted.title ?? "");
        setPhase("analyzing");
        setStageIndex(1);

        const profile = profileOverride ?? settings?.profile ?? "general";
        const key = cacheKey(extracted.url, extracted, profile);
        setCacheKeyOf(key);

        // Local cache hit?
        const cachedEntry = await getCached(key);
        if (cachedEntry && settings?.historyEnabled !== false) {
          setResult(cachedEntry.result);
          setCached(true);
          setPhase("done");
          return;
        }

        // Real progression through the remaining stages while we wait.
        stageTimerRef.current = setInterval(() => {
          setStageIndex((i) => Math.min(i + 1, STAGES.length - 1));
        }, 1200);

        controllerRef.current = new AbortController();
        const { analysisId, result } = await requestAnalysis(
          {
            schemaVersion: "1.0",
            url: extracted.url,
            canonicalUrl: extracted.canonicalUrl ?? null,
            title: extracted.title ?? null,
            profile,
            extracted,
          },
          controllerRef.current.signal
        );
        stopStages();
        setAnalysisId(analysisId);
        setResult(result);
        setCached(false);
        setPhase("done");

        if (settings?.historyEnabled !== false && settings?.contentRetention !== false) {
          await putCached(key, {
            url: extracted.url,
            canonicalUrl: extracted.canonicalUrl ?? null,
            title: extracted.title ?? null,
            profile,
            adapter: adapterId,
            adapterVersion,
            contentFingerprint: contentFingerprint(extracted),
            schemaVersion: "1.0",
            result,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        stopStages();
        if (e?.name === "AbortError" || e?.type === "cancelled") {
          setNotice("Analysis cancelled.");
          setPhase("idle");
        } else {
          setError(e?.message ?? "Analysis failed");
          setPhase("error");
        }
      }
    },
    [tabId, settings, extractFromTab]
  );

  useEffect(() => {
    (async () => {
      const [tabId, settings] = await Promise.all([getActiveTab(), getSettings()]);
      setTabId(tabId);
      setSettings(settings);
      if (tabId) {
        // Prefetch the page title for the header.
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.title) setPageTitle(tab.title);
        } catch {
          /* ignore */
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (view === "history") {
      listHistory().then(setHistory);
    }
  }, [view]);

  // One-tap flow: as soon as we know the active tab and settings, start.
  useEffect(() => {
    if (tabId && settings && !didAutoRunRef.current) {
      didAutoRunRef.current = true;
      runAnalysis();
    }
  }, [tabId, settings, runAnalysis]);

  useEffect(() => () => stopStages(), []);

  /* ------------------------------- actions -------------------------------- */

  const stop = () => {
    controllerRef.current?.abort();
    stopStages();
  };

  const refresh = (profileOverride?: RelevanceProfile) => {
    setResult(null);
    runAnalysis(profileOverride);
  };

  const deleteCurrent = async () => {
    if (cacheKeyOf) await deleteCached(cacheKeyOf);
    if (analysisId) {
      const { deleteRemoteAnalysis } = await import("../api");
      await deleteRemoteAnalysis(analysisId);
    }
    setResult(null);
    setPhase("idle");
    setNotice("Analysis deleted.");
  };

  const openFromHistory = async (entry: StoredAnalysis) => {
    setView("analysis");
    setResult(entry.result);
    setCacheKeyOf(entry.key);
    setAnalysisId(entry.result.analysisId ?? "");
    setCached(true);
    setPageTitle(entry.title ?? "");
    setPhase("done");
  };

  const handleSourceClick = async (ref: SourceReference) => {
    setNotice("");
    if (!tabId) {
      setNotice("Re-open SignalTap while the page is active.");
      return;
    }
    try {
      const r = await chrome.tabs.sendMessage(tabId, {
        type: "HIGHLIGHT",
        sourceId: ref.sourceId,
      });
      if (!r?.found) {
        setMissingExcerpt(r?.excerpt ?? ref.excerpt);
      } else {
        setMissingExcerpt(null);
      }
    } catch {
      setNotice("Could not reach the page. Open SignalTap on the page first.");
    }
  };

  const report = async (rating: "up" | "down" | "report", comment?: string, issueType?: string) => {
    if (!result) return;
    await submitFeedback({
      analysisId: result.analysisId ?? "",
      url: extracted?.url ?? "",
      rating,
      comment,
      issueType,
    });
    setNotice("Thanks for the feedback — it helps us improve.");
  };

  const updateSetting = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = await saveSettings(patch);
    setSettings(next);
    if (patch.profile) refresh(patch.profile);
  };

  const clearAllHistory = async () => {
    await clearHistory();
    setHistory([]);
    setNotice("Local history cleared.");
  };

  /* -------------------------------- render -------------------------------- */

  if (minimized) {
    return (
      <div className="p-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">SignalTap</span>
          <button className="st-btn st-btn-ghost" onClick={() => setMinimized(false)} title="Restore">
            ⤢
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        title={pageTitle}
        adapter={adapterId}
        scope={extracted?.captureScope}
        view={view}
        onView={setView}
        onMinimize={() => setMinimized(true)}
        onRefresh={refresh}
        onClear={() => setResult(null)}
        analyzing={phase === "analyzing" || phase === "extracting"}
        onStop={stop}
      />

      {notice && (
        <div className="mx-2 mt-1 rounded bg-signal-border/40 px-2 py-1 text-[11px] text-signal-muted">
          {notice}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            onChange={updateSetting}
            onClearHistory={clearAllHistory}
          />
        )}

        {view === "history" && (
          <HistoryView
            history={history}
            onOpen={openFromHistory}
            onDelete={async (key) => {
              await deleteCached(key);
              setHistory(await listHistory());
            }}
          />
        )}

        {view === "analysis" && phase === "idle" && (
          <div className="mt-10 text-center">
            <p className="mb-3 text-sm text-signal-muted">
              One tap. Just the signal.
            </p>
            <button className="st-btn st-btn-primary" onClick={() => runAnalysis()} disabled={!tabId}>
              Analyze this page
            </button>
            {!tabId && (
              <p className="mt-2 text-xs text-signal-muted">
                No active page detected — click the SignalTap icon on a page.
              </p>
            )}
          </div>
        )}

        {view === "analysis" && (phase === "extracting" || phase === "analyzing") && (
          <LoadingView stageIndex={stageIndex} />
        )}

        {view === "analysis" && phase === "error" && (
          <div className="mt-10 text-center">
            <p className="mb-1 text-sm text-signal-bad">Analysis failed</p>
            <p className="mb-3 text-xs text-signal-muted">{error}</p>
            <div className="flex justify-center gap-2">
              <button className="st-btn st-btn-primary" onClick={() => runAnalysis()}>
                Retry
              </button>
              <button className="st-btn st-btn-ghost" onClick={() => setPhase("idle")}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {view === "analysis" && phase === "done" && result && (
          <ResultView
            result={result}
            cached={cached}
            onSource={handleSourceClick}
            onReport={report}
            onDelete={deleteCurrent}
            onRefresh={refresh}
            missingExcerpt={missingExcerpt}
            onDismissExcerpt={() => setMissingExcerpt(null)}
          />
        )}
      </div>

      <Footer
        profile={settings?.profile ?? "general"}
        onOpenSettings={() => setView("settings")}
      />
    </div>
  );
}

/* ------------------------------- components ------------------------------- */

function Header(props: {
  title: string;
  adapter?: string;
  scope?: string;
  view: View;
  onView: (v: View) => void;
  onMinimize: () => void;
  onRefresh: () => void;
  onClear: () => void;
  analyzing: boolean;
  onStop: () => void;
}) {
  return (
    <div className="border-b border-signal-border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">⛉ SignalTap</span>
            {props.analyzing ? (
              <span className="st-chip bg-signal-border/60 text-signal-muted">analyzing…</span>
            ) : (
              props.scope && (
                <span className="st-chip bg-signal-border/60 text-signal-accent">
                  {SCOPE_LABEL[props.scope] ?? props.scope}
                </span>
              )
            )}
          </div>
          <p className="truncate text-[11px] text-signal-muted">
            {props.title || "No page title detected"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.analyzing ? (
            <button className="st-btn st-btn-ghost text-[12px]" onClick={props.onStop} title="Stop">
              ⏹
            </button>
          ) : (
            <button className="st-btn st-btn-ghost text-[12px]" onClick={props.onRefresh} title="Re-analyze">
              ⟳
            </button>
          )}
          <button className="st-btn st-btn-ghost text-[12px]" onClick={() => props.onView("history")} title="History">
            🕘
          </button>
          <button className="st-btn st-btn-ghost text-[12px]" onClick={() => props.onView("settings")} title="Settings">
            ⚙
          </button>
          <button className="st-btn st-btn-ghost text-[12px]" onClick={props.onMinimize} title="Minimize">
            ─
          </button>
          <button className="st-btn st-btn-ghost text-[12px]" onClick={props.onClear} title="Close">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingView({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="mt-12 px-4">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-signal-border border-t-signal-accent" />
      <ol className="space-y-2">
        {STAGES.map((s, i) => (
          <li
            key={s}
            className={`flex items-center gap-2 text-sm ${
              i < stageIndex
                ? "text-signal-good"
                : i === stageIndex
                ? "text-signal-text"
                : "text-signal-muted/50"
            }`}
          >
            <span>{i < stageIndex ? "✓" : i === stageIndex ? "●" : "○"}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-signal-muted">
        Analysis runs on content currently loaded in the page. Nothing is sent to us without your click.
      </p>
    </div>
  );
}

function ResultView(props: {
  result: AnalysisResult;
  cached: boolean;
  onSource: (ref: SourceReference) => void;
  onReport: (rating: "up" | "down" | "report", comment?: string, issueType?: string) => void;
  onDelete: () => void;
  onRefresh: () => void;
  missingExcerpt: string | null;
  onDismissExcerpt: () => void;
}) {
  const r = props.result;
  return (
    <div className="space-y-3">
      {props.cached && (
        <p className="text-[11px] text-signal-muted">Cached result for this page.</p>
      )}

      {/* Quick verdict */}
      <div className="st-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-signal-accent">
              {r.verdict.worthAttention.toFixed(1)}
              <span className="text-sm text-signal-muted">/10</span>
            </div>
            <div className="text-[11px] text-signal-muted">
              confidence {Math.round(r.verdict.confidence * 100)}%
            </div>
          </div>
          <div className="text-right text-[11px] text-signal-muted">
            {r.verdict.estimatedReadingMinutes ? (
              <div>~{r.verdict.estimatedReadingMinutes} min to read</div>
            ) : null}
            {r.verdict.estimatedTimeSavedMinutes ? (
              <div>~{r.verdict.estimatedTimeSavedMinutes} min saved</div>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm">{r.verdict.reason}</p>
        <p className="mt-1 text-[11px] text-signal-muted">
          Content-prioritization aid — not an objective truth score.
        </p>
      </div>

      {/* Signal */}
      <Section title="Signal">
        <p className="text-sm leading-relaxed">{r.summary}</p>
      </Section>

      {r.recommendedAction ? (
        <Section title="Recommended action">
          <p className="text-sm">{r.recommendedAction}</p>
        </Section>
      ) : null}

      {r.keyFacts.length > 0 && (
        <Section title="Key facts">
          <StringList items={r.keyFacts} />
        </Section>
      )}

      <Section title="Facts">
        <StringList items={r.facts} empty="No explicitly supported factual claims detected." />
      </Section>

      <Section title="Opinions & speculation">
        {r.opinions.length > 0 && <MiniList label="Opinions" items={r.opinions} />}
        {r.speculation.length > 0 && <MiniList label="Speculation" items={r.speculation} />}
        {r.weakClaims.length > 0 && <MiniList label="Weakly supported" items={r.weakClaims} />}
        {r.promotionalLanguage.length > 0 && (
          <MiniList label="Promotional language" items={r.promotionalLanguage} />
        )}
        {r.opinions.length === 0 &&
          r.speculation.length === 0 &&
          r.weakClaims.length === 0 &&
          r.promotionalLanguage.length === 0 && (
            <p className="text-xs text-signal-muted">No notable opinion/speculation content detected.</p>
          )}
      </Section>

      {r.consensus.length > 0 && <Section title="Consensus"><StringList items={r.consensus} /></Section>}
      {r.disagreements.length > 0 && <Section title="Disagreement"><StringList items={r.disagreements} /></Section>}
      {r.firsthandReports.length > 0 && <Section title="Firsthand reports"><StringList items={r.firsthandReports} /></Section>}
      {r.counterarguments.length > 0 && <Section title="Minority counterarguments"><StringList items={r.counterarguments} /></Section>}
      {r.unansweredQuestions.length > 0 && <Section title="Unanswered questions"><StringList items={r.unansweredQuestions} /></Section>}

      {r.recommendedSections.length > 0 && (
        <Section title="What to read">
          {r.recommendedSections.map((s, i) => (
            <div key={i} className="mb-1 flex items-center gap-1 text-sm">
              <span>▶ {s.label}</span>
              <SourceChips sourceIds={s.sourceIds} onSource={props.onSource} />
            </div>
          ))}
        </Section>
      )}

      {r.safeToSkip.length > 0 && (
        <Section title="Safe to skip">
          {r.safeToSkip.map((s, i) => (
            <div key={i} className="mb-1 flex items-center gap-1 text-sm text-signal-muted">
              <span>▷ {s.label}</span>
              <SourceChips sourceIds={s.sourceIds} onSource={props.onSource} />
            </div>
          ))}
        </Section>
      )}

      {r.bestComments.length > 0 && (
        <Section title="Best comments">
          <div className="flex flex-wrap gap-1">
            <SourceChips sourceIds={r.bestComments} onSource={props.onSource} />
          </div>
        </Section>
      )}

      {r.missingContext.length > 0 && (
        <Section title="Limitations">
          <StringList items={r.missingContext} />
          {r.importantUncertainty.length > 0 && <StringList items={r.importantUncertainty} />}
        </Section>
      )}

      {props.missingExcerpt && (
        <div className="st-card border-signal-warn/40">
          <p className="text-[11px] font-semibold text-signal-warn">Source no longer on the page</p>
          <p className="mt-1 text-xs text-signal-muted">“{props.missingExcerpt.slice(0, 220)}…”</p>
          <button className="mt-2 st-btn st-btn-ghost text-[11px]" onClick={props.onDismissExcerpt}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-signal-border pt-2 text-[11px] text-signal-muted">
        <span>provider: {r.provider ?? "unknown"}</span>
        <div className="flex gap-2">
          <button className="hover:text-signal-good" onClick={() => props.onReport("up")}>▲</button>
          <button className="hover:text-signal-bad" onClick={() => props.onReport("down", undefined, "misleading_summary")}>
            ▼
          </button>
          <button className="hover:text-signal-warn" onClick={() => props.onReport("report", undefined, "incorrect_fact")}>
            ⚑ report
          </button>
          <button className="hover:text-signal-bad" onClick={props.onDelete}>delete</button>
        </div>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="st-card">
      <div className="st-section-title">{props.title}</div>
      {props.children}
    </div>
  );
}

function StringList(props: { items: string[]; empty?: string }) {
  if (props.items.length === 0) {
    return <p className="text-xs text-signal-muted">{props.empty ?? ""}</p>;
  }
  return (
    <ul className="space-y-1">
      {props.items.map((item, i) => (
        <li key={i} className="text-sm leading-relaxed">
          • {item}
        </li>
      ))}
    </ul>
  );
}

function MiniList(props: { label: string; items: string[] }) {
  return (
    <div className="mb-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-signal-muted">
        {props.label}
      </span>
      <ul className="mt-0.5 space-y-1">
        {props.items.map((item, i) => (
          <li key={i} className="text-sm leading-relaxed">• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function SourceChips(props: { sourceIds: string[]; onSource: (ref: SourceReference) => void }) {
  if (props.sourceIds.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {props.sourceIds.map((id) => (
        <button
          key={id}
          className="st-chip border border-signal-border text-signal-accent hover:bg-signal-border/40"
          onClick={() => props.onSource({ id, sourceId: id, kind: "paragraph", excerpt: "" })}
          title="Jump to source"
        >
          #{id}
        </button>
      ))}
    </span>
  );
}

function HistoryView(props: {
  history: StoredAnalysis[];
  onOpen: (e: StoredAnalysis) => void;
  onDelete: (key: string) => void;
}) {
  if (props.history.length === 0) {
    return <p className="mt-8 text-center text-sm text-signal-muted">No local analysis history yet.</p>;
  }
  return (
    <div className="space-y-2">
      {props.history.map((e) => (
        <div key={e.key} className="st-card flex items-center justify-between gap-2">
          <button className="min-w-0 text-left" onClick={() => props.onOpen(e)}>
            <p className="truncate text-sm">{e.title || e.url}</p>
            <p className="text-[11px] text-signal-muted">
              {new Date(e.createdAt).toLocaleString()} · score {e.result.verdict.worthAttention.toFixed(1)} ·{" "}
              {e.adapter}
            </p>
          </button>
          <button className="shrink-0 text-[11px] text-signal-muted hover:text-signal-bad" onClick={() => props.onDelete(e.key)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function SettingsView(props: {
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  onClearHistory: () => void;
}) {
  const s = props.settings;
  return (
    <div className="space-y-3">
      <Section title="Relevance profile">
        <select
          className="w-full rounded-md border border-signal-border bg-signal-panel px-2 py-1.5 text-sm"
          value={s.profile}
          onChange={(e) => props.onChange({ profile: e.target.value as RelevanceProfile })}
        >
          {(Object.keys(PROFILE_LABEL) as RelevanceProfile[]).map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-signal-muted">
          Changes the weights used for the worth-attention score. Stored locally only.
        </p>
      </Section>

      <Section title="Privacy">
        <ToggleRow
          label="Keep local history"
          checked={s.historyEnabled}
          onChange={(v) => props.onChange({ historyEnabled: v })}
        />
        <ToggleRow
          label="Retain page content locally"
          checked={s.contentRetention}
          onChange={(v) => props.onChange({ contentRetention: v })}
        />
        <button className="mt-2 st-btn st-btn-ghost text-[12px] text-signal-bad" onClick={props.onClearHistory}>
          Clear all local results
        </button>
      </Section>

      <Section title="Permissions">
        <p className="text-[11px] leading-relaxed text-signal-muted">
          SignalTap requests the minimum permissions: <b>activeTab</b> (analyze only the page you click the icon
          on), <b>sidePanel</b>, <b>storage</b> (local cache/history), and <b>scripting</b> (inject the page
          extractor). No blanket host permissions; nothing is read until you click.
        </p>
      </Section>
    </div>
  );
}

function ToggleRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1 text-sm">
      <span>{props.label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-signal-accent"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function Footer(props: { profile: RelevanceProfile; onOpenSettings: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-signal-border px-3 py-1.5 text-[11px] text-signal-muted">
      <span>profile: {PROFILE_LABEL[props.profile]}</span>
      <button className="hover:text-signal-text" onClick={props.onOpenSettings}>
        settings
      </button>
    </div>
  );
}
