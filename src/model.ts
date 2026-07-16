/** ghd のドメインモデル。全モジュールが参照する型定義のみを置く。 */

export type Section = "review" | "pr" | "issue";

export const ALL_SECTIONS: readonly Section[] = ["review", "pr", "issue"];

export type CiState = "pass" | "fail" | "pending" | "none";

export type ReviewState = "approved" | "changes_requested" | "waiting" | null;

export interface ReviewRequestItem {
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string | null;
  updatedAt: string;
}

export interface MyPrItem {
  number: number;
  title: string;
  url: string;
  repo: string;
  draft: boolean;
  ci: CiState;
  ciFailedChecks: string[];
  ciMoreFailures: boolean;
  review: ReviewState;
  conflict: boolean;
  /** CI pass + approved + mergeable=MERGEABLE の合成状態: あとはマージするだけ */
  ready: boolean;
  updatedAt: string;
}

export interface IssueItem {
  number: number;
  title: string;
  url: string;
  repo: string;
  labels: string[];
  priority: string | null;
  updatedAt: string;
}

export interface SectionData<T> {
  items: T[];
  totalCount: number;
}

export type Warning =
  | { kind: "parse_skipped"; count: number }
  | { kind: "partial_error" };

export interface Dashboard {
  reviewRequests?: SectionData<ReviewRequestItem>;
  myPullRequests?: SectionData<MyPrItem>;
  assignedIssues?: SectionData<IssueItem>;
  warnings: Warning[];
}

export interface RateLimitInfo {
  cost: number;
  remaining: number;
  resetAt: string;
}
