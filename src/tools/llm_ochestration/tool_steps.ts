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
  FETCH_QUESTIONS: "fetch_questions",
  GET_QUESTION: "get_question",
  ANSWER_QUESTION: "answer_question",
  DELETE_QUESTION: "delete_question",
  SKIP_QUESTION: "skip_question",
} as const;

export type AddContentSteps = (typeof AddContentSteps)[keyof typeof AddContentSteps];

export const CaptureEosHierarchySteps = {
  ASK_TEN_YEAR_TARGET:    "ask_ten_year_target",
  ASK_THREE_YEAR_PICTURE: "ask_three_year_picture",
  ASK_ONE_YEAR_PLAN:      "ask_one_year_plan",
  ASK_QUARTERLY_ROCKS:    "ask_quarterly_rocks",
  ASK_MORE_ROCKS:         "ask_more_rocks",
  ASK_VALUES:             "ask_values",
  ASK_MORE_VALUES:        "ask_more_values",
  ASK_FUNCTIONAL_DOMAINS: "ask_functional_domains",
  USER_CONFIRMATION:      "user_confirmation",
  INSERT:                 "insert",
} as const;

export type CaptureEosHierarchySteps = (typeof CaptureEosHierarchySteps)[keyof typeof CaptureEosHierarchySteps];

export const GetFrequentlyAskedQuestionsSteps = {
  ASK_TYPE_OF_QUESTIONS_NEEDED: "ask_type_of_questions_needed",
  FETCH_QUESTIONS: "fetch_questions",
  SUMMARIZE_QUESTIONS_WITH_ANSWERS: "summarize_questions_with_answers",
  DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY: "display_top_3_questions_with_frequency",
} as const;

export const ReadEosHierarchySteps = {
  ASK_LEVEL:  "ask_level",
  ASK_FOCUS:  "ask_focus",
  FETCH:      "fetch",
  LOG_QUERY:  "log_query",
} as const;

export type ReadEosHierarchySteps = (typeof ReadEosHierarchySteps)[keyof typeof ReadEosHierarchySteps];

export const UpdateEosHierarchySteps = {
  ASK_LEVEL:     "ask_level",
  FETCH_CURRENT: "fetch_current",
  ASK_UPDATE:    "ask_update",
  UPDATE:        "update",
} as const;

export type UpdateEosHierarchySteps = (typeof UpdateEosHierarchySteps)[keyof typeof UpdateEosHierarchySteps];

export const UpdateDomainAnswersSteps = {
  ASK_QUESTION:    "ask_question",
  SEARCH:          "search",
  CONFIRM_MATCH:   "confirm_match",
  UPDATE_ANSWER:   "update_answer",
} as const;

export type UpdateDomainAnswersSteps = (typeof UpdateDomainAnswersSteps)[keyof typeof UpdateDomainAnswersSteps];