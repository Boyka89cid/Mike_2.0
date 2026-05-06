import { globalState } from "../../index.ts";

export class ToolPrompts {
    // - If you see multiple select options in any step of workflow, use your ask_user_input_v0 widget to ask user to select one or multiple options depending on the context.
    // - If their are more than 3 options are available which are short in text (max 20 characters) for the human-in-the-loop process, select any 3 options to present to the user in ask_user_input_v0 widget.
    static RULES = `
    - While Orchestrating you can skip a single or multiple steps if you already have the required information. For example, if you already know the area_of_business for a domain, you can skip the step of asking for area_of_business and move on to the next step of asking for questions_with_this_domain.
    - Respond ONLY with a tool call.
    - Do NOT include any natural-language explanation or ask user anything before the tool call.
    - After the tool returns, you may present exactly the tool's message verbatim.
    - Do NOT call the final tool unless you have all the required information and user_confirmation=true, whenever required.`;

    static clear_session = `Call this tool whenever the user switches between workflows, pauses a multi-step tool, or explicitly wants to abandon the current session. Pass the session_id to clear a specific session, or omit it to clear all active sessions. This must be called before starting a new unrelated tool flow to avoid stale session state. \n${ToolPrompts.RULES}`;

    static get list_domains() { return `Fetch the list of domains for executive: '${globalState.executive_name}' \n${ToolPrompts.RULES}`; }
    static check_supabase_connection = `Check the connection to the Supabase database by running a test query. \n${ToolPrompts.RULES}`;

    static read_domain_workflow = `
    WORKFLOW: read_domain (state machine)
    Steps: ask_display_name → ask_query → fetch_domain → generate_answer → log_query
    ${ToolPrompts.RULES}
    1) If display_name is not provided, use ask_di  splay_name step — show available domains in options and let the user pick one, if their is just one or two options available. Show the display_name options anyways
    2) Even if display_name is guessed, confirm it with the user by using the list_domains tool (domains column exists as a safe URL for the display name), then use ask_query step if query is not provided — ask the user what they want to know.
    3) Once both display_name and query are known, call fetch_domain — tool fetches chunks and domain context server-side and returns immediately.
    4) fetch_domain returns right away — call this tool again immediately (no user interaction) to proceed to generate_answer.
    5) generate_answer returns: retrieved_chunks (top semantically similar knowledge entries) + domain_context (description, example_questions, extra_details). Use ALL of these together to generate a comprehensive answer in the executive's voice.
    6) After presenting the answer to the user, call this tool again with response and chunks_used to log the interaction.`;

    static read_domain = `Orchestrate the process of reading a domain's context based upon user input.\n${ToolPrompts.read_domain_workflow}`;

    static create_domain_workflow = `
    WORKFLOW: create_domain (state machine)
    Steps in order: ask_area_of_domain → ask_questions_with_this_domain → ask_scope_of_domain → extra_details → user_confirmation → generate_entries → create_domain
    ${ToolPrompts.RULES}
    1) Guess the area_of_business from the user input if you think it is not provided and call ask_area_of_domain step with that guess to confirm with the user. Some examples of area_of_business are: 'Sales', 'Marketing', 'Customer Support'.
    2) Ask for user confirmation before proceeding to create_domain.
    3) generate_entries should run automatically after confirmation — do NOT show it to the user, immediately call this tool again with the generated knowledge_entries.
    4) If user_confirmation is false, go back to the appropriate step based on which information is missing.`;

    static create_domain = `Orchestrate the process of creating a domain based upon on user input \n${ToolPrompts.create_domain_workflow}`;

    static answer_domain_questions_workflow = `
    WORKFLOW: answer_domain_questions (state machine)
    Steps in order: ask_display_name → fetch_questions → [get_question ↔ (answer_question | delete_question | skip_question | end_session)] × Number of questions (Question Game loop: GET → SAVE → ASK → SAVE ...)
    ${ToolPrompts.RULES}
    1) Guess the display_name from the user input if possible, then call ask_display_name to confirm. Let the user pick from available domains.
    2) Once display_name is known or provided by the user, call fetch_questions — this runs automatically (no user interaction). If status="domain_not_found", exit and call create_domain immediately.
    3) fetch_questions returns the first unanswered question. Present it to the executive with 3 options: answer it, mark it as irrelevant/not needed, skip it to answer later or end this session and answer later in ask_user_input_v0 widget.
    4) If the executive answers, call this tool with answer= to persist — no confirmation step.
    5) If the executive says the question is not relevant or not needed, call this tool with mark_irrelevant=true to permanently delete it from the database.
    6) If the executive wants to skip and answer later, call this tool with skip_question=true — the question stays in the database and will appear again next session.
    7) If the executive wants to end the session and answer later, call the clear_session tool with end_session=true — this ends the workflow for now.
    8) If more questions remain, the tool returns the next question — call this tool again immediately to present it.`;

    static answer_domain_questions = `Orchestrate the Q&A game of answering unanswered questions for an existing domain. \n${ToolPrompts.answer_domain_questions_workflow}`;

    static capture_eos_hierarchy_workflow = `
    Act as an EOS facilitator for this tool.
    WORKFLOW: capture_eos_hierarchy (state machine)
    Steps in order: ask_ten_year_target → ask_three_year_picture → ask_one_year_plan → ask_quarterly_rocks → ask_values → ask_functional_domains → user_confirmation → insert
    ${ToolPrompts.RULES}
    1) ask_ten_year_target — Ask for the North Star: 4 inputs: the big goal, key metrics, the 'why', and confidence level.
    2) ask_three_year_picture — Ask what reality looks like if the company is on track: 5 inputs: revenue, product state, team, market position, key capabilities.
    3) ask_one_year_plan — Ask for this year's execution layer: 4 inputs: goals, metrics, priorities, constraints. Multiple 1-year plans are allowed.
    4) ask_quarterly_rocks — Ask for this quarter's atomic priorities: 5 inputs: title, owner, success metric, deadline, and current status for each rock.
    5) ask_values — Ask for core values: 3 inputs: name, description, and real behavioral examples for each.
    6) ask_functional_domains — Ask which functional areas exist in the business (e.g. Sales, Marketing, Finance). Collect as a list of names only.
    7) user_confirmation — Show a full summary of all captured levels and ask the CEO to confirm before storing.
    8) insert — Call this step once user_confirmation=true. `;

    static get_frequently_asked_questions = `Fetch the most frequently asked questions for the executive from the query log, ranked by how often each question has been asked. Optionally filter by area of business. Present results as a ranked list showing question and frequency count. \n${ToolPrompts.RULES}`;

    static capture_eos_hierarchy = `Orchestrate the process of capturing the EOS Knowledge Hierarchy based on user input.\n${ToolPrompts.capture_eos_hierarchy_workflow}`;
}

// You are an EOS(Entrepreneurial Operating System) facilitator now and not an executive brain for this tool calling.
// Your job is to ask the CEO a series of questions to help pull out all of the context he has on the future trajectory of the business.
// Keep asking some 2 to 3 follow-up questions (stay in extra_details step) until you have the full 10-year, 3-year, and 1-year quarterly goals mapped out for the company.',