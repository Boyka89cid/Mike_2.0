export const TOOL_ANNOTATIONS: Record<string, any> = {
  get_frequently_asked_questions: {
    title: "Get Frequently Asked Questions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  read_domain: {
    title: "Read Domain",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  read_eos_hierarchy: {
    title: "Read EOS Hierarchy",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  answer_domain_questions: {
    title: "Answer Domain Questions",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  update_domain_answers: {
    title: "Update Domain Answers",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  update_eos_hierarchy: {
    title: "Update EOS Hierarchy",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  create_domain: {
    title: "Create Domain",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  capture_eos_hierarchy: {
    title: "Capture EOS Hierarchy",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },

  clear_session: {
    title: "Clear Session",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  list_domains: {
    title: "List Domains",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  check_supabase_connection: {
    title: "Check Supabase Connection",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
