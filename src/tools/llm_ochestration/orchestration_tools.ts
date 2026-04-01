import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseAdapter } from "../../adapter/supabase_adapter.ts";
import { EmbeddingAdapter } from "../../adapter/embedding_adapter.ts";
import { SupabaseHelperFxns } from "../supabase_helper_fxns.ts";
import { AddContentSteps, CreateDomainSteps, ReadDomainSteps } from "./tool_steps.ts";
import type { AddContentSessionState, CreateDomainSessionState, ReadDomainSessionState } from "./tool_sessions.ts";
import { ToolPrompts } from "./tool_prompts.ts";
import { GenerationPrompts } from "./generation_prompts.ts";
import { globalState } from "../../index.ts";
import { TOOL_SCHEMAS } from "./tool_input_schemas.ts";

export function registerOrchestrationTools(mcp: McpServer) {
    const orchestrationTools = new OrchestrationTools();
    const availableTools = Object.getOwnPropertyNames(OrchestrationTools.prototype).filter(
      (method) => method !== "constructor" && typeof (orchestrationTools as any)[method] === "function"
    );
  for (const toolName of availableTools) {
    const schema = TOOL_SCHEMAS[toolName];
    mcp.registerTool(
      toolName,
      {
        description: (ToolPrompts as any)[toolName] ?? `No description available for ${toolName}`,
        inputSchema: schema,
      },
      async (input) => {
        const result = await (orchestrationTools as any)[toolName](input.session_state);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };}
    );
  }
}

const ADD_CONTENT_SESSIONS: Record<string, AddContentSessionState> = {};
const CREATE_DOMAIN_SESSIONS: Record<string, CreateDomainSessionState> = {};
const READ_DOMAIN_SESSIONS: Record<string, ReadDomainSessionState> = {};

class OrchestrationTools {
  private adapter: SupabaseAdapter;
  private helper: SupabaseHelperFxns;

  constructor() {
    this.adapter = new SupabaseAdapter();
    this.helper = new SupabaseHelperFxns();
  }

  async add_content_to_domain(session_state: AddContentSessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
      return {
        status: "error",
        message: `Missing session_id in session_state ${JSON.stringify(session_state)}.`,
      };
    }

    const decideStep = (s: AddContentSessionState): string => {
      if (!s.display_name) return AddContentSteps.ASK_DISPLAY_NAME;
      if (!s.content) return AddContentSteps.ASK_CONTENT;
      if (!s.category) return AddContentSteps.ASK_CATEGORY;
      return AddContentSteps.INSERT;
    };

    const existing = ADD_CONTENT_SESSIONS[session_state.session_id] ?? {
      session_id: session_state.session_id,
      display_name: undefined,
      content: undefined,
      category: undefined,
      tags: [],
    };

    const session: AddContentSessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id,
    };

    session.step = decideStep(session);
    ADD_CONTENT_SESSIONS[session_state.session_id] = session;

    if (session.step === AddContentSteps.ASK_DISPLAY_NAME) { 
      // LIMIT is 10 for now
      const available = await this.helper.listDomains(this.adapter, globalState.executive_name!);
      return {
        session_id: session.session_id,
        status: AddContentSteps.ASK_DISPLAY_NAME,
        widget: "use your ask_user_input_v0 widget for single_select option in the inline-chat response",
        some_available_display_names: available,
        message: `Which display name would you like to add content to? Use list_domains tool if you want to see all available domains.`,
      };
    }

    if (session.step === AddContentSteps.ASK_CONTENT) {
      const exec_id = globalState.executive_name!;
      const domain_slug = await this.helper.get_domain_slug_by_display_name(this.adapter, exec_id, session.display_name!);
      if (!domain_slug) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "domain_not_found",
          action: "call_create_domain",
          message: `The domain_slug for the display name: '${session.display_name}' does not exist. Exit this orchestration and immediately call the create_domain tool to set it up, passing area_of_business as '${session.display_name}'.`,
        };
      }
      return {
        session_id: session.session_id,
        status: AddContentSteps.ASK_CONTENT,
        message: `What content or insight would you like to add to the '${session.display_name}' domain?`,
      };
    }

    if (session.step === AddContentSteps.ASK_CATEGORY) {
      return {
        session_id: session.session_id,
        status: AddContentSteps.ASK_CATEGORY,
        widget: "use your ask_user_input_v0 widget for single_select option in the inline-chat response, but also allow the user to type a custom category",
        suggested_categories: ["decision", "faq", "framework", "style", "eos_goal", "quarterly_goal"],
        message: "What category does this content belong to? You can pick from the suggestions or enter your own.",
      };
    }

    if (session.step === AddContentSteps.INSERT) {
      const exec_id = globalState.executive_name!;
      const domain_slug = await this.helper.get_domain_slug_by_display_name(this.adapter, exec_id, session.display_name!);
      if (!domain_slug) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "domain_not_found",
          action: "call_create_domain",
          message: `The domain_slug for the display name: '${session.display_name}' does not exist. Exit this orchestration and immediately call the create_domain tool to set it up, passing area_of_business as '${session.display_name}'.`,
        };
      }
      const embeddingAdapter = new EmbeddingAdapter();
      try {
        await this.helper.add_knowledge_entry(
          this.adapter,
          embeddingAdapter,
          exec_id,
          domain_slug,
          {
            content: session.content!,
            category: session.category!,
            tags: session.tags ?? [],
          }
        );
      } catch (e: any) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `Failed to add content: ${e.message}`,
        };
      }
      delete ADD_CONTENT_SESSIONS[session_state.session_id];
      return {
        session_id: session.session_id,
        status: AddContentSteps.INSERT,
        message: `Content added successfully to the '${session.display_name}' domain under category '${session.category}'.`,
      };
    }

    return { status: "completed", message: "Add content process completed." };
  }

  async read_domain(session_state: ReadDomainSessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
      return {
        status: "error",
        message: `Missing session_id in session_state ${JSON.stringify(session_state)}.`,
      };
    }
    const decideStep = (s: ReadDomainSessionState): string => {
      if (!s.display_name) return ReadDomainSteps.ASK_DISPLAY_NAME;
      if (!s.query) return ReadDomainSteps.ASK_QUERY;
      if (!s.fetched_chunks) return ReadDomainSteps.FETCH;
      if (!s.response) return ReadDomainSteps.GENERATE;
      return ReadDomainSteps.LOG_QUERY;
    };
    const existing = READ_DOMAIN_SESSIONS[session_state.session_id] ?? {
      session_id: session_state.session_id,
      display_name: undefined,
      domain_slug: undefined,
      query: undefined,
      response: undefined,
      chunks_used: [],
      step: ReadDomainSteps.ASK_DISPLAY_NAME,
    };
    const session: ReadDomainSessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id,
    };
    session.step = decideStep(session);
    READ_DOMAIN_SESSIONS[session_state.session_id] = session;

    if (session.step === ReadDomainSteps.ASK_DISPLAY_NAME) {
      const available = await this.helper.listDomains(this.adapter, globalState.executive_name!);
      return {
        session_id: session.session_id,
        status: ReadDomainSteps.ASK_DISPLAY_NAME,
        widget: 'use your ask_user_input_v0 widget for single_select option in the inline-chat response',
        message: `Which domains (domains column exists as a safe URL for the display name) would you like to read? Available domains are: ${available}`,
      };
    }

    if (session.step === ReadDomainSteps.ASK_QUERY) {
      const exec_id = globalState.executive_name!;
      const domain_slug = await this.helper.get_domain_slug_by_display_name(this.adapter, exec_id, session.display_name!);
      if (!domain_slug) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `No domain found with display name '${session.display_name}'. Confirm that the display name is correct by using the list_domains tool to see available domains.`,
        };
      }
      session.domain_slug = domain_slug;
      READ_DOMAIN_SESSIONS[session_state.session_id] = session;
      return {
        session_id: session.session_id,
        status: ReadDomainSteps.ASK_QUERY,
        message: `What would you like to know for this ${session.display_name}?`,
      };
    }

    if (session.step === ReadDomainSteps.FETCH) {
      const exec_id = globalState.executive_name!;
      const domain_slug = session.domain_slug ?? await this.helper.get_domain_slug_by_display_name(this.adapter, exec_id, session.display_name!);
      if (!domain_slug) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `No domain found with display name '${session.display_name}'. Confirm that the display name is correct by using the list_domains tool to see available domains.`,
          widget: 'use your ask_user_input_v0 widget for single_select option in the inline-chat response if you see relavant display names from list_domains tool, otherwise allow user to input a new display name to retry',
        };
      }

      const [domainContext, chunks] = await Promise.all([
        this.helper.read_domain(this.adapter, exec_id, domain_slug),
        this.helper.search_domain_chunks(this.adapter, exec_id, domain_slug, session.query!),
      ]);

      session.fetched_chunks = chunks;
      session.fetched_domain_context = domainContext;
      READ_DOMAIN_SESSIONS[session_state.session_id] = session;

      return {
        session_id: session.session_id,
        status: ReadDomainSteps.FETCH,
        message: "Data fetched. Call this tool again immediately to proceed to generate_answer.",
      };
    }

    if (session.step === ReadDomainSteps.GENERATE) {
      return {
        session_id: session.session_id,
        status: ReadDomainSteps.GENERATE,
        generation: GenerationPrompts.generate_rag_answer({
          query: session.query!,
          domain_name: session.display_name!,
          description: session.fetched_domain_context?.description ?? { covers: [], not_covers: [] },
          example_questions: session.fetched_domain_context?.example_questions ?? [],
          extra_details: session.fetched_domain_context?.extra_details ?? [],
          chunks: (session.fetched_chunks ?? []).map((c: any) => ({ id: c.id, content: c.content })),
        }),
      };
    }

    if (session.step === ReadDomainSteps.LOG_QUERY) {
      delete READ_DOMAIN_SESSIONS[session_state.session_id];
      await this.helper.log_query(
        this.adapter,
        globalState.executive_name!,
        session.query!,
        session.response!,
        (session.fetched_chunks ?? []).map((c: any) => c.id)
      );
      return {
        session_id: session.session_id,
        status: ReadDomainSteps.LOG_QUERY,
        message: "Query and response logged successfully.",
      };
    }
    return { status: "completed", message: "Read domain process completed." };
  }

  async create_domain(session_state: CreateDomainSessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
        return {
          status: "error",
          message: `Missing session_id in sessionState ${JSON.stringify(session_state)}.`,
        };
    }
    const decideStep = (s: CreateDomainSessionState): string => {
        if (!s.area_of_business) 
          return CreateDomainSteps.ASK_AREA_OF_DOMAIN;
        if (!s.questions_with_this_domain || s.questions_with_this_domain.length === 0)
          return CreateDomainSteps.ASK_QUESTIONS_WITH_THIS_DOMAIN;
        if (!s.scope_of_domain)
          return CreateDomainSteps.ASK_SCOPE_OF_DOMAIN;
        if (s.extra_details === undefined)
          return CreateDomainSteps.EXTRA_DETAILS;
        if (s.user_confirmation === undefined)
          return CreateDomainSteps.USER_CONFIRMATION;
        if (s.user_confirmation === false)
          return CreateDomainSteps.ASK_AREA_OF_DOMAIN;
        if (s.user_confirmation === true && (!s.knowledge_entries || s.knowledge_entries.length === 0))
          return CreateDomainSteps.GENERATE_ENTRIES;
        return CreateDomainSteps.CREATE_DOMAIN;
    }

    // Use provided session_id or generate a new one if not provided
    // Retrieve existing session or create a new one
    const existing = CREATE_DOMAIN_SESSIONS[session_state.session_id] ?? {
        session_id: session_state.session_id,
        area_of_business: undefined,
        questions_with_this_domain: undefined,
        scope_of_domain: undefined,
        extra_details: undefined,
        user_confirmation: undefined,
        knowledge_entries: undefined,
        step: CreateDomainSteps.ASK_AREA_OF_DOMAIN,
      };

    // Merge new input into existing session
    const session: CreateDomainSessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id, // Ensure session_id is always from input
    };

    session.step = decideStep(session);
    CREATE_DOMAIN_SESSIONS[session_state.session_id] = session;

    if (session.step === CreateDomainSteps.ASK_AREA_OF_DOMAIN) {
        const existing_domains = await this.helper.listDomains(this.adapter, globalState.executive_name!);
        return {
            status: CreateDomainSteps.ASK_AREA_OF_DOMAIN,
            existing_domains : existing_domains,
            widget: 'use ask_user_input_v0 widget for single_select option in the inline-chat response excluding already existing_domains',
            message: "What area of the business does this knowledge belong to? For example, is it related to sales, customer support, engineering, etc.?"
        }
    }
    if (session.step === CreateDomainSteps.ASK_QUESTIONS_WITH_THIS_DOMAIN) {
        const existing_domains = (await this.helper.listDomains(this.adapter, globalState.executive_name!)).split(", ");
        const slug = (session.area_of_business ?? "").toLowerCase().replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
        if (slug && existing_domains.includes(slug)) {
            session.step = CreateDomainSteps.ASK_AREA_OF_DOMAIN;
            return {
                status: "error",
                message: "A domain with this area of business already exists. Please choose a different area of business or edit the existing domain."
            }
        }
        else {
          return {
            status: CreateDomainSteps.ASK_QUESTIONS_WITH_THIS_DOMAIN,
            widget: 'use your ask_user_input_v0 widget for doing multi_select in the inline-chat response. Widget should contain generated questions not and keywords; allowing user to input their own questions as well',
            generation: GenerationPrompts.generate_example_questions(session.area_of_business ?? ""),
            message: "Only after completing the generation, ask user what kinds of questions should someone be able to ask this domain from your generated questions. "
          }
      }
    }
    if (session.step === CreateDomainSteps.ASK_SCOPE_OF_DOMAIN) {
        return {
            status: CreateDomainSteps.ASK_SCOPE_OF_DOMAIN,
            widget: 'use your ask_user_input_v0 widget for multi_select option in the inline-chat response',
            generation: GenerationPrompts.generate_scope_of_domain(session.area_of_business ?? "", session.questions_with_this_domain ?? []),
            message: `Ask user what is the scope of ${session.area_of_business} you want to create? What does this domain cover — and what should it NOT cover?`
        }
    }
    if (session.step === CreateDomainSteps.EXTRA_DETAILS) {
        return {
            status: CreateDomainSteps.EXTRA_DETAILS,
            widget: 'use your ask_user_input_v0 widget for multi_select option in the inline-chat response',
            generation: GenerationPrompts.generate_extra_details(session.area_of_business ?? ""),
            message: "Only after completing the generation, ask user if there is anything else about how they think about this area that they want to capture now while we're setting it up."
        }
    }

    if (session.step === CreateDomainSteps.USER_CONFIRMATION) {
        return {
            status: CreateDomainSteps.USER_CONFIRMATION,
            widget: 'use your ask_user_input_v0 widget for single_select option in the inline-chat response with options Yes(Confirm) and No(Cancel)',
            message: `Please confirm that you want to create a domain with the following details:\nArea of Business: ${session.area_of_business}\nScope of Domain: ${session.scope_of_domain}\nQuestions with this Domain:  ${session.questions_with_this_domain?.join(", ")}\nExtra Details: ${session.extra_details}\n\nPlease say 'yes' to confirm or 'no' to go back and edit the details.`
        }
    }
    if (session.step === CreateDomainSteps.GENERATE_ENTRIES) {
        return {
            status: CreateDomainSteps.GENERATE_ENTRIES,
            generation: GenerationPrompts.generate_knowledge_entries({
                area_of_business: session.area_of_business ?? "",
                questions_with_this_domain: session.questions_with_this_domain ?? [],
                covers: session.scope_of_domain?.covers ?? [],
                not_covers: session.scope_of_domain?.not_covers ?? [],
                extra_details: session.extra_details ?? "",
            }),
        };
    }

    if (session.step === CreateDomainSteps.CREATE_DOMAIN) {
        // Generate a valid domain_slug that satisfies DB constraint for URL friendly:
        // ^[a-z0-9][a-z0-9_-]*[a-z0-9]$

        const slug = (session.area_of_business ?? "")
          .toLowerCase() 
          // Convert all characters to lowercase (constraint allows only a-z, 0-9)

          .replace(/[^a-z0-9\s_-]/g, "")
          // Remove all invalid characters
          // Keeps only:
          // - lowercase letters (a-z)
          // - digits (0-9)
          // - space (for now, will convert next)
          // - underscore (_) and hyphen (-)

          .replace(/\s+/g, "_")
          // Replace one or more spaces with a single underscore (_)

          .replace(/^[_-]+|[_-]+$/g, "");
          // Remove leading or trailing underscores (_) or hyphens (-)
          // Ensures slug starts and ends with [a-z0-9]


        // Final value to insert into DB as domain_slug
        const result = await this.helper.create_domain(this.adapter, {
            exec_id: globalState.executive_name!,
            domain_slug: slug,
            area_of_business: session.area_of_business ?? "",
            scope_of_domain: session.scope_of_domain ?? { covers: [], not_covers: [] },
            questions_with_this_domain: session.questions_with_this_domain ?? [],
            extra_details: session.extra_details ? [session.extra_details] : [],
            knowledge_entries: session.knowledge_entries ?? [],
        });
        return {
            status: CreateDomainSteps.CREATE_DOMAIN,
            message: `Created domain successfully with the following details:\n ${result}. Also give the summary of the domain details back to user`
        }
    }
    return {
        status: "completed",
        message: "Create domain process completed."
    };

  } 
}  