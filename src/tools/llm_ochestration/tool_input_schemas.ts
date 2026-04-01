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
      knowledge_entries: z.array(z.object({
        content: z.string(),
        category: z.string(),
        tags: z.array(z.string()),
      })).optional(),
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
  add_content_to_domain: z.object({
    session_state: z.object({
      session_id: z.string(),
      step: z.string().optional(),
      display_name: z.string().optional(),
      //domain_slug: z.string().optional(),
      content: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
  })
};

export { TOOL_SCHEMAS };