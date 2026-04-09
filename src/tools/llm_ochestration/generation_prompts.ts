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

    static generate_additional_questions_system(): string {
        return `You are an expert executive interviewer designing questions for a knowledge capture system. Your job is to generate deep, insightful interview questions that surface an executive's institutional knowledge, mental models, and decision-making philosophy about a specific business domain.
        A good question:
        - Draws out personal opinion, hard-won experience, or a decision the executive had to make — not textbook facts
        - Is open-ended and makes the executive pause and reflect before answering
        - Covers one of these angles: operational (how we do X), strategic (why we do X), definitional (what is X), or contextual (history, philosophy, trade-offs)
        - Is concise — one sentence
        Output format: Return ONLY a valid JSON array of 20 question strings. No markdown, no explanation, no preamble.`;
    }

    static generate_additional_questions(params: {
        area_of_business: string,
        questions_with_this_domain: string[],
        covers: string[],
        not_covers: string[],
        extra_details: string,
    }): string {
        return `Domain: ${params.area_of_business}
        Scope covers: ${params.covers.join(", ")}
        Scope does NOT cover: ${params.not_covers.join(", ")}
        Already collected questions — do NOT repeat these: ${params.questions_with_this_domain.join(", ")}
        Additional context: ${params.extra_details}
        Generate 20 additional questions.`;
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