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

    static get list_domains() { return `Fetch the list of domains for executive: '${globalState.executive_name}' \n${ToolPrompts.RULES}`; }
    static check_supabase_connection = `Check the connection to the Supabase database by running a test query. \n${ToolPrompts.RULES}`;

    static read_domain_workflow = `
    WORKFLOW: read_domain (state machine)
    Steps: ask_display_name → ask_query → fetch_domain → generate_answer → log_query
    ${ToolPrompts.RULES}
    1) If display_name is not provided, use ask_display_name step — show available domains and let the user pick one.
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
    1) Guess the area_of_business from the user input if you think it is not provided and call ask_area_of_domain step with that guess to confirm with the user. Some examples of area_of_business are: "Sales", "Marketing", "Customer Support".
    2) Ask for user confirmation before proceeding to create_domain.
    3) generate_entries runs automatically after confirmation — do NOT show it to the user, immediately call this tool again with the generated knowledge_entries.
    4) If user_confirmation is false, go back to the appropriate step based on which information is missing.`;

    static create_domain = `Orchestrate the process of creating a domain based upon on user input \n${ToolPrompts.create_domain_workflow}`;

    static add_content_to_domain_workflow = `
    WORKFLOW: add_content_to_domain (state machine)
    Steps in order: ask_domain → ask_content → ask_category → insert
    ${ToolPrompts.RULES}
    1) Guess the display_name from the user input for the domain() if you think it is not provided, call ask_domain step with display_name to show available domains and let the user pick one.
    2) Once display_name is known, call this tool to proceed. If the tool returns status="domain_not_found" and action="call_create_domain", immediately exit this orchestration and call the create_domain tool using the area_of_business provided in the message.
    3) Ask the user what content or insight they want to add to that domain.
    4) Ask the user what category this content belongs to (single_select from the returned categories list).
    5) Call this tool with all collected fields to insert the entry into exec_knowledge. Do NOT show the insert step to the user — immediately proceed and confirm success.`;

    static add_content_to_domain = `Orchestrate the process of adding content to a domain based upon user input \n${ToolPrompts.add_content_to_domain_workflow}`;
}

// You are an EOS(Entrepreneurial Operating System) facilitator now and not an executive brain for this tool calling.
// Your job is to ask the CEO a series of questions to help pull out all of the context he has on the future trajectory of the business.
// Keep asking some 2 to 3 follow-up questions (stay in extra_details step) until you have the full 10-year, 3-year, and 1-year quarterly goals mapped out for the company.',