export type ListDomainsSessionState = {
  session_id: string;
  exec_name?: string;
  step?: string;
};



export type ReadDomainSessionState = {
  session_id: string;
  step?: string;
  display_name?: string;
  domain_slug?: string; // resolved internally from display_name
  query?: string;
  fetched_chunks?: Record<string, any>[];    // stored server-side between FETCH and GENERATE
  fetched_domain_context?: Record<string, any>; // stored server-side between FETCH and GENERATE
  response?: string;
  chunks_used?: string[];
};

export type KnowledgeEntry = {
  content: string;
  category: string;
  tags: string[];
};

export type CreateDomainSessionState = {
  session_id: string;
  step?: string;
  area_of_business?: string;
  questions_with_this_domain?: string[];
  scope_of_domain?: { covers: string[], not_covers: string[]};
  extra_details?: string;
  user_confirmation?: boolean;
  knowledge_entries?: KnowledgeEntry[];
};

export type AddContentSessionState = {
  session_id: string;
  step?: string;
  display_name?: string;
  //domain_slug?: string;
  content?: string;
  category?: string;
  tags?: string[];
};

// ─── EOS Knowledge Hierarchy ─────────────────────────────────────────────────

export type EosTenYearTarget = {
  goal: string;
  metrics: string[];
  why: string;
  confidence: "low" | "medium" | "high";
};

export type EosThreeYearPicture = {
  revenue: string;
  product: string;
  team: string;
  market_position: string;
  key_capabilities: string[];
};

export type EosOneYearPlan = {
  goals: string[];
  metrics: string[];
  priorities: string[];
  constraints: string[];
};

export type EosQuarterlyRock = {
  title: string;
  owner: string;
  success_metric: string;
  deadline: string;
  status: "not_started" | "in_progress" | "done";
};

export type EosValue = {
  value: string;
  description: string;
  examples: string[];
};

export type CaptureEosHierarchySessionState = {
  session_id: string;
  step?: string;
  ten_year_target?: EosTenYearTarget;
  three_year_picture?: EosThreeYearPicture;
  one_year_plans?: EosOneYearPlan[];       // multiple entries allowed
  quarterly_rocks?: EosQuarterlyRock[];
  values?: EosValue[];
  functional_domains?: string[];           // just domain names
  user_confirmation?: boolean;
};