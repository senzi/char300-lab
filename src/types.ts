export type TokenKind = "han" | "number" | "punctuation";

export type DiffOp = "KEEP" | "INSERT" | "DELETE";

export interface TextToken {
  value: string;
  kind: TokenKind;
}

export interface TokenStats {
  text_units: number;
  punctuation_units: number;
  total_units: number;
  han_units: number;
  number_units: number;
}

export interface DiffUnit {
  op: DiffOp;
  token: TextToken;
}

export interface DiffSummary {
  han: {
    insert: number;
    delete: number;
  };
  number: {
    insert: number;
    delete: number;
  };
  punctuation: {
    insert: number;
    delete: number;
  };
}

export interface Version {
  version_id: string;
  entry_id: string;
  content: string;
  created_at: string;
  token_stats: TokenStats;
  diff_from_previous: DiffUnit[];
  is_initial: boolean;
}

export interface Entry {
  entry_id: string;
  date_key: string;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  optional_title: string;
}

export interface DailyEntry extends Entry {
  versions: Version[];
  draft: string;
  lastSavedContent: string;
}

export interface AppState {
  entries: DailyEntry[];
  active_entry_id: string;
}
