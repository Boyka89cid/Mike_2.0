import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseAdapter } from "../../adapter/supabase_adapter.ts";
import { EmbeddingAdapter } from "../../adapter/embedding_adapter.ts";
import { SupabaseHelperFxns } from "../supabase_helper_fxns.ts";
import { AddContentSteps, CaptureEosHierarchySteps, CreateDomainSteps, ReadDomainSteps, GetFrequentlyAskedQuestionsSteps, ReadEosHierarchySteps, UpdateEosHierarchySteps, UpdateDomainAnswersSteps } from "./tool_steps.ts";
import type { AddContentSessionState, CaptureEosHierarchySessionState, CaptureEosHierarchyServerState, CreateDomainSessionState, ReadDomainSessionState, PendingQuestion, GetFrequentlyAskedQuestionsSessionState, ReadEosHierarchySessionState, UpdateEosHierarchySessionState, UpdateDomainAnswersSessionState } from "./tool_sessions.ts";
import { ToolPrompts } from "./tool_prompts.ts";
import { GenerationPrompts } from "./generation_prompts.ts";
import { globalState } from "../../index.ts";
import { TOOL_SCHEMAS } from "./tool_input_schemas.ts";
import { OpenAIHelpers, type QuestionWithTags } from "./openai_helpers.ts";
import { TOOL_ANNOTATIONS } from "./tool_annotations.ts";

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
        annotations: TOOL_ANNOTATIONS[toolName] ?? {
          title: toolName,
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false
        },
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
const CAPTURE_EOS_SERVER_STATE: Record<string, CaptureEosHierarchyServerState> = {};

const GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS: Record<string, GetFrequentlyAskedQuestionsSessionState> = {};
const READ_EOS_HIERARCHY_SESSIONS: Record<string, ReadEosHierarchySessionState> = {};
const UPDATE_EOS_HIERARCHY_SESSIONS: Record<string, UpdateEosHierarchySessionState> = {};
const UPDATE_DOMAIN_ANSWERS_SESSIONS: Record<string, UpdateDomainAnswersSessionState> = {};

class OrchestrationTools {
  private adapter: SupabaseAdapter;
  private helper: SupabaseHelperFxns;
  private openaiHelper: OpenAIHelpers;

  constructor() {
    this.adapter = new SupabaseAdapter();
    this.helper = new SupabaseHelperFxns();
    this.openaiHelper = new OpenAIHelpers();
  }

  // Finite State Machine orchestration for most frequently asked questions tool
  //TODO: can every question be given a domain?
  async get_frequently_asked_questions(session_state: GetFrequentlyAskedQuestionsSessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
      return {
        status: "error",
        message: `Missing session_id in session_state ${JSON.stringify(session_state)}.`,
      };
    }
    const decideStep = (s: GetFrequentlyAskedQuestionsSessionState): string => {
      if (!s.type_of_questions_needed) return GetFrequentlyAskedQuestionsSteps.ASK_TYPE_OF_QUESTIONS_NEEDED;
      if (s.type_of_questions_needed === "most_frequent_by_domain" && !s.domain_slug) return GetFrequentlyAskedQuestionsSteps.ASK_TYPE_OF_QUESTIONS_NEEDED;
      if (!s.top_questions) return GetFrequentlyAskedQuestionsSteps.FETCH_QUESTIONS;
      if (s.summarized || s.top_questions.length === 0) return GetFrequentlyAskedQuestionsSteps.DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY;
      return GetFrequentlyAskedQuestionsSteps.SUMMARIZE_QUESTIONS_WITH_ANSWERS;
    };
    const existing = GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[session_state.session_id] ?? {
      session_id: session_state.session_id,
    };
    const session: GetFrequentlyAskedQuestionsSessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: session_state.session_id,
    };
    session.step = decideStep(session);
    GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[session_state.session_id] = session;
    if (session.step === GetFrequentlyAskedQuestionsSteps.ASK_TYPE_OF_QUESTIONS_NEEDED) {
      return {
        session_id: session.session_id,
        status: GetFrequentlyAskedQuestionsSteps.ASK_TYPE_OF_QUESTIONS_NEEDED,
        widget: 'use your ask_user_input_v0 widget for single_select option in the inline-chat response',
        message: 'What type of frequently asked questions do you want to see? Show options without underscores and with proper capitalization: most frequent by domain, most frequent by time, most frequent overall',
        options: ['most_frequent_by_domain', 'most_frequent_by_time', 'most_frequent_overall'],
      };
    }
    if (session.step === GetFrequentlyAskedQuestionsSteps.FETCH_QUESTIONS) {
      try {
        const type = session.type_of_questions_needed!;
        let questions;
        if (type === 'most_frequent_by_domain') {
          questions = await this.helper.get_frequently_asked_questions_by_domain(this.adapter, globalState.executive_name!, session.domain_slug!);
        } else if (type === 'most_frequent_by_time') {
          questions = await this.helper.get_frequently_asked_questions_by_time(this.adapter, globalState.executive_name!);
        } else {
          questions = await this.helper.get_frequently_asked_questions_by_quantity(this.adapter, globalState.executive_name!);
        }
        session.top_questions = questions;
        GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[session_state.session_id] = session;
        return {
          session_id: session.session_id,
          status: GetFrequentlyAskedQuestionsSteps.FETCH_QUESTIONS,
          message: `Fetched top frequently asked questions successfully.`,
        };
      } catch (e: any) {
        return {
          session_id: session.session_id,
          status: "error",
          message: `Failed to fetch frequently asked questions: ${e.message}`,
        };
      }
    }
    if (session.step === GetFrequentlyAskedQuestionsSteps.SUMMARIZE_QUESTIONS_WITH_ANSWERS) {
      session.summarized = true;
      GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[session_state.session_id] = session;
      return {
        session_id: session.session_id,
        status: GetFrequentlyAskedQuestionsSteps.SUMMARIZE_QUESTIONS_WITH_ANSWERS,
        message: "Present the following frequently asked questions and their answers as a concise summary to the user. Once the summary is presented, call this tool again to display the top 3 questions in a table:\n" + session.top_questions!.map(q => `Question: ${q.question}\nAnswer: ${q.response}\nFrequency: ${q.frequency}\nAsked At: ${q.asked_at}`).join("\n\n"),
      };
    }
    if (session.step === GetFrequentlyAskedQuestionsSteps.DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY) {
      delete GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[session_state.session_id];
      const top_3 = [...session.top_questions!].sort((a, b) => b.frequency - a.frequency).slice(0, 3);
      if (top_3.length === 0) {
        return {
          session_id: session.session_id,
          status: GetFrequentlyAskedQuestionsSteps.DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY,
          message: "No frequently asked questions found.",
        };
      }
      if (top_3.length < 3) {
        return {
          session_id: session.session_id,
          status: GetFrequentlyAskedQuestionsSteps.DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY,
          message: `Only ${top_3.length} frequently asked questions found:\n` + top_3.map(q => `Question: ${q.question}\nFrequency: ${q.frequency}\nAsked At: ${q.asked_at}`).join("\n\n"),
        };
      }
      return {
        session_id: session.session_id,
        status: GetFrequentlyAskedQuestionsSteps.DISPLAY_TOP_3_QUESTIONS_WITH_FREQUENCY,
        widget: "use table view widget in the inline-chat response to display the questions, their frequency and when they were last asked",
        message: "Here are the top 3 frequently asked questions:\n" + top_3.map(q => `Question: ${q.question}\nFrequency: ${q.frequency}\nAsked At: ${q.asked_at}`).join("\n\n"),
      };
    }
    return {
      status: "success",
      step: session.step,
      session_id: session.session_id,
    };
  }

  // Finite State Machine orchestration for reading EOS hierarchy
  async read_eos_hierarchy(session_state: ReadEosHierarchySessionState): Promise<Record<string, any>> {
    const sid = session_state?.session_id;
    if (!sid) return { status: "error", message: "Missing session_id." };

    const existing = READ_EOS_HIERARCHY_SESSIONS[sid] ?? { session_id: sid };
    const session: ReadEosHierarchySessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: sid,
    };
    READ_EOS_HIERARCHY_SESSIONS[sid] = session;

    const exec_id = globalState.executive_name!;

    if (!session.eos_level) {
      return {
        session_id: sid,
        status: ReadEosHierarchySteps.ASK_LEVEL,
        widget: "use your ask_user_input_v0 widget for single_select in the inline-chat response",
        options: ["ten_year", "three_year", "one_year", "quarterly_rock", "values", "context", "all"],
        message: "Which part of the EOS hierarchy would you like to see? Options: 10-Year Target, 3-Year Picture, 1-Year Plan, Quarterly Rocks, Values, Functional Domains, Everything. Call this tool again with eos_level set to the chosen key.",
      };
    }

    if (session.eos_level !== "all" && !session.focus) {
      const focusHints: Record<string, string> = {
        ten_year:       "goal, metrics, why, confidence, or full picture",
        three_year:     "revenue, product, team, market position, key capabilities, or full picture",
        one_year:       "goals, metrics, priorities, constraints, or full picture",
        quarterly_rock: "specific rock by title, or all rocks",
        values:         "specific value by name, or all values",
        context:        "full picture",
      };
      return {
        session_id: sid,
        status: ReadEosHierarchySteps.ASK_FOCUS,
        message: `What specifically do you want to see for the ${session.eos_level.replace(/_/g, " ")}? Options: ${focusHints[session.eos_level] ?? "full picture"}. Call this tool again with focus set to your answer.`,
      };
    }

    if (session.response) {
      delete READ_EOS_HIERARCHY_SESSIONS[sid];
      const question = `Show me the ${session.eos_level!.replace(/_/g, " ")}${session.focus && session.focus !== "full picture" ? ` — ${session.focus}` : ""}`;
      await this.helper.log_query(this.adapter, exec_id, question, session.response, "eos_hierarchy", []);
      return { session_id: sid, status: ReadEosHierarchySteps.LOG_QUERY, message: "Query and response logged successfully." };
    }

    try {
      const items = await this.helper.read_eos_items(this.adapter, exec_id, session.eos_level);
      if (items.length === 0) {
        delete READ_EOS_HIERARCHY_SESSIONS[sid];
        return {
          session_id: sid,
          status: ReadEosHierarchySteps.FETCH,
          message: `No EOS items found for level '${session.eos_level}'. The hierarchy may not have been captured yet.`,
        };
      }
      READ_EOS_HIERARCHY_SESSIONS[sid] = session;
      return {
        session_id: sid,
        status: ReadEosHierarchySteps.FETCH,
        focus: session.focus ?? "full picture",
        items,
        message: `Present the returned items to the user in a clean structured format matching the EOS level. If focus is set, highlight that specific field. After presenting, call this tool again with ONLY session_id and response (your presented text) to log the interaction.`,
      };
    } catch (e: any) {
      return { session_id: sid, status: "error", message: `Failed to read EOS items: ${e.message}` };
    }
  }

  // Finite State Machine orchestration for updating EOS hierarchy
  async update_eos_hierarchy(session_state: UpdateEosHierarchySessionState): Promise<Record<string, any>> {
    const sid = session_state?.session_id;
    if (!sid) return { status: "error", message: "Missing session_id." };

    const existing = UPDATE_EOS_HIERARCHY_SESSIONS[sid] ?? { session_id: sid };
    const session: UpdateEosHierarchySessionState = {
      ...existing,
      ...Object.fromEntries(Object.entries(session_state).filter(([_, v]) => v !== undefined && v !== null)),
      session_id: sid,
    };
    UPDATE_EOS_HIERARCHY_SESSIONS[sid] = session;

    const exec_id = globalState.executive_name!;

    if (!session.eos_level) {
      return {
        session_id: sid,
        status: UpdateEosHierarchySteps.ASK_LEVEL,
        widget: "use your ask_user_input_v0 widget for single_select in the inline-chat response",
        options: ["ten_year", "three_year", "one_year", "quarterly_rock", "values", "context"],
        message: "Which EOS level would you like to update? Options: 10-Year Target, 3-Year Picture, 1-Year Plan, Quarterly Rocks, Values, Functional Domains. Call this tool again with eos_level set to the chosen key.",
      };
    }

    if (!session.item_id) {
      try {
        const items = await this.helper.read_eos_items(this.adapter, exec_id, session.eos_level);
        if (items.length === 0) {
          delete UPDATE_EOS_HIERARCHY_SESSIONS[sid];
          return { session_id: sid, status: "error", message: `No items found for level '${session.eos_level}'. Nothing to update.` };
        }
        if (items.length === 1) {
          session.item_id = items[0].id;
          UPDATE_EOS_HIERARCHY_SESSIONS[sid] = session;
        }
        return {
          session_id: sid,
          status: UpdateEosHierarchySteps.FETCH_CURRENT,
          current_items: items,
          message: items.length === 1
            ? `Here is the current ${session.eos_level.replace(/_/g, " ")} content. Present it to the user with all fields editable in the widget. Once the user provides the updated values, call this tool again with ONLY session_id and updated_content — do not include any other fields.`
            : `Multiple items found for '${session.eos_level}'. Present them to the user and ask which one to update. Call this tool again with ONLY session_id and item_id of the chosen item.`,
        };
      } catch (e: any) {
        return { session_id: sid, status: "error", message: `Failed to fetch current items: ${e.message}` };
      }
    }

    if (!session.updated_content) {
      return {
        session_id: sid,
        status: UpdateEosHierarchySteps.ASK_UPDATE,
        message: "Present the current content in the widget with fields pre-filled for the user to edit. Once the user confirms their changes, call this tool again with ONLY session_id and updated_content containing the full updated object.",
      };
    }

    try {
      await this.helper.update_eos_item(this.adapter, exec_id, session.item_id, session.eos_level, session.updated_content);
      delete UPDATE_EOS_HIERARCHY_SESSIONS[sid];
      return {
        session_id: sid,
        status: UpdateEosHierarchySteps.UPDATE,
        message: `${session.eos_level.replace(/_/g, " ")} updated successfully. Present the updated content to the user.`,
        updated_content: session.updated_content,
      };
    } catch (e: any) {
      return { session_id: sid, status: "error", message: `Failed to update EOS item: ${e.message}` };
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
      delete CAPTURE_EOS_SERVER_STATE[id];
      delete GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[id];
      delete READ_EOS_HIERARCHY_SESSIONS[id];
      delete UPDATE_EOS_HIERARCHY_SESSIONS[id];
      delete UPDATE_DOMAIN_ANSWERS_SESSIONS[id];
    } else {
      for (const key of Object.keys(ADD_CONTENT_SESSIONS)) { delete ADD_CONTENT_SESSIONS[key]; }
      for (const key of Object.keys(ADD_CONTENT_QUESTION_CACHE)) { delete ADD_CONTENT_QUESTION_CACHE[key]; }
      for (const key of Object.keys(CREATE_DOMAIN_SESSIONS)) { delete CREATE_DOMAIN_SESSIONS[key]; }
      for (const key of Object.keys(CREATE_DOMAIN_SERVER_STATE)) { delete CREATE_DOMAIN_SERVER_STATE[key]; }
      for (const key of Object.keys(READ_DOMAIN_SESSIONS)) { delete READ_DOMAIN_SESSIONS[key]; }
      for (const key of Object.keys(CAPTURE_EOS_HIERARCHY_SESSIONS)) { delete CAPTURE_EOS_HIERARCHY_SESSIONS[key]; }
      for (const key of Object.keys(CAPTURE_EOS_SERVER_STATE)) { delete CAPTURE_EOS_SERVER_STATE[key]; }
      for (const key of Object.keys(GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS)) { delete GET_FREQUENTLY_ASKED_QUESTIONS_SESSIONS[key]; }
      for (const key of Object.keys(READ_EOS_HIERARCHY_SESSIONS)) { delete READ_EOS_HIERARCHY_SESSIONS[key]; }
      for (const key of Object.keys(UPDATE_EOS_HIERARCHY_SESSIONS)) { delete UPDATE_EOS_HIERARCHY_SESSIONS[key]; }
      for (const key of Object.keys(UPDATE_DOMAIN_ANSWERS_SESSIONS)) { delete UPDATE_DOMAIN_ANSWERS_SESSIONS[key]; }
    }
    return {
      status: "cleared",
      message: id ? `Session '${id}' has been cleared.` : "All active sessions have been cleared.",
    };
  }

  // Cyclic State Machine orchestration for answering domain questions
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

      let questions = await this.helper.get_unanswered_questions(this.adapter, exec_id, domain_slug);
      
      if (questions.length === 0) {
        const next = await this.openaiHelper.generateAndStoreBatch({ supabaseAdapter: this.adapter, helper: this.helper, exec_id, domain_slug, display_name: session.display_name! });
        if (!next || next.length === 0) {
          delete ADD_CONTENT_SESSIONS[session_state.session_id];
          delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
          return { session_id: session.session_id, status: "completed", message: `All questions for '${session.display_name}' have been answered. Knowledge base is complete.` };
        }
        questions = next;
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
        const exec_id = globalState.executive_name!;
        const next = await this.openaiHelper.generateAndStoreBatch({ supabaseAdapter: this.adapter, helper: this.helper, exec_id, domain_slug: session.domain_slug!, display_name: session.display_name! });
        if (!next || next.length === 0) {
          delete ADD_CONTENT_SESSIONS[session_state.session_id];
          delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
          return { session_id: session.session_id, status: "completed", message: `All questions for '${session.display_name}' have been answered. Knowledge base is complete.` };
        }
        ADD_CONTENT_QUESTION_CACHE[session_state.session_id] = next;
        session.current_question_index = 0;
        session.answer = undefined;
        ADD_CONTENT_SESSIONS[session_state.session_id] = session;
        return { session_id: session.session_id, status: AddContentSteps.ANSWER_QUESTION, saved: true, progress: `Question 1 of ${next.length} (new batch)`, category: next[0].category, message: `Answer saved. New questions generated. Present the next question to the user by calling this tool again with step as '${AddContentSteps.GET_QUESTION}'.` };
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
        await this.helper.delete_question(this.adapter, current.id, globalState.executive_name!, session.domain_slug!);
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
        const exec_id = globalState.executive_name!;
        const next = await this.openaiHelper.generateAndStoreBatch({ supabaseAdapter: this.adapter, helper: this.helper, exec_id, domain_slug: session.domain_slug!, display_name: session.display_name! });
        if (!next || next.length === 0) {
          delete ADD_CONTENT_SESSIONS[session_state.session_id];
          delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
          return { session_id: session.session_id, status: "completed", message: `Question deleted. No more questions remaining for '${session.display_name}'.` };
        }
        ADD_CONTENT_QUESTION_CACHE[session_state.session_id] = next;
        session.current_question_index = 0;
        session.mark_irrelevant = undefined;
        session.answer = undefined;
        ADD_CONTENT_SESSIONS[session_state.session_id] = session;
        return { session_id: session.session_id, status: AddContentSteps.DELETE_QUESTION, deleted: true, progress: `Question 1 of ${next.length} (new batch)`, category: next[0].category, message: `Question deleted. New questions generated. Present the next question by calling this tool again with step as '${AddContentSteps.GET_QUESTION}'.` };
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
        const exec_id = globalState.executive_name!;
        const next = await this.openaiHelper.generateAndStoreBatch({ supabaseAdapter: this.adapter, helper: this.helper, exec_id, domain_slug: session.domain_slug!, display_name: session.display_name! });
        if (!next || next.length === 0) {
          delete ADD_CONTENT_SESSIONS[session_state.session_id];
          delete ADD_CONTENT_QUESTION_CACHE[session_state.session_id];
          return { session_id: session.session_id, status: "completed", message: `No more questions remaining for '${session.display_name}'. Skipped questions will still be available next session.` };
        }
        ADD_CONTENT_QUESTION_CACHE[session_state.session_id] = next;
        session.current_question_index = 0;
        session.skip_question = undefined;
        session.answer = undefined;
        ADD_CONTENT_SESSIONS[session_state.session_id] = session;
        return { session_id: session.session_id, status: AddContentSteps.SKIP_QUESTION, skipped: true, progress: `Question 1 of ${next.length} (new batch)`, category: next[0].category, message: `Question skipped. New questions generated. Present the next question by calling this tool again with step as '${AddContentSteps.GET_QUESTION}'.` };
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

  // Finite State Machine orchestration for reading domain and answering user questions about the domain
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
      if (s.response) return ReadDomainSteps.LOG_QUERY;
      if (!s.fetched_chunks) return ReadDomainSteps.FETCH;
      return ReadDomainSteps.GENERATE;
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

      let chunks: Record<string, any>[] = [];
      let chunkError: string | undefined;
      const domainContext = await this.helper.read_domain(this.adapter, exec_id, domain_slug);
      try {
        chunks = await this.helper.search_domain_chunks(this.adapter, exec_id, domain_slug, session.query!);
      } catch (e: any) {
        chunkError = e?.message ?? String(e);
      }

      // Synthetic chunks from domain description — always available, answer scope/coverage questions
      const descChunks: Record<string, any>[] = [];
      const desc = domainContext?.description;
      if (desc?.covers?.length)
        descChunks.push({ id: "desc_covers", question: "What does this domain cover?", content: `This domain covers: ${(desc.covers as string[]).join(", ")}.` });
      if (desc?.not_covers?.length)
        descChunks.push({ id: "desc_not_covers", question: "What is out of scope for this domain?", content: `This domain does NOT cover: ${(desc.not_covers as string[]).join(", ")}.` });
      if (domainContext?.extra_details)
        descChunks.push({ id: "desc_extra", question: "Additional context about this domain", content: domainContext.extra_details });

      const answeredChunks = [...descChunks, ...chunks.filter((c: any) => c.content?.trim())];
      session.fetched_chunks = answeredChunks;
      session.fetched_domain_context = domainContext;
      session.domain_slug = domain_slug;
      READ_DOMAIN_SESSIONS[session_state.session_id] = session;

      return {
        session_id: session.session_id,
        status: ReadDomainSteps.FETCH,
        chunks_found: answeredChunks.length,
        ...(chunkError && { chunk_search_error: chunkError }),
        message: chunkError
          ? `Chunk search failed: ${chunkError}. Call this tool again to proceed with domain context only.`
          : "Data fetched. Call this tool again immediately to proceed to generate_answer",
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
          session.domain_slug!,
          []
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
        retrieved_chunks: (session.fetched_chunks ?? []).map((c: any, i: number) => ({ index: i + 1, question: c.question, content: c.content })),
        instruction: "Generate a comprehensive answer to the query using domain_context and retrieved_chunks. Answer in the executive's voice — confident, first-person, direct. Ground every claim in the retrieved knowledge. If the retrieved knowledge does not contain enough to answer, say so clearly. After presenting the answer, call this tool again with your response text.",
      };
    }

    if (session.step === ReadDomainSteps.LOG_QUERY) {
      delete READ_DOMAIN_SESSIONS[session_state.session_id];
      if (!session.logged_without_chunks) {
        const domain_slug = session.domain_slug ?? await this.helper.get_domain_slug_by_display_name(this.adapter, globalState.executive_name!, session.display_name!);
        await this.helper.log_query(
          this.adapter,
          globalState.executive_name!,
          session.query!,
          session.response!,
          domain_slug!,
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

  // Finite and Self-looped State Machine orchestration for creating a new domain with user inputs and generated suggestions
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

  // Finite and Self-looped State Machine orchestration for capturing the EOS hierarchy from user inputs and LLM-generated suggestions, with ability to restart or correct at any step without losing progress
  async capture_eos_hierarchy(session_state: CaptureEosHierarchySessionState): Promise<Record<string, any>> {
    const sid = session_state?.session_id;
    if (!sid) {
      return { status: "error", message: "Missing session_id in session_state." };
    }

    const exec_id = globalState.executive_name!;

    if (!CAPTURE_EOS_SERVER_STATE[sid]) {
      const complete = await this.helper.eos_hierarchy_complete(this.adapter, exec_id);
      if (complete) {
        return { status: "already_exists", message: "A complete EOS hierarchy already exists for this executive. All levels (10-year, 3-year, 1-year, quarterly rocks, values) are already stored." };
      }
      CAPTURE_EOS_SERVER_STATE[sid] = {};
    }

    const server = CAPTURE_EOS_SERVER_STATE[sid];

    // User rejected the summary — wipe server state and restart
    if (session_state.user_confirmation === false) {
      delete CAPTURE_EOS_SERVER_STATE[sid];
      delete CAPTURE_EOS_HIERARCHY_SESSIONS[sid];
      return {
        session_id: sid,
        status: "restarted",
        message: "EOS capture restarted. Call this tool again to begin from the 10-year target.",
      };
    }

    // Absorb incoming data into server state; never carry it back in the response
    if (session_state.ten_year_target && !server.captured_ten_year)
      server.captured_ten_year = session_state.ten_year_target;
    if (session_state.three_year_picture && !server.captured_three_year)
      server.captured_three_year = session_state.three_year_picture;
    if (session_state.one_year_plans?.length && !server.captured_one_year?.length)
      server.captured_one_year = session_state.one_year_plans;
    if (session_state.quarterly_rocks?.length)
      server.captured_quarterly_rocks = [...(server.captured_quarterly_rocks ?? []), ...session_state.quarterly_rocks];
    if (session_state.values?.length)
      server.captured_values = [...(server.captured_values ?? []), ...session_state.values];
    if (session_state.functional_domains?.length && !server.captured_functional_domains?.length)
      server.captured_functional_domains = session_state.functional_domains;

    // Determine next step from server state only
    if (!server.captured_ten_year) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_TEN_YEAR_TARGET,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields and single_select (high | medium | low) for confidence field in the inline-chat response, decompose into multiple turns if separate blocks exceed 3",
        generation: GenerationPrompts.generate_ten_year_target_draft(exec_id),
        message: "Only after completing the generation, ask the user to define their 10 year North Star target — 4 separate input blocks: goal, key metrics related to the goal, the 'why' factor of the goal, and confidence level. Once the user responds, call this tool again with ONLY session_id and ten_year_target — do not include any other fields.",
      };
    }

    if (!server.captured_three_year) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_THREE_YEAR_PICTURE,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into multiple turns if separate blocks exceed 3",
        generation: GenerationPrompts.generate_three_year_picture_draft(),
        message: "10-year target saved. Only after completing the generation, ask the user to describe their 3-year picture — 5 separate input blocks: revenue, product, team, market position, and key capabilities. Once the user responds, call this tool again with ONLY session_id and three_year_picture — do not include any other fields.",
      };
    }

    if (!server.captured_one_year?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_ONE_YEAR_PLAN,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response, decompose into multiple turns if separate blocks exceed 3",
        generation: GenerationPrompts.generate_one_year_plan_draft(),
        message: "3-year picture saved. Only after completing the generation, ask the user to define their 1-year execution plan — 4 separate input blocks: goals, key metrics, priorities, and constraints. Multiple plans are allowed. Once the user responds, call this tool again with ONLY session_id and one_year_plans — do not include any other fields.",
      };
    }

    if (!server.captured_quarterly_rocks?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_QUARTERLY_ROCKS,
        widget: "use your ask_user_input_v0 widget for ALL fields — never ask for any field through plain text. Collect all 5 fields for ONE rock only (title, owner, success metric, deadline, status) inside the widget",
        generation: GenerationPrompts.generate_quarterly_rocks_draft(),
        message: "1-year plan saved. Only after completing the generation, ask the user to add ONE quarterly rock — collect all 5 fields (title, owner, success metric, deadline, status) through the widget only. Once the user responds, call this tool again with ONLY session_id and quarterly_rocks (array with ONE item) — do not include any other fields.",
      };
    }

    // If a rock was just added, ask whether to add another
    if (session_state.add_more_rocks === undefined && session_state.quarterly_rocks?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_MORE_ROCKS,
        rocks_so_far: server.captured_quarterly_rocks?.length,
        widget: "use your ask_user_input_v0 widget with single_select options: Add another rock / No, move on",
        message: `Rock saved (${server.captured_quarterly_rocks?.length} total). Does the executive want to add another quarterly rock? Once they respond, call this tool again with ONLY session_id and add_more_rocks (true or false) — do not include any other fields.`,
      };
    }

    // User wants to add another rock
    if (session_state.add_more_rocks === true) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_QUARTERLY_ROCKS,
        widget: "use your ask_user_input_v0 widget for ALL fields — never ask for any field through plain text. Collect all 5 fields for ONE rock only (title, owner, success metric, deadline, status) inside the widget",
        message: `Adding rock #${(server.captured_quarterly_rocks?.length ?? 0) + 1}. Collect all 5 fields (title, owner, success metric, deadline, status) through the widget only. Once the user responds, call this tool again with ONLY session_id and quarterly_rocks (array with ONE item) — do not include any other fields.`,
      };
    }

    if (!server.captured_values?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_VALUES,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response",
        generation: GenerationPrompts.generate_values_draft(exec_id),
        message: "Quarterly rocks saved. Only after completing the generation, ask the user to define ONE core value — 3 input blocks: name, description, and real behavioral examples. Once the user responds, call this tool again with ONLY session_id and values (array with ONE item) — do not include any other fields.",
      };
    }

    // If a value was just added, ask whether to add another
    if (session_state.add_more_values === undefined && session_state.values?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_MORE_VALUES,
        values_so_far: server.captured_values?.length,
        widget: "use your ask_user_input_v0 widget with single_select options: Add another value / No, move on",
        message: `Value saved (${server.captured_values?.length} total). Does the executive want to add another core value? Once they respond, call this tool again with ONLY session_id and add_more_values (true or false) — do not include any other fields.`,
      };
    }

    // User wants to add another value
    if (session_state.add_more_values === true) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_VALUES,
        widget: "use your ask_user_input_v0 widget with multi_select for required fields in the inline-chat response",
        message: `Adding value #${(server.captured_values?.length ?? 0) + 1}. Collect all 3 fields (name, description, behavioral examples) through the widget only. Once the user responds, call this tool again with ONLY session_id and values (array with ONE item) — do not include any other fields.`,
      };
    }

    if (!server.captured_functional_domains?.length) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.ASK_FUNCTIONAL_DOMAINS,
        widget: "use your ask_user_input_v0 widget with multi_select for domain names; allow the user to add custom names",
        generation: GenerationPrompts.generate_functional_domains_draft(exec_id),
        message: "Values saved. Only after completing the generation, ask the user which functional domains exist in their business. Once the user responds, call this tool again with ONLY session_id and functional_domains — do not include any other fields.",
      };
    }

    // All levels captured — show summary for confirmation
    if (session_state.user_confirmation === undefined) {
      return {
        session_id: sid,
        status: CaptureEosHierarchySteps.USER_CONFIRMATION,
        widget: "use your ask_user_input_v0 widget for single_select with options: Yes (Store) and No (Restart)",
        summary: {
          ten_year_target: server.captured_ten_year,
          three_year_picture: server.captured_three_year,
          one_year_plans: server.captured_one_year,
          quarterly_rocks: server.captured_quarterly_rocks,
          values: server.captured_values,
          functional_domains: server.captured_functional_domains,
        },
        message: "All levels captured. Review the full EOS hierarchy above and confirm to store, or say 'no' to restart.",
      };
    }

    // user_confirmation === true — insert all into eos_items
    const alreadyComplete = await this.helper.eos_hierarchy_complete(this.adapter, exec_id);
    if (alreadyComplete) {
      delete CAPTURE_EOS_SERVER_STATE[sid];
      delete CAPTURE_EOS_HIERARCHY_SESSIONS[sid];
      return { session_id: sid, status: "already_exists", message: "A complete EOS hierarchy already exists for this executive. All levels are already stored." };
    }
    try {
      await this.helper.insert_eos_items(this.adapter, exec_id, server);
    } catch (e: any) {
      delete CAPTURE_EOS_SERVER_STATE[sid];
      delete CAPTURE_EOS_HIERARCHY_SESSIONS[sid];
      return { session_id: sid, status: "error", message: `Failed to store EOS hierarchy: ${e.message}` };
    }
    delete CAPTURE_EOS_SERVER_STATE[sid];
    delete CAPTURE_EOS_HIERARCHY_SESSIONS[sid];
    return {
      session_id: sid,
      status: "completed",
      message: "EOS Knowledge Hierarchy successfully stored.",
    };
  }

  // Finite State Machine orchestration for updating answers to existing questions across any domain, with automatic search and match, and ability to restart or correct at any step without losing progress
  async update_domain_answers(session_state: UpdateDomainAnswersSessionState): Promise<Record<string, any>> {
    if (!session_state?.session_id) {
      return { status: "error", message: "Missing session_id in session_state." };
    }
    const sid = session_state.session_id;
    const exec_id = globalState.executive_name!;

    const existing = UPDATE_DOMAIN_ANSWERS_SESSIONS[sid] ?? { session_id: sid };
    const session: UpdateDomainAnswersSessionState = { ...existing, ...session_state };
    UPDATE_DOMAIN_ANSWERS_SESSIONS[sid] = session;

    // Step 1 — ask for the question/topic
    if (!session.query) {
      return {
        session_id: sid,
        status: UpdateDomainAnswersSteps.ASK_QUESTION,
        widget: "use your ask_user_input_v0 widget with a text input field asking: Which question or topic would you like to update the answer for?",
        message: "What question or topic would you like to update the answer for?",
      };
    }

    // Step 2 — search automatically
    if (!session.matched_id) {
      let results: { id: string; question: string; content: string; domain: string; similarity: number }[];
      try {
        results = await this.helper.search_question_across_domains(this.adapter, exec_id, session.query);
      } catch (e: any) {
        return { session_id: sid, status: "error", message: `Search failed: ${e.message}` };
      }
      if (results.length === 0) {
        delete UPDATE_DOMAIN_ANSWERS_SESSIONS[sid];
        return {
          session_id: sid,
          status: "not_found",
          message: `No matching questions found across any domain for: "${session.query}". Try rephrasing.`,
        };
      }
      const top = results[0];
      session.matched_id = top.id;
      session.matched_question = top.question;
      session.matched_domain = top.domain;
      session.current_answer = top.content;
      UPDATE_DOMAIN_ANSWERS_SESSIONS[sid] = session;

      return {
        session_id: sid,
        status: UpdateDomainAnswersSteps.CONFIRM_MATCH,
        matched_question: top.question,
        matched_domain: top.domain,
        current_answer: top.content || "(no answer yet)",
        widget: "use your ask_user_input_v0 widget with single_select options: Yes, update this / No, try again",
        message: `Found this question in domain "${top.domain}":\n"${top.question}"\n\nCurrent answer: ${top.content || "(no answer yet)"}\n\nIs this the question you wanted to update?`,
      };
    }

    // Step 3 — user said No → restart
    if (session_state.query && session_state.query !== existing.query) {
      // query changed, restart search
      session.matched_id = undefined;
      session.matched_question = undefined;
      session.matched_domain = undefined;
      session.current_answer = undefined;
      UPDATE_DOMAIN_ANSWERS_SESSIONS[sid] = session;
      return this.update_domain_answers(session);
    }

    // Step 4 — save new answer
    if (!session.new_answer) {
      return {
        session_id: sid,
        status: UpdateDomainAnswersSteps.UPDATE_ANSWER,
        matched_question: session.matched_question,
        current_answer: session.current_answer || "(no answer yet)",
        widget: "use your ask_user_input_v0 widget with a text input asking the user to provide the updated answer",
        message: `Please provide the updated answer for:\n"${session.matched_question}"`,
      };
    }

    // Persist
    try {
      await this.helper.save_question_answer(this.adapter, new EmbeddingAdapter(), session.matched_id!, session.new_answer);
    } catch (e: any) {
      return { session_id: sid, status: "error", message: `Failed to save answer: ${e.message}` };
    }
    delete UPDATE_DOMAIN_ANSWERS_SESSIONS[sid];
    return {
      session_id: sid,
      status: "completed",
      message: `Answer updated for question: "${session.matched_question}"`,
    };
  }

}  