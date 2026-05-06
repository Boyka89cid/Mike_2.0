import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseAdapter } from "../../adapter/supabase_adapter.ts";
import { EmbeddingAdapter } from "../../adapter/embedding_adapter.ts";
import { SupabaseHelperFxns } from "../supabase_helper_fxns.ts";
import { AddContentSteps, CaptureEosHierarchySteps, CreateDomainSteps, ReadDomainSteps } from "./tool_steps.ts";
import type { AddContentSessionState, CaptureEosHierarchySessionState, CreateDomainSessionState, ReadDomainSessionState, PendingQuestion } from "./tool_sessions.ts";
import { ToolPrompts } from "./tool_prompts.ts";
import { GenerationPrompts } from "./generation_prompts.ts";
import { globalState } from "../../index.ts";
import { TOOL_SCHEMAS } from "./tool_input_schemas.ts";
import { OpenAIHelpers, type QuestionWithTags } from "./openai_helpers.ts";

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
        // if (result.widget) {
        //   result.widget += "; the user can always speak out or type their response freely — make sure that this kind of option is always available in the ask_user_input_v0 widget alongside the generated options.";
        // }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };}
    );
  }
}

const ADD_CONTENT_SESSIONS: Record<string, AddContentSessionState> = {};
const ADD_CONTENT_QUESTION_CACHE: Record<string, PendingQuestion[]> = {};
const CREATE_DOMAIN_SESSIONS: Record<string, CreateDomainSessionState> = {};
const CREATE_DOMAIN_SERVER_STATE: Record<string, { generated_questions?: QuestionWithTags[]; user_questions_with_tags?: QuestionWithTags[] }> = {};
const READ_DOMAIN_SESSIONS: Record<string, ReadDomainSessionState> = {};
const CAPTURE_EOS_HIERARCHY_SESSIONS: Record<string, CaptureEosHierarchySessionState> = {};
const EOS_EXISTENCE_CHECKED = new Set<string>(); // tracks exec_ids already checked this server session

class OrchestrationTools {
  private adapter: SupabaseAdapter;
  private helper: SupabaseHelperFxns;

  constructor() {
    this.adapter = new SupabaseAdapter();
    this.helper = new SupabaseHelperFxns();
  }

  async get_frequently_asked_questions(_session_state: { session_id: string }): Promise<Record<string, any>> {
    try {
      const faqs = await this.helper.get_frequently_asked_questions(this.adapter, globalState.executive_name!);
      if (faqs.length === 0) {
        return { status: "empty", message: "No questions have been asked yet." };
      }
      return {
        status: "success",
        total: faqs.length,
        questions: faqs.map((f, i) => ({ rank: i + 1, question: f.question, frequency: f.frequency ?? 1 })),
      };
    } catch (e: any) {
      return { status: "error", message: `Failed to fetch frequently asked questions: ${e.message}` };
    }
  }

  async clear_session(session_state: { session_id?: string }): Promise<Record<string, any>> {
    const id = session_state?.session_id;
    if (id) {
      delete ADD_CONTENT_SESSIONS[id];
      delete ADD_CONTENT_QUESTION_CACHE[id];
      delete CREATE_DOMAIN_SESSIONS[id];
      delete CREATE_DOMAIN_SERVER_STATE[id];
      delete READ_DOMAIN_SESSIONS[id];
      delete CAPTURE_EOS_HIERARCHY_SESSIONS[id];
    } else {
      for (const key of Object.keys(ADD_CONTENT_SESSIONS)) { delete ADD_CONTENT_SESSIONS[key]; }
      for (const key of Object.keys(ADD_CONTENT_QUESTION_CACHE)) { delete ADD_CONTENT_QUESTION_CACHE[key]; }
      for (const key of Object.keys(CREATE_DOMAIN_SESSIONS)) { delete CREATE_DOMAIN_SESSIONS[key]; }
      for (const key of Object.keys(CREATE_DOMAIN_SERVER_STATE)) { delete CREATE_DOMAIN_SERVER_STATE[key]; }
      for (const key of Object.keys(READ_DOMAIN_SESSIONS)) { delete READ_DOMAIN_SESSIONS[key]; }
      for (const key of Object.keys(CAPTURE_EOS_HIERARCHY_SESSIONS)) { delete CAPTURE_EOS_HIERARCHY_SESSIONS[key]; }
    }
    return {
      status: "cleared",
      message: id ? `Session '${id}' has been cleared.` : "All active sessions have been cleared.",
    };
  }

  async answer_domain_questions(session_state: AddContentSessionState): Promise<Record<string, any>> {
    
    if (!session_state?.session_id) {
      return {
        status: "error",
        message: `Missing session_id in session_state ${JSON.stringify(session_state)}.`,
      };
    }

    const decideStep = (s: AddContentSessionState): string => {
      if (!s.display_name) return AddContentSteps.ASK_DISPLAY_NAME;
      if (s.current_question_index === undefined) return AddContentSteps.FETCH_QUESTIONS;
      if (s.mark_irrelevant) return AddContentSteps.DELETE_QUESTION;
      if (s.skip_question) return AddContentSteps.SKIP_QUESTION;
      if (!s.answer) return AddContentSteps.GET_QUESTION;
      return AddContentSteps.ANSWER_QUESTION;
    };

    const existing = ADD_CONTENT_SESSIONS[session_state.session_id] ?? {
      session_id: session_state.session_id,
    };

    const session: AddContentSessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id,
    };

    session.step = decideStep(session);
    ADD_CONTENT_SESSIONS[session_state.session_id] = session;

    if (session.step === AddContentSteps.ASK_DISPLAY_NAME) {
      const available = await this.helper.listDomains(this.adapter, globalState.executive_name!);
      return {
        session_id: session.session_id,
        status: AddContentSteps.ASK_DISPLAY_NAME,
        widget: "use your ask_user_input_v0 widget for single_select option in the inline-chat response",
        message: `Which domain would you like to answer questions for? Available domains are: ${available}`,
      };
    }

    if (session.step === AddContentSteps.FETCH_QUESTIONS) {
      const exec_id = globalState.executive_name!;
      const domain_slug = await this.helper.get_domain_slug_by_display_name(this.adapter, exec_id, session.display_name!);
      if (!domain_slug) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "domain_not_found",
          action: "call_create_domain",
          message: `The domain '${session.display_name}' does not exist. Exit this orchestration and immediately call the create_domain tool with area_of_business as '${session.display_name}'.`,
        };
      }

      const questions = await this.helper.get_unanswered_questions(this.adapter, exec_id, domain_slug);
      if (questions.length === 0) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "completed",
          message: `No unanswered questions found for the '${session.display_name}' domain.`,
        };
      }

      // Store all questions in server-side cache, only track index in session
      ADD_CONTENT_QUESTION_CACHE[session_state.session_id] = questions;
      session.domain_slug = domain_slug;
      session.current_question_index = 0;
      ADD_CONTENT_SESSIONS[session_state.session_id] = session;

      const first = questions[0];
      return {
        session_id: session.session_id,
        status: AddContentSteps.GET_QUESTION,
        progress: `Question 1 of ${questions.length}`,
        widget: "use your ask_user_input_v0 widget for single_select option in the inline-chat response with options: 'answer', 'mark as irrelevant/not needed', 'skip to answer later', 'end this session and answer later'",
        category: first.category,
        message: first.question,
      };
    }

    // Game loop: ASK → SAVE → ASK → SAVE ...
    const questions = ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
    const idx = session.current_question_index!;
    const current = questions[idx];

    if (session.step === AddContentSteps.GET_QUESTION) {
      return {
        session_id: session.session_id,
        status: AddContentSteps.GET_QUESTION,
        progress: `Question ${idx + 1} of ${questions.length}`,
        widget: "use your ask_user_input_v0 widget for single_select option in the inline-chat response with options: 'answer', 'mark as irrelevant/not needed', 'skip to answer later', 'end this session and answer later'",
        category: current.category,
        question: current.question,
      };
    }

    if (session.step === AddContentSteps.ANSWER_QUESTION) {
      const embeddingAdapter = new EmbeddingAdapter();
      try {
        await this.helper.save_question_answer(this.adapter, embeddingAdapter, current.id, session.answer!);
      } catch (e: any) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `Failed to save answer: ${e.message}`,
        };
      }

      const nextIdx = idx + 1;
      if (nextIdx >= questions.length) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "completed",
          message: `All questions for '${session.display_name}' have been answered.`,
        };
      }

      session.current_question_index = nextIdx;
      session.answer = undefined;
      ADD_CONTENT_SESSIONS[session_state.session_id] = session;

      const next = questions[nextIdx];
      return {
        session_id: session.session_id,
        status: AddContentSteps.ANSWER_QUESTION,
        saved: true,
        progress: `Question ${nextIdx + 1} of ${questions.length}`,
        category: next.category,
        message: `Answer saved. Present the next question to the user only by calling this tool again with step as '${AddContentSteps.GET_QUESTION}' and wait for their response before calling this tool again.`,
      };
    }

    if (session.step === AddContentSteps.DELETE_QUESTION) {
      try {
        await this.helper.delete_question(this.adapter, current.id);
      } catch (e: any) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `Failed to delete question: ${e.message}`,
        };
      }

      // Remove the deleted question from the cache so indices stay consistent
      questions.splice(idx, 1);
      ADD_CONTENT_QUESTION_CACHE[session_state.session_id] = questions;

      if (questions.length === 0 || idx >= questions.length) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "completed",
          message: `Question deleted. No more questions remaining for '${session.display_name}'.`,
        };
      }

      session.mark_irrelevant = undefined;
      session.answer = undefined;
      ADD_CONTENT_SESSIONS[session_state.session_id] = session;

      const next = questions[idx];
      return {
        session_id: session.session_id,
        status: AddContentSteps.DELETE_QUESTION,
        deleted: true,
        progress: `Question ${idx + 1} of ${questions.length}`,
        category: next.category,
        message: `Question deleted. Present the next question to the user only by calling this tool again with step as '${AddContentSteps.GET_QUESTION}' and wait for their response before calling this tool again.`,
      };
    }

    if (session.step === AddContentSteps.SKIP_QUESTION) {
      const nextIdx = idx + 1;
      if (nextIdx >= questions.length) {
        delete ADD_CONTENT_SESSIONS[session_state.session_id];
        delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
        return {
          session_id: session.session_id,
          status: "completed",
          message: `No more questions remaining for '${session.display_name}'. Skipped question will still be unanswered and available next time.`,
        };
      }

      session.current_question_index = nextIdx;
      session.skip_question = undefined;
      session.answer = undefined;
      ADD_CONTENT_SESSIONS[session_state.session_id] = session;

      const next = questions[nextIdx];
      return {
        session_id: session.session_id,
        status: AddContentSteps.SKIP_QUESTION,
        skipped: true,
        progress: `Question ${nextIdx + 1} of ${questions.length}`,
        category: next.category,
        message: `Question skipped. Present the next question to the user only by calling this tool again with step as '${AddContentSteps.GET_QUESTION}' and wait for their response before calling this tool again.`,
      };
    }

    return { status: "error", message: "Unknown step." };
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

      session.fetched_chunks = chunks.filter((c: any) => c.content?.trim());
      session.fetched_domain_context = domainContext;
      READ_DOMAIN_SESSIONS[session_state.session_id] = session;

      return {
        session_id: session.session_id,
        status: ReadDomainSteps.FETCH,
        message: "Data fetched. Call this tool again immediately to proceed to generate_answer.",
      };
    }

    if (session.step === ReadDomainSteps.GENERATE) {
      const hasChunks = (session.fetched_chunks ?? []).length > 0;

      if (!hasChunks && !session.logged_without_chunks) {
        await this.helper.log_query(
          this.adapter,
          globalState.executive_name!,
          session.query!,
          "",
          [],
        );
        session.logged_without_chunks = true;
        READ_DOMAIN_SESSIONS[session_state.session_id] = session;
      }

      return {
        session_id: session.session_id,
        status: ReadDomainSteps.GENERATE,
        query: session.query,
        domain_context: {
          covers: session.fetched_domain_context?.description?.covers ?? [],
          not_covers: session.fetched_domain_context?.description?.not_covers ?? [],
          example_questions: session.fetched_domain_context?.example_questions ?? [],
          extra_details: session.fetched_domain_context?.extra_details ?? [],
        },
        retrieved_chunks: (session.fetched_chunks ?? []).map((c: any, i: number) => ({ index: i + 1, content: c.content })),
        instruction: "Generate a comprehensive answer to the query using domain_context and retrieved_chunks. Answer in the executive's voice — confident, first-person, direct. Ground every claim in the retrieved knowledge. If the retrieved knowledge does not contain enough to answer, say so clearly. After presenting the answer, call this tool again with your response text.",
      };
    }

    if (session.step === ReadDomainSteps.LOG_QUERY) {
      delete READ_DOMAIN_SESSIONS[session_state.session_id];
      if (!session.logged_without_chunks) {
        await this.helper.log_query(
          this.adapter,
          globalState.executive_name!,
          session.query!,
          session.response!,
          (session.fetched_chunks ?? []).map((c: any) => c.id),
        );
      }
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
        // Check server-side state — generated_questions never pass through Claude's context
        if (!CREATE_DOMAIN_SERVER_STATE[session_state.session_id]?.generated_questions?.length)
          return CreateDomainSteps.GENERATE_ENTRIES;
        return CreateDomainSteps.CREATE_DOMAIN;
    };

    const existing = CREATE_DOMAIN_SESSIONS[session_state.session_id] ?? {
        session_id: session_state.session_id,
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
            message: "What area of the business does this knowledge belong to? For example, is it related to sales, customer support, engineering, speak out on your own?"
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
        try {
            const area = session.area_of_business ?? "";
            const [generatedQuestions, userQuestionsWithTags] = await Promise.all([
                OpenAIHelpers.generateAdditionalQuestions({
                    area_of_business: area,
                    questions_with_this_domain: session.questions_with_this_domain ?? [],
                    scope_of_domain: session.scope_of_domain ?? { covers: [], not_covers: [] },
                    extra_details: session.extra_details ?? "",
                }),
                OpenAIHelpers.generateTagsForQuestions(session.questions_with_this_domain ?? [], area),
            ]);
            CREATE_DOMAIN_SERVER_STATE[session.session_id] = {
                generated_questions: generatedQuestions,
                user_questions_with_tags: userQuestionsWithTags,
            };
            return {
                status: CreateDomainSteps.GENERATE_ENTRIES,
                questions_generated: generatedQuestions.length,
                message: `Generated ${generatedQuestions.length} additional questions for this domain. Call this tool again immediately to create the domain.`,
            };
        } catch (e: any) {
            return { status: "error", message: `Failed to generate additional questions: ${e.message}` };
        }
    }

    if (session.step === CreateDomainSteps.CREATE_DOMAIN) {
        const slug = (session.area_of_business ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9\s_-]/g, "")
          .replace(/\s+/g, "_")
          .replace(/^[_-]+|[_-]+$/g, "");

        const serverState = CREATE_DOMAIN_SERVER_STATE[session.session_id];
        const generatedQuestions = serverState?.generated_questions ?? [];
        const userQuestionsWithTags = serverState?.user_questions_with_tags ?? (session.questions_with_this_domain ?? []).map(q => ({ question: q, tags: [] }));

        const result = await this.helper.create_domain(this.adapter, {
            exec_id: globalState.executive_name!,
            domain_slug: slug,
            area_of_business: session.area_of_business ?? "",
            scope_of_domain: session.scope_of_domain ?? { covers: [], not_covers: [] },
            user_questions_with_tags: userQuestionsWithTags,
            generated_questions: generatedQuestions,
            extra_details: session.extra_details ? [session.extra_details] : [],
            knowledge_entries: [],
        });

        delete CREATE_DOMAIN_SESSIONS[session_state.session_id];
        delete CREATE_DOMAIN_SERVER_STATE[session_state.session_id];

        return {
            status: CreateDomainSteps.CREATE_DOMAIN,
            message: `Created domain successfully with the following details:\n ${result}. Also give the summary of the domain details back to user`
        };
    }
    return {
        status: "completed",
        message: "Create domain process completed."
    };

  }

  async capture_eos_hierarchy(session_state: CaptureEosHierarchySessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
      return {
        status: "error",
        message: `Missing session_id in session_state ${JSON.stringify(session_state)}.`,
      };
    }

    const exec_id = globalState.executive_name!;
    if (!EOS_EXISTENCE_CHECKED.has(exec_id)) {
      EOS_EXISTENCE_CHECKED.add(exec_id);
      const eosExists = await this.helper.eos_profile_exists(this.adapter, exec_id);
      if (eosExists) {
        return {
          status: "already_exists",
          message: "An EOS profile already exists for this executive.",
        };
      }
    }

    const decideStep = (s: CaptureEosHierarchySessionState): string => {
      if (!s.ten_year_target)                                         return CaptureEosHierarchySteps.ASK_TEN_YEAR_TARGET;
      if (!s.three_year_picture)                                      return CaptureEosHierarchySteps.ASK_THREE_YEAR_PICTURE;
      if (!s.one_year_plans || s.one_year_plans.length === 0)         return CaptureEosHierarchySteps.ASK_ONE_YEAR_PLAN;
      if (!s.quarterly_rocks || s.quarterly_rocks.length === 0)       return CaptureEosHierarchySteps.ASK_QUARTERLY_ROCKS;
      if (!s.values || s.values.length === 0)                         return CaptureEosHierarchySteps.ASK_VALUES;
      if (!s.functional_domains || s.functional_domains.length === 0) return CaptureEosHierarchySteps.ASK_FUNCTIONAL_DOMAINS;
      if (s.user_confirmation === undefined)                          return CaptureEosHierarchySteps.USER_CONFIRMATION;
      if (s.user_confirmation === false)                              return CaptureEosHierarchySteps.ASK_TEN_YEAR_TARGET;
      return CaptureEosHierarchySteps.INSERT;
    };

    const existing = CAPTURE_EOS_HIERARCHY_SESSIONS[session_state.session_id] ?? {
      session_id: session_state.session_id,
    };

    const session: CaptureEosHierarchySessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id,
    };

    session.step = decideStep(session);
    CAPTURE_EOS_HIERARCHY_SESSIONS[session_state.session_id] = session;

    if (session.step === CaptureEosHierarchySteps.ASK_TEN_YEAR_TARGET) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_TEN_YEAR_TARGET,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields and single_select (high | medium | low) for confidence field in the inline-chat response, decompose into mulitple turns if seperate blocks exceeed 3",
        generation: GenerationPrompts.generate_ten_year_target_draft(globalState.executive_name!),
        message: "Only after completing the generation, ask the user to define their 10 year North Star target — 4 seperate input blocks as following: goal, key metrics related to the goal, the 'why' factor of the goal, and confidence level.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.ASK_THREE_YEAR_PICTURE) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_THREE_YEAR_PICTURE,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into mulitple turns if seperate blocks exceeed 3",
        generation: GenerationPrompts.generate_three_year_picture_draft(),
        message: "Only after completing the generation, ask the user to describe their 3 year picture — 5 seperate input blocks as following: revenue, product, team, your market position, and your key capabilities.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.ASK_ONE_YEAR_PLAN) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_ONE_YEAR_PLAN,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into mulitple turns if seperate blocks exceeed 3",
        generation: GenerationPrompts.generate_one_year_plan_draft(),
        message: "Only after completing the generation, ask the user to define their 1-year execution plan — 4 seperate input blocks as following: goals, key metrics, priorities, and constraints. Multiple plans are allowed.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.ASK_QUARTERLY_ROCKS) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_QUARTERLY_ROCKS,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into mulitple turns if seperate blocks exceeed 3",
        generation: GenerationPrompts.generate_quarterly_rocks_draft(),
        message: "Only after completing the generation, ask the user to confirm and refine this quarter's Rocks — 5 seperate input blocks as following: title, owner, success metric, deadline, and status.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.ASK_VALUES) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_VALUES,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into mulitple turns if seperate blocks exceeed 3",
        generation: GenerationPrompts.generate_values_draft(globalState.executive_name!),
        message: "Only after completing the generation, ask the user to define the company's core values — 2 seperate input blocks as following: name, description, and real behavioral examples for each.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.ASK_FUNCTIONAL_DOMAINS) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.ASK_FUNCTIONAL_DOMAINS,
        widget: "use your ask_user_input_v0 widget with multi_select for domain names; allow the user to add custom names",
        generation: GenerationPrompts.generate_functional_domains_draft(globalState.executive_name!),
        message: "Only after completing the generation, ask the user which functional domains exist in their business.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.USER_CONFIRMATION) {
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.USER_CONFIRMATION,
        widget: "use your ask_user_input_v0 widget for single_select with options: Yes (Store) and No (Edit)",
        captured_hierarchy: {
          ten_year_target: session.ten_year_target,
          three_year_picture: session.three_year_picture,
          one_year_plans: session.one_year_plans,
          quarterly_rocks: session.quarterly_rocks,
          values: session.values,
          functional_domains: session.functional_domains,
        },
        message: "Here is the full EOS Knowledge Hierarchy captured so far. Review each level and confirm to store, or say 'no' to go back and edit.",
      };
    }

    if (session.step === CaptureEosHierarchySteps.INSERT) {
      const exec_id = globalState.executive_name!;
      await this.helper.upsert_eos_profile(this.adapter, exec_id, {
        ten_year: session.ten_year_target,
        three_year: session.three_year_picture,
        one_year: session.one_year_plans,
        quarterly_rocks: session.quarterly_rocks,
        values: session.values,
      });

      const hierarchy = {
        ten_year_target: session.ten_year_target,
        three_year_picture: session.three_year_picture,
        one_year_plans: session.one_year_plans,
        quarterly_rocks: session.quarterly_rocks,
        values: session.values,
        functional_domains: session.functional_domains,
      };
      delete CAPTURE_EOS_HIERARCHY_SESSIONS[session_state.session_id];
      return {
        session_id: session.session_id,
        status: CaptureEosHierarchySteps.INSERT,
        // hierarchy,
        message: "EOS Knowledge Hierarchy captured and persisted to eos_profile successfully.",
      };
    }

    return { status: "completed", message: "EOS Knowledge Hierarchy capture completed." };
  }

}  