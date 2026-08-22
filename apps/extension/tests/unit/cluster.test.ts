import { describe, it, expect } from "vitest";
import {
  ClusterResult,
  MockClusteringProvider,
  summarizeClusters,
} from "@signaltap/analysis";
import { DiscussionItem } from "@signaltap/schemas";

function comment(
  id: string,
  text: string,
  overrides: Partial<DiscussionItem> = {}
): DiscussionItem {
  return {
    id,
    parentId: null,
    author: "anon",
    text,
    score: 1,
    depth: 0,
    permalink: null,
    position: 0,
    ...overrides,
  };
}

function fixture(): DiscussionItem[] {
  return [
    // Cluster A: battery drain (two authors, high engagement)
    comment("battery-1", "battery drain is terrible on mobile since the update", {
      author: "alice",
      score: 30,
    }),
    comment("battery-2", "battery drain was fixed for me in the latest beta", {
      author: "bob",
      score: 12,
    }),
    // Cluster B: pricing
    comment("pricing-1", "pricing is too high for small teams like ours", {
      author: "carol",
      score: 8,
    }),
    comment("pricing-2", "pricing should have a free tier for students", {
      author: "dave",
      score: 5,
    }),
    // Cluster C: single firsthand + external evidence comment
    comment("sync-1", "I tried the documented sync fix and it worked, see https://example.com/fix", {
      author: "erin",
      score: 3,
    }),
    // Dropped: deleted
    comment("deleted-1", "[deleted]", { author: null, deleted: true, score: 0 }),
    // Dropped: too short (< 8 chars)
    comment("short-1", "ok!", { author: "frank" }),
    // Dropped: exact duplicate of the pricing comment (different author)
    comment("dup-1", "pricing is too high for small teams like ours", {
      author: "grace",
      score: 1,
    }),
  ];
}

const clusterOf = (result: ClusterResult, id: string) =>
  result.clusters.find((c) => c.commentIds.includes(id))!;

describe("MockClusteringProvider", () => {
  it("drops deleted, too-short and duplicate comments and reports the count", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    expect(result.droppedCount).toBe(3);
    const ids = result.clusters.flatMap((c) => c.commentIds);
    expect(ids.sort()).toEqual(["battery-1", "battery-2", "pricing-1", "pricing-2", "sync-1"]);
  });

  it("clusters comments that share top keywords", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    // battery pair and pricing pair joined; sync comment alone
    expect(result.clusters).toHaveLength(3);
    const battery = clusterOf(result, "battery-1");
    expect(battery.commentCount).toBe(2);
    expect(battery.authorCount).toBe(2);
    expect(battery.scoreSum).toBe(42);
    const pricing = clusterOf(result, "pricing-1");
    expect(pricing.commentCount).toBe(2);
  });

  it("sorts clusters by engagement (scoreSum desc)", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    expect(result.clusters[0].scoreSum).toBeGreaterThanOrEqual(
      result.clusters[1].scoreSum
    );
    expect(result.clusters[0].keywords).toContain("battery"); // 42 beats pricing 13
  });

  it("flags firsthand reports and external evidence", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    const sync = clusterOf(result, "sync-1");
    expect(sync.hasFirsthand).toBe(true); // "I tried ..."
    expect(sync.hasExternalEvidence).toBe(true); // https:// link
    const battery = clusterOf(result, "battery-1");
    expect(battery.hasFirsthand).toBe(false);
  });

  it("counts unique authors among deduped comments only", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    // alice, bob, carol, dave, erin. grace's duplicate and frank's short
    // comment are dropped before author counting; deleted has no author.
    expect(result.totalAuthors).toBe(5);
  });

  it("is deterministic across runs", async () => {
    const p = new MockClusteringProvider();
    const a = await p.cluster(fixture());
    const b = await p.cluster(fixture());
    expect(a.clusters.map((c) => c.commentIds)).toEqual(
      b.clusters.map((c) => c.commentIds)
    );
    expect(a.clusters.map((c) => c.label)).toEqual(b.clusters.map((c) => c.label));
  });

  it("picks the highest-scored comment as representative", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    const battery = clusterOf(result, "battery-1");
    expect(battery.representativeText).toContain("terrible"); // alice's 30-score comment
  });
});

describe("summarizeClusters", () => {
  it("grounds every consensus sentence in real comment/author counts", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    const s = summarizeClusters(result);
    expect(s.consensus).toHaveLength(3);
    for (const line of s.consensus) {
      expect(line).toMatch(/^\d+ comment\(s\) from \d+ author\(s\)/);
    }
    const batteryLine = s.consensus.find((l) => l.includes("battery"))!;
    expect(batteryLine).toContain("2 comment(s) from 2 author(s)");
  });

  it("reports a disagreement when more than one cluster exists", async () => {
    const result = await new MockClusteringProvider().cluster(fixture());
    const s = summarizeClusters(result);
    expect(s.disagreements).toHaveLength(1);
    expect(s.disagreements[0]).toContain("minority view");
  });

  it("emits a counterargument when the top cluster has firsthand reports", async () => {
    // Make the sync/firsthand cluster the biggest by score.
    const items = [
      comment("sync-1", "I tried the documented sync fix and it worked, see https://example.com/fix", {
        author: "erin",
        score: 100,
      }),
      comment("pricing-1", "pricing is too high for small teams", { author: "carol", score: 1 }),
    ];
    const result = await new MockClusteringProvider().cluster(items);
    const s = summarizeClusters(result);
    expect(s.counterarguments).toHaveLength(1);
    expect(s.counterarguments[0]).toContain("firsthand");
  });

  it("returns empty disagreements for a single cluster", async () => {
    const result = await new MockClusteringProvider().cluster([
      comment("battery-1", "battery drain is terrible on mobile since the update"),
    ]);
    const s = summarizeClusters(result);
    expect(s.disagreements).toEqual([]);
  });
});
