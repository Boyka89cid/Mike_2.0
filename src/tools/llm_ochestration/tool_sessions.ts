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
  logged_without_chunks?: boolean; // true when question was already logged in GENERATE (no-chunks path)
};

export type CreateDomainSessionState = {
  session_id: string;
  step?: string;
  area_of_business?: string;
  questions_with_this_domain?: string[];
  scope_of_domain?: { covers: string[], not_covers: string[]};
  extra_details?: string;
  user_confirmation?: boolean;
};

export type PendingQuestion = {
  id: string;
  question: string;
  category: string;
};

export type AddContentSessionState = {
  session_id: string;
  step?: string;
  display_name?: string;
  domain_slug?: string;
  current_question_index?: number;
  answer?: string;
  mark_irrelevant?: boolean;
  skip_question?: boolean;
};

export type GetFrequentlyAskedQuestionsSessionState = {
  session_id: string;
  step?: string;
  type_of_questions_needed?: "most_frequent_by_domain" | "most_frequent_by_time" | "most_frequent_overall";
  domain_slug?: string;
  top_questions?: { question: string; response: string; frequency: number; asked_at: string }[];
  summarized?: boolean;
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
  one_year_plans?: EosOneYearPlan[];
  quarterly_rocks?: EosQuarterlyRock[];
  add_more_rocks?: boolean;
  values?: EosValue[];
  add_more_values?: boolean;
  functional_domains?: string[];
  user_confirmation?: boolean;
};

// Server-only — never returned to LLM, accumulates each level as it is captured
export type CaptureEosHierarchyServerState = {
  captured_ten_year?: EosTenYearTarget;
  captured_three_year?: EosThreeYearPicture;
  captured_one_year?: EosOneYearPlan[];
  captured_quarterly_rocks?: EosQuarterlyRock[];
  captured_values?: EosValue[];
  captured_functional_domains?: string[];
};

export type FrequentlyAskedQuestionsSessionState = {
  session_id: string;
};

export type ReadEosHierarchySessionState = {
  session_id: string;
  eos_level?: "ten_year" | "three_year" | "one_year" | "quarterly_rock" | "values" | "context" | "all";
  focus?: string;
  response?: string;
};

export type UpdateEosHierarchySessionState = {
  session_id: string;
  eos_level?: "ten_year" | "three_year" | "one_year" | "quarterly_rock" | "values" | "context";
  item_id?: string;       // ID of the eos_items row being updated
  updated_content?: any;  // new content provided by the user
};

export type UpdateDomainAnswersSessionState = {
  session_id: string;
  step?: string;
  query?: string;            // the question/topic the user wants to update
  matched_id?: string;       // exec_knowledge row id of the best match
  matched_question?: string; // the matched question text
  matched_domain?: string;   // the domain slug of the match
  current_answer?: string;   // existing answer in the DB
  new_answer?: string;       // updated answer provided by user
};
