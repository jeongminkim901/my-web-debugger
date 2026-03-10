export type Step =
  | { kind: "goto"; url: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "press"; selector: string; key: string }
  | { kind: "wait"; ms: number }
  | { kind: "assert_text"; text: string }
  | { kind: "assert_selector"; selector: string }
  | { kind: "screenshot"; name?: string };

export type TestCase = {
  id: string;
  title: string;
  steps: Step[];
  expected?: string;
  baseUrl?: string;
  enabled?: boolean;
  tags?: string[];
};

export type CaseResult = {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  durationMs: number;
  screenshotPath?: string;
};

