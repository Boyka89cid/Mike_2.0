export class GenerationPrompts {

    static generate_example_questions(area_of_business: string): string {
        return `Generate 3 to 5 example questions that someone can ask about ${area_of_business}.`;
    }

    static generate_scope_of_domain(area_of_business: string, questions_with_this_domain: string[]): string {
        return `Based on the ${area_of_business} and the example questions ${questions_with_this_domain.join(", ")}, generate a clear scope of the domain in a concise manner for ${area_of_business}.`;
    }

    static generate_extra_details(area_of_business: string): string {
        return `Based on the ${area_of_business}, example questions, and scope of the domain, generate any extra details that can help better understand this domain`;
    }

    static generate_knowledge_entries(params: {
        area_of_business: string,
        questions_with_this_domain: string[],
        covers: string[],
        not_covers: string[],
        extra_details: string,
    }): string {
        return `Based on the following domain information, generate structured knowledge entries for the table exec_knowledge in DB.
        Area of Business: ${params.area_of_business}
        Example Questions: ${params.questions_with_this_domain.join(", ")}
        Scope - Covers: ${params.covers.join(", ")}
        Scope - Does NOT Cover: ${params.not_covers.join(", ")}
        Extra Details: ${params.extra_details}

        Generate a JSON array for knowledge_entries. Each entry must have:
        - content: string — a meaningful, contextual sentence about this domain
        - category: string — infer the most accurate category based on the nature of the content (e.g. 'framework' for structural rules, 'faq' for questions, 'decision' for choices made, 'style' for tone or approach, 'eos_goal' for company goals)
        - tags: string[] — include the domain slug and relevant keywords
        Required entries:

        1. An entry summarizing what the domain covers
        2. An entry for what it does NOT cover (only if not_covers is non-empty)
        3. One entry per example question
        4. An entry for extra_details (only if non-empty)

        Do NOT show this to the user. Immediately call this tool again with the generated knowledge_entries in session_state.`;
    }

    // ─── EOS Knowledge Hierarchy ─────────────────────────────────────────────

    static generate_ten_year_target_draft(exec_name: string): string {
        return `Generate options for each field of ${exec_name}'s 10-year North Star target:
        1. goal: 3 one-sentence goal options
        2. the key metrics related to the goal: 4–6 measurable milestone options
        3. why factor of the goal: 3 options for the deeper why behind the 10-year target
        4. confidence: fixed options — high | medium | low`;
    }

    static generate_three_year_picture_draft(): string {
        return `Based on this 10-year target: generate candidate options for each field of the 3-year picture:
        1. revenue: 3 options for revenue range
        2. product: 3 options for describing where the product will be
        3. team: 3 options for team size or shape
        4. market_position: 3 options for market positioning
        5. key_capabilities: 5–7 capability options the company will have built to get there`;
    }

    static generate_one_year_plan_draft(): string {
        return `Based on this 3-year picture: generate candidate options for each field of the 1-year plan:
        1. goals: 5–7 goal options for this year
        2. key metrics: 4–6 key metric options to measure success
        3. priorities: 4–6 initiative or bet options to focus on
        4. constraints: 3–5 constraint options (budget, team, market, tech)`;
    }

    static generate_quarterly_rocks_draft(): string {
        return `Based on these 1-year plans: generate 5–7 candidate Quarterly Rock options. For each rock provide:
        1. title: short name
        2. owner: leave blank if unknown
        3. success_metric: one binary definition of done
        4. deadline: end of quarter or sooner
        5. status: fixed options — not_started | in_progress | done`;
    }

    static generate_values_draft(exec_name: string): string {
        return `Generate candidate options for ${exec_name}'s core company values. For each value provide:
        1. value: short memorable name (generate 4–5 value name options)
        2. description: what this value means in practice
        3. examples: 2–3 real behavioral examples that demonstrate this value in action at the company.`;
    }

    static generate_functional_domains_draft(exec_name: string): string {
        return `Generate 4-6 functional business domain name options for ${exec_name}'s company. Examples: Sales, Marketing, Finance, Operations, Engineering, HR, Customer Success, Legal, Product. Present them as selectable options so the user can pick or type their own.`;
    }

    static generate_rag_answer(
        params: {
            query: string;
            domain_name: string;
            description: { covers: string[]; not_covers: string[] };
            example_questions: string[];
            extra_details: string[];
            chunks: { id: string; content: string }[];
        }): string {
        const chunksText = params.chunks.map((c, i) => `[${i + 1}] ${c.content}`).join("\n");
        return `You are acting as the executive's second brain. Answer the following query about the ${params.domain_name} domain.
        Query: "${params.query}"
        --- ${params.domain_name} Context ---
        Covers: ${params.description?.covers?.join(", ")}
        Does NOT Cover: ${params.description?.not_covers?.join(", ")}
        Example Questions: ${params.example_questions?.join(", ")}
        Extra Details: ${params.extra_details?.join(", ")}
        --- Retrieved Knowledge ---
        ${chunksText}
        Answer in the executive's voice — confident, first-person, direct.
        Ground every claim in the retrieved knowledge above. Do not hallucinate.
        If the retrieved knowledge does not contain enough to answer, say so clearly.
        After presenting the answer to the user, call this tool again with your response text.`;
    }
}