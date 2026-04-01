export const ReadDomainSteps = {
  ASK_DISPLAY_NAME: "ask_display_name",
  ASK_QUERY: "ask_query",
  FETCH: "fetch_domain",
  GENERATE: "generate_answer",
  LOG_QUERY: "log_query",
} as const;

export type ReadDomainSteps = (typeof ReadDomainSteps)[keyof typeof ReadDomainSteps];

export const ListDomainSteps = {
  // ASK_EXEC_NAME: "ask_exec_name",
  FETCH: "fetch",
} as const;

export type ListDomainSteps = (typeof ListDomainSteps)[keyof typeof ListDomainSteps];

export const CreateDomainSteps = {
  ASK_AREA_OF_DOMAIN: "ask_area_of_domain",
  ASK_QUESTIONS_WITH_THIS_DOMAIN: "ask_questions_with_this_domain",
  ASK_SCOPE_OF_DOMAIN: "ask_scope_of_domain",
  EXTRA_DETAILS: "extra_details",
  USER_CONFIRMATION: "user_confirmation",
  GENERATE_ENTRIES: "generate_entries",
  CREATE_DOMAIN: "create_domain",
} as const;

export type CreateDomainSteps = (typeof CreateDomainSteps)[keyof typeof CreateDomainSteps];

export const AddContentSteps = {
  ASK_DISPLAY_NAME: "ask_display_name",
  ASK_CONTENT: "ask_content",
  ASK_CATEGORY: "ask_category",
  INSERT: "insert",
} as const;

export type AddContentSteps = (typeof AddContentSteps)[keyof typeof AddContentSteps];