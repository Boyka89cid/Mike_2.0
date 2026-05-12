export class GenerationPrompts {

    static generate_example_questions(area_of_business: string): string {
        return `Generate 2 to 4 example questions that someone can ask about  ${area_of_business}. Also the last option should be speak out your own question so that the user can ask a question that is not in the list.`;
    }

    static generate_scope_of_domain(area_of_business: string, questions_with_this_domain: string[]): string {
        return `Based on the ${area_of_business} and the example questions ${questions_with_this_domain.join(", ")}, generate a clear scope of the domain in a concise manner for ${area_of_business}. Also the last option should be speak out your own scope so that the user can specify a scope that is not in the list.`;
    }

    static generate_extra_details(area_of_business: string): string {
        return `Based on the ${area_of_business}, example questions, and scope of the domain, generate any extra details that can help better understand this domain. Also the last option should be speak out your own details so that the user can provide details that are not in the list.`;
    }

    static generate_additional_questions_system(): string {
        return `You are an expert executive interviewer designing questions for a knowledge capture system. Your job is to generate deep, insightful interview questions that surface an executive's institutional knowledge, mental models, and decision-making philosophy about a specific business domain.
        A good question:
        - Draws out personal opinion, hard-won experience, or a decision the executive had to make — not textbook facts
        - Is open-ended and makes the executive pause and reflect before answering
        - Covers one of these angles: operational (how we do X), strategic (why we do X), definitional (what is X), or contextual (history, philosophy, trade-offs)
        - Is concise — one sentence
        Output format: Return ONLY a valid JSON array of objects with shape { "question": string, "tags": string[] }. Tags should be 2–4 lowercase keywords relevant to the question. No markdown, no explanation, no preamble.`;
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
        Generate exactly 3 additional questions.`;
    }

    static generate_follow_up_questions(params: {
        area_of_business: string;
        covers: string[];
        not_covers: string[];
        answered_qas: { question: string; answer: string }[];
        existing_questions: string[];
    }): string {
        const answeredBlock = params.answered_qas.length
            ? params.answered_qas.map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`).join("\n")
            : "(none answered yet)";
        return `Domain: ${params.area_of_business}
Scope covers: ${params.covers.join(", ")}
Scope does NOT cover: ${params.not_covers.join(", ")}
Questions already in the system — do NOT repeat these: ${params.existing_questions.join(", ")}
Answered Q&As so far (use these to go deeper or explore adjacent angles):
${answeredBlock}
Generate exactly 3 follow-up questions that dig deeper into what has been answered, or explore important angles not yet covered. If nothing has been answered yet, generate 3 general questions about the domain.`;
    }

    // ─── EOS Knowledge Hierarchy ─────────────────────────────────────────────

    static readonly SPEAK_OUT_RULE = `For every field's option list, always add 'Speak out in your own words' as the final option. When the user selects it, immediately ask them that single field as a plain follow-up question and wait for their typed/spoken answer before continuing.`;

    static generate_ten_year_target_draft(exec_name: string): string {
        return `Generate options for each field of ${exec_name}'s 10-year North Star target. Keep every option under 12 words — widget space is limited. ${GenerationPrompts.SPEAK_OUT_RULE}
        1. goal: 3 short goal options (max 12 words each)
        2. key metrics: 4–6 measurable milestone options (max 10 words each, e.g. $50M ARR, 10k customers)
        3. why: 3 options for the deeper why (max 12 words each)
        4. confidence: fixed options — high | medium | low`;
    }

    static generate_three_year_picture_draft(): string {
        return `Based on this 10-year target: generate candidate options for each field of the 3-year picture. Keep every option under 12 words — widget space is limited. ${GenerationPrompts.SPEAK_OUT_RULE}
        1. revenue: 3 revenue range options (max 8 words, e.g. $5M–$10M ARR)
        2. product: 3 options for product state (max 12 words each)
        3. team: 3 options for team size or shape (max 10 words each, e.g. 25-person cross-functional team)
        4. market_position: 3 positioning options (max 12 words each)
        5. key_capabilities: 5–7 capability options (max 10 words each, e.g. self-serve onboarding)`;
    }

    static generate_one_year_plan_draft(): string {
        return `Based on this 3-year picture: generate candidate options for each field of the 1-year plan. Keep every option under 12 words — widget space is limited. ${GenerationPrompts.SPEAK_OUT_RULE}
        1. goals: 5–7 goal options (max 12 words each)
        2. key metrics: 4–6 metric options (max 10 words each, e.g. 100% logo retention)
        3. priorities: 4–6 initiative options (max 10 words each, e.g. Launch enterprise tier)
        4. constraints: 3–5 constraint options (max 10 words each, e.g. No new headcount Q1)`;
    }

    static generate_quarterly_rocks_draft(): string {
        return `Based on these 1-year plans: generate 4 candidate Quarterly Rock options. Keep every option under 12 words — widget space is limited. ${GenerationPrompts.SPEAK_OUT_RULE}
        1. title: short rock name (max 10 words)
        2. owner: role or name (max 5 words, leave blank if unknown)
        3. success_metric: one binary definition of done (max 12 words)
        4. deadline: end of quarter or sooner (e.g. Mar 31)
        5. status: fixed options — not_started | in_progress | done`;
    }

    static generate_values_draft(exec_name: string): string {
        return `Generate candidate options for ${exec_name}'s core company values. Keep every option under 12 words — widget space is limited. ${GenerationPrompts.SPEAK_OUT_RULE}
        1. value name: 4–5 short memorable names (max 5 words each, e.g. Own It, Build Trust)
        2. description: what this value means in practice (max 12 words each)
        3. examples: 2–3 behavioral examples (max 12 words each, e.g. Ships on time without being asked)`;
    }

    static generate_functional_domains_draft(exec_name: string): string {
        return `Generate 3-5 functional domain name options for ${exec_name}'s company based upon the company's current structure and needs. Keep names short (1–5 words). Examples can include: Sales, Marketing, Finance, Customer Success, Product. Always add "Speak out in your own words" as the final option — when selected, ask the user to name their own domain and wait for their answer.`;
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
        const chunksText = params.chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n');
        return `You are acting as the executive's second brain. Answer the following query about the ${params.domain_name} domain.
        Query: '${params.query}'
        --- ${params.domain_name} Context ---
        Covers: ${params.description?.covers?.join(', ')}
        Does NOT Cover: ${params.description?.not_covers?.join(', ')}
        Example Questions: ${params.example_questions?.join(', ')}
        Extra Details: ${params.extra_details?.join(', ')}
        --- Retrieved Knowledge ---
        ${chunksText}
        Answer in the executive's voice — confident, first-person, direct.
        Ground every claim in the retrieved knowledge above. Do not hallucinate.
        If the retrieved knowledge does not contain enough to answer, say so clearly.
        After presenting the answer to the user, call this tool again with your response text.`;
    }
}