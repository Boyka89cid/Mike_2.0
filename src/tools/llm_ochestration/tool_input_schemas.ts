import { z } from "zod";

const TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_domain: z.object({
    session_state: z.object({
      session_id: z.string(),
      step: z.string().optional(),
      area_of_business: z.string().optional(),
      questions_with_this_domain: z.array(z.string()).optional(),
      scope_of_domain: z.object({
        covers: z.array(z.string()),
        not_covers: z.array(z.string())
      }).optional(),
      extra_details: z.string().optional(),
      user_confirmation: z.boolean().optional(),
    })
  }),
  read_domain: z.object({
    session_state: z.object({
      session_id: z.string(),
      step: z.string().optional(),
      display_name: z.string().optional(),
      query: z.string().optional(),
      response: z.string().optional(),
    })
  }),
  clear_session: z.object({
    session_state: z.object({
      session_id: z.string().optional(),
    })
  }),
  answer_domain_questions: z.object({
    session_state: z.object({
      session_id: z.string(),
      step: z.string().optional(),
      display_name: z.string().optional(),
      answer: z.string().optional(),
      mark_irrelevant: z.boolean().optional(),
      skip_question: z.boolean().optional(),
    })
  }),
  get_frequently_asked_questions: z.object({
    session_state: z.object({
      session_id: z.string(),
    })
  }),
  capture_eos_hierarchy: z.object({
    session_state: z.object({
      session_id: z.string(),
      step: z.string().optional(),
      ten_year_target: z.object({
        goal: z.string(),
        metrics: z.array(z.string()),
        why: z.string(),
        confidence: z.enum(["low", "medium", "high"]),
      }).optional(),
      three_year_picture: z.object({
        revenue: z.string(),
        product: z.string(),
        team: z.string(),
        market_position: z.string(),
        key_capabilities: z.array(z.string()),
      }).optional(),
      one_year_plans: z.array(z.object({
        goals: z.array(z.string()),
        metrics: z.array(z.string()),
        priorities: z.array(z.string()),
        constraints: z.array(z.string()),
      })).optional(),
      quarterly_rocks: z.array(z.object({
        title: z.string(),
        owner: z.string(),
        success_metric: z.string(),
        deadline: z.string(),
        status: z.enum(["not_started", "in_progress", "done"]),
      })).optional(),
      values: z.array(z.object({
        value: z.string(),
        description: z.string(),
        examples: z.array(z.string()),
      })).optional(),
      functional_domains: z.array(z.string()).optional(),
      user_confirmation: z.boolean().optional(),
    })
  }),
};

export { TOOL_SCHEMAS };