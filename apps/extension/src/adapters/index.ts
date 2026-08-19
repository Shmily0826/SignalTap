import { Adapter } from "./types";
import { GenericArticleAdapter } from "./genericArticle";
import { RedditAdapter } from "./reddit";
import { HackerNewsAdapter } from "./hackernews";
import { GitHubIssueAdapter } from "./githubIssue";
import { YouTubeAdapter } from "./youtube";
import { GenericVisibleTextAdapter } from "./genericVisible";

/**
 * Ordered adapter registry. More specific adapters are tried first;
 * GenericVisibleTextAdapter is the unconditional fallback.
 */
export const ADAPTERS: Adapter[] = [
  YouTubeAdapter,
  RedditAdapter,
  HackerNewsAdapter,
  GitHubIssueAdapter,
  GenericArticleAdapter,
  GenericVisibleTextAdapter,
];

export function selectAdapter(url: string, doc: Document): Adapter {
  for (const adapter of ADAPTERS) {
    if (adapter.supports(url, doc)) return adapter;
  }
  return GenericVisibleTextAdapter;
}
