import { globalState } from "../../index.ts";

export class ToolPrompts {
    // - If you see multiple select options in any step of workflow, use your ask_user_input_v0 widget to ask user to select one or multiple options depending on the context.
    // - If their are more than 3 options are available which are short in text (max 20 characters) for the human-in-the-loop process, select any 3 options to present to the user in ask_user_input_v0 widget.
    static RULES = `
    - While Orchestrating you can skip a single or multiple steps if you already have the required information. For example, if you already know the area_of_business for a domain, you can skip the step of asking for area_of_business and move on to the next step of asking for questions_with_this_domain.
    - Respond ONLY with a tool call.
    - Do NOT include any natural-language explanation or ask user anything before the tool call.
    - After the tool returns, if the message says to present it to the user, you MUST present it before making the next tool call. Only call the next tool after the user has seen the presented message.
    - Do NOT call the final tool unless you have all the required information and user_confirmation=true, whenever required.`;

    static clear_session = `Call this tool whenever the user switches between workflows, pauses a multi-step tool, or explicitly wants to abandon the current session. Pass the session_id to clear a specific session, or omit it to clear all active sessions. This must be called before starting a new unrelated tool flow to avoid stale session state. \n${ToolPrompts.RULES}`;

    static get list_domains() { return `Fetch the list of domains for executive: '${globalState.executive_name}' \n${ToolPrompts.RULES}`; }
    static check_supabase_connection = `Check the connection to the Supabase database by running a test query. \n${ToolPrompts.RULES}`;
    static get_domain_health = `Fetch a health report for all domains — how many questions are answered vs unanswered per domain, which domains are thin (fewer than 5 active entries), and the bottom 5 domains ranked by most unanswered questions. Returns a stacked bar chart (green = answered, red = unanswered, red label = thin domain) and a JSON summary. Render the SVG as an artifact. Then surface each thin_alert message verbatim to the executive. Finally recommend adding content to the domains with the most unanswered questions. \n${ToolPrompts.RULES}`;
    static get_domain_analytics = `Fetch a visual breakdown of query activity across all domains — how many queries hit each domain, which domain was asked most, and which domain had the weakest knowledge coverage (fewest KB chunks retrieved on average). Returns a raw SVG string and a JSON summary. Render the SVG as an artifact so the user sees the bar chart, then call out the most_asked and weakest domains explicitly from the JSON. \n${ToolPrompts.RULES}`;

    static read_domain_workflow = `
    WORKFLOW: read_domain (state machine)
    Steps: ask_display_name → ask_query → fetch_domain → generate_answer → log_query
    ${ToolPrompts.RULES}
    1) If display_name is not provided, use ask_display_name step — show available domains in options and let the user pick one. Show the display_name options anyways even if there is only one.
    2) Even if display_name is guessed, confirm it with the user by using the list_domains tool (domains column exists as a safe URL for the display name), then use ask_query step if query is not provided — ask the user what they want to know.
    3) Once both display_name and query are known, call fetch_domain — tool fetches chunks and domain context server-side and returns immediately.
    4) fetch_domain returns right away — call this tool again immediately (no user interaction) to proceed to generate_answer.
    5) generate_answer returns: retrieved_chunks (top semantically similar knowledge entries) + domain_context (description, example_questions, extra_details). Use ALL of these together to generate a comprehensive answer in the executive's voice.
    6) After presenting the answer to the user, call this tool again with ONLY session_id and response (your presented answer text) to log the interaction. Do NOT include any other fields — the server routes to log_query based on response being present.`;

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
    Steps in order: ask_display_name → fetch_questions → [get_question ↔ (answer_question | delete_question | skip_question | end_session)] × batches of 3 questions, up to 15 total (Question Game loop: GET → SAVE → ASK → SAVE ...)
    ${ToolPrompts.RULES}
    1) Guess the display_name from the user input if possible, then call ask_display_name to confirm. Let the user pick from available domains.
    2) Once display_name is known or provided by the user, call fetch_questions — this runs automatically (no user interaction). If status="domain_not_found", exit and call create_domain immediately.
    3) fetch_questions returns the first unanswered question. Present it to the executive with 3 options: answer it, mark it as irrelevant/not needed, skip it to answer later or end this session and answer later in ask_user_input_v0 widget.
    4) If the executive answers, call this tool with answer= to persist — no confirmation step.
    5) If the executive says the question is not relevant or not needed, call this tool with mark_irrelevant=true to permanently delete it from the database.
    6) If the executive wants to skip and answer later, call this tool with skip_question=true — the question stays in the database and will appear again next session.
    7) If the executive wants to end the session and answer later, call the clear_session tool with end_session=true — this ends the workflow for now.
    8) When the current batch of questions is exhausted, the tool automatically generates the next batch of 3 questions based on what was answered so far — do NOT treat this as session end. Call this tool again immediately to present the first question of the new batch.
    9) When status="completed", all batches are done (up to 15 questions total). The session is over — inform the executive.`;

    static answer_domain_questions = `Orchestrate the Q&A game of answering unanswered questions for an existing domain. \n${ToolPrompts.answer_domain_questions_workflow}`;

    static capture_eos_hierarchy_workflow = `
    Act as an EOS facilitator for this tool.
    WORKFLOW: capture_eos_hierarchy (state machine — server-driven, one level at a time)
    Steps in order: ask_ten_year_target → ask_three_year_picture → ask_one_year_plan → ask_quarterly_rocks → ask_values → ask_functional_domains → user_confirmation → insert
    ${ToolPrompts.RULES}
    CRITICAL RULES FOR THIS TOOL:
    - Each captured level is stored SERVER-SIDE immediately. Never re-send a level that has already been submitted.
    - When calling this tool after collecting user input, pass ONLY session_id and the field for the CURRENT level. Do NOT include any previously submitted fields — they are already persisted on the server.
    - The tool tells you exactly which field to send next in its response message. Follow it precisely.
    - If the user speaks out or types additional items alongside their widget selections, MERGE the spoken items with the selected options into the final answer. Do NOT regenerate the widget — treat the combined result as the confirmed input and call this tool immediately.
    1) ask_ten_year_target — Ask for the North Star: 4 inputs: the big goal, key metrics, the 'why', and confidence level. After user responds, call this tool with ONLY session_id + ten_year_target.
    2) ask_three_year_picture — Ask what reality looks like if the company is on track: 5 inputs: revenue, product state, team, market position, key capabilities. After user responds, call this tool with ONLY session_id + three_year_picture.
    3) ask_one_year_plan — Ask for this year's execution layer: 4 inputs: goals, metrics, priorities, constraints. Multiple 1-year plans are allowed. After user responds, call this tool with ONLY session_id + one_year_plans.
    4) ask_quarterly_rocks — Ask for this quarter's atomic priorities ONE rock at a time: 5 inputs per rock: title, owner, success metric, deadline, and current status. After user provides one rock, call this tool with ONLY session_id + quarterly_rocks (array with ONE item). The tool will then ask if the user wants to add another rock — call again with ONLY session_id + add_more_rocks (true or false).
    5) ask_values — Ask for core values ONE at a time: 3 inputs per value: name, description, and real behavioral examples. After user provides one value, call this tool with ONLY session_id + values (array with ONE item). The tool will then ask if the user wants to add another value — call again with ONLY session_id + add_more_values (true or false).
    6) ask_functional_domains — Ask which functional areas exist in the business (e.g. Sales, Marketing, Finance). Collect as a list of names only. After user responds, call this tool with ONLY session_id + functional_domains.
    7) user_confirmation — The tool returns a full summary built from server state. Present it to the CEO and ask for confirmation. Call this tool with ONLY session_id + user_confirmation (true or false).
    8) insert — Triggered automatically when user_confirmation=true. Do not add any other fields. `;

    static get_frequently_asked_questions_workflow = `
    WORKFLOW: get_frequently_asked_questions (state machine)
    Steps in order: ask_type_of_questions_needed → fetch_questions → summarize_questions_with_answers → display_top_3_questions_with_frequency
    ${ToolPrompts.RULES}
    1) ask_type_of_questions_needed — Ask the user which type of frequently asked questions they want to see. Use a single-select widget with options: most_frequent_by_domain, most_frequent_by_time, most_frequent_overall. Once selected, call this tool again with ONLY session_id and type_of_questions_needed set to the chosen value. If most_frequent_by_domain is selected, also pass domain_slug.
    2) fetch_questions — Runs automatically after type_of_questions_needed is set. Call this tool immediately — no user interaction.
    3) summarize_questions_with_answers — Present the summary to the user using the returned message (per RULES, present before calling again). Then call this tool again to proceed to display_top_3_questions_with_frequency.
    4) display_top_3_questions_with_frequency — Display the top 3 most frequently asked questions in a table widget as per the returned widget and message from the tool.`;

    static get_frequently_asked_questions = `Orchestrate the process of fetching and summarizing the frequently asked questions based on user input. \n${ToolPrompts.get_frequently_asked_questions_workflow}`;

    static read_eos_hierarchy_workflow = `
    WORKFLOW: read_eos_hierarchy (state machine)
    Steps in order: ask_level → ask_focus → fetch → log_query
    ${ToolPrompts.RULES}
    1) ask_level — Ask the user which EOS level they want to see. Use a single-select widget with options: 10-Year Target, 3-Year Picture, 1-Year Plan, Quarterly Rocks, Values, Functional Domains, Everything. Call this tool with eos_level set to the matching key once selected.
    2) ask_focus — Ask what specifically they want to see within that level (e.g. for 10-year: goal / metrics / why / full picture; for quarterly rocks: a specific rock by name or all; for values: a specific value or all). Call this tool with focus set to their answer. Skip this step and go straight to fetch if the user selected Everything.
    3) fetch — Runs automatically. Call this tool immediately after ask_focus. Present the returned items clearly to the user — use a structured format matching the EOS level.
    4) log_query — After presenting the answer to the user, call this tool again with ONLY session_id and response (your presented text) to log the interaction.`;

    static read_eos_hierarchy = `Read and display the stored EOS hierarchy for the executive.\n${ToolPrompts.read_eos_hierarchy_workflow}`;

    static update_eos_hierarchy_workflow = `
    WORKFLOW: update_eos_hierarchy (state machine)
    Steps in order: ask_level → fetch_current (auto) → ask_update → update
    ${ToolPrompts.RULES}
    1) ask_level — Ask which EOS level to update. Single-select widget: 10-Year Target, 3-Year Picture, 1-Year Plan, Quarterly Rocks, Values, Functional Domains. Call this tool with eos_level set to the chosen key.
    2) fetch_current — Runs automatically. Call this tool immediately after ask_level (no user interaction). It returns the current stored content so the user can see what already exists before editing.
    3) ask_update — Present the current content to the user in the widget with fields pre-filled. Let them modify only the fields they want to change. If there are multiple items (e.g. several rocks or values), ask which one to update first using item_id. Call this tool with updated_content containing the full updated object.
    4) update — Runs automatically after updated_content is received. Call this tool immediately — it persists the change and regenerates the embedding.`;

    static update_eos_hierarchy = `Update a specific level of the stored EOS hierarchy.\n${ToolPrompts.update_eos_hierarchy_workflow}`;

    static capture_eos_hierarchy = `Orchestrate the process of capturing the EOS Knowledge Hierarchy based on user input.\n${ToolPrompts.capture_eos_hierarchy_workflow}`;

    static update_domain_answers_workflow = `
    WORKFLOW: update_domain_answers (state machine)
    Steps in order: ask_question → search (auto) → confirm_match → update_answer
    ${ToolPrompts.RULES}
    1) ask_question — Ask the user: "Which question or topic would you like to update the answer for?" Use a plain text input in the widget. Once the user types their query, call this tool with query set to their input.
    2) search — Runs automatically after query is set (no user interaction). Call this tool immediately — it searches across all domains to find the best matching question. Returns the top match with the current answer.
    3) confirm_match — Present the matched question, the domain it belongs to, and the current answer. Ask the user: "Is this the question you wanted to update?" with Yes / No options in the widget. If No, go back to ask_question. If Yes, show the current answer and ask the user to provide the updated answer.
    4) update_answer — Once the user provides the new answer, call this tool with new_answer set. It persists the change and the workflow ends.`;

    static update_domain_answers = `Orchestrate the process of finding and updating an answer for a domain question.\n${ToolPrompts.update_domain_answers_workflow}`;
}

// You are an EOS(Entrepreneurial Operating System) facilitator now and not an executive brain for this tool calling.
// Your job is to ask the CEO a series of questions to help pull out all of the context he has on the future trajectory of the business.
// Keep asking some 2 to 3 follow-up questions (stay in extra_details step) until you have the full 10-year, 3-year, and 1-year quarterly goals mapped out for the company.',