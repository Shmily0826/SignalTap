import { DiscussionItem } from "@signaltap/schemas";

/**
 * Comment clustering.
 *
 * We do NOT ask the LLM to estimate consensus directly from a raw comment
 * dump. Instead we run a staged, deterministic pipeline: clean -> dedupe ->
 * cluster by shared topics -> count signals per cluster -> let the model
 * (or mock) label and explain each cluster. That keeps the consensus /
 * disagreement numbers grounded in real counts.
 */

export interface Cluster {
  id: string;
  label: string;
  commentIds: string[];
  authorCount: number;
  commentCount: number;
  scoreSum: number;
  hasFirsthand: boolean;
  hasExternalEvidence: boolean;
  representativeText: string;
  keywords: string[];
}

export interface ClusterResult {
  clusters: Cluster[];
  /** Comments dropped during cleaning (duplicates / empty). */
  droppedCount: number;
  totalAuthors: number;
}

export interface ClusteringProvider {
  cluster(comments: DiscussionItem[]): Promise<ClusterResult>;
}

const STOPWORDS = new Set(
  (
    "the a an and or but if then else when while of to in on at by for with from as is are was " +
    "were be been being it its this that these those i you he she they we us our your their my " +
    "me him her them his hers not no yes do does did done have has had will would can could should " +
    "about into out up down over under again more most some such only own same than too very s t " +
    "don now im ive thats thats what which who whom whose why how all any both each few other " +
    "so just because actually really maybe probably think think its people thing things get got " +
    "like one also even still much many lot going go going really seem seems looks look"
  ).split(/\s+/)
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [])
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .filter((w) => !/^\d+$/.test(w));
}

function topKeywords(tokens: string[], n = 3): string[] {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

const FIRSTHAND = /\b(i (tried|used|experienced|tested|found|ran|built|saw|had)|my experience|in my case|when i|i've done|i did)\b/i;
const EXTERNAL = /(https?:\/\/|\bstudy\b|\bsource\b|\bpaper\b|\bdocumentation\b|\bofficial\b)/i;

class UnionFind {
  parent: Map<number, number> = new Map();
  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const nxt = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = nxt;
    }
    return root;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface MockClusterOptions {
  /** Keywords shared to join two comments into one cluster. */
  joinOnSharedKeyword?: boolean;
}

export class MockClusteringProvider implements ClusteringProvider {
  constructor(private readonly options: MockClusterOptions = {}) {}

  async cluster(comments: DiscussionItem[]): Promise<ClusterResult> {
    // 1. Clean: drop empty / very low-information items.
    const cleaned = comments.filter(
      (c) => !c.deleted && c.text.trim().length >= 8
    );

    // 2. Remove exact duplicates (keep first occurrence).
    const seen = new Set<string>();
    const deduped: DiscussionItem[] = [];
    let droppedCount = comments.length - cleaned.length;
    for (const c of cleaned) {
      const key = c.text.trim().toLowerCase();
      if (seen.has(key)) {
        droppedCount++;
        continue;
      }
      seen.add(key);
      deduped.push(c);
    }

    // 3. Cluster by shared top keyword (union-find).
    const tokensByIndex = deduped.map((c) => tokenize(c.text));
    const keywordsByIndex = tokensByIndex.map((t) => topKeywords(t, 3));
    const uf = new UnionFind();
    for (let i = 0; i < deduped.length; i++) {
      for (let j = i + 1; j < deduped.length; j++) {
        if (keywordsByIndex[i].some((k) => keywordsByIndex[j].includes(k))) {
          uf.union(i, j);
        }
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < deduped.length; i++) {
      const r = uf.find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(i);
    }

    const clusters: Cluster[] = [];
    const allAuthors = new Set<string>();
    for (const [, idxs] of groups) {
      const items = idxs.map((i) => deduped[i]);
      const authorSet = new Set(
        items.map((c) => c.author ?? "").filter(Boolean)
      );
      items.forEach((c) => c.author && allAuthors.add(c.author));
      const scoreSum = items.reduce((s, c) => s + (c.score ?? 0), 0);
      const hasFirsthand = items.some((c) => FIRSTHAND.test(c.text));
      const hasExternalEvidence = items.some((c) => EXTERNAL.test(c.text));
      // representative: highest score, prefer non-collapsed, longest text
      const representative = [...items].sort(
        (a, b) =>
          (b.score ?? 0) - (a.score ?? 0) || b.text.length - a.text.length
      )[0];
      const labelKw = topKeywords(
        items.flatMap((c) => tokenize(c.text)),
        3
      );
      clusters.push({
        id: `cluster-${clusters.length + 1}`,
        label: labelKw.join(" / ") || "misc",
        commentIds: items.map((c) => c.id),
        authorCount: authorSet.size,
        commentCount: items.length,
        scoreSum,
        hasFirsthand,
        hasExternalEvidence,
        representativeText: representative.text.slice(0, 240),
        keywords: labelKw,
      });
    }

    // Sort clusters by engagement (scoreSum then comment count) desc.
    clusters.sort(
      (a, b) => b.scoreSum - a.scoreSum || b.commentCount - a.commentCount
    );

    return {
      clusters,
      droppedCount,
      totalAuthors: allAuthors.size,
    };
  }
}

/**
 * Build human-readable consensus / disagreement sentences from cluster stats.
 * This is the deterministic mock stand-in for the LLM labeling step.
 */
export function summarizeClusters(result: ClusterResult): {
  consensus: string[];
  disagreements: string[];
  counterarguments: string[];
} {
  const consensus: string[] = [];
  const disagreements: string[] = [];
  const counterarguments: string[] = [];

  for (const c of result.clusters) {
    const lead = `${c.commentCount} comment(s) from ${c.authorCount} author(s)`;
    const firsthand = c.hasFirsthand ? " (includes firsthand reports)" : "";
    const external = c.hasExternalEvidence ? " (cites external evidence)" : "";
    consensus.push(`${lead} converge on "${c.label}"${firsthand}${external}.`);
  }

  // Treat the two largest clusters as the main points of agreement, and
  // any smaller opposing-sentiment cluster as a disagreement/counter.
  const sorted = [...result.clusters].sort(
    (a, b) => b.commentCount - a.commentCount
  );
  if (sorted.length >= 2) {
    disagreements.push(
      `A minority view (${sorted[sorted.length - 1].commentCount} comments) diverges from the dominant "${sorted[0].label}" thread, suggesting "${sorted[sorted.length - 1].label}".`
    );
  }
  if (sorted.length >= 1 && sorted[0].hasFirsthand) {
    counterarguments.push(
      `Some firsthand accounts challenge the general takeaway: "${sorted[0].keywords.join(" / ")}".`
    );
  }

  return { consensus, disagreements, counterarguments };
}
