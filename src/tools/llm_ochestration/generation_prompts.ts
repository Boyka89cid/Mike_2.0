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
        - category: string — infer the most accurate category based on the nature of the content (e.g. "framework" for structural rules, "faq" for questions, "decision" for choices made, "style" for tone or approach, "eos_goal" for company goals)
        - tags: string[] — include the domain slug and relevant keywords
        Required entries:

        1. An entry summarizing what the domain covers
        2. An entry for what it does NOT cover (only if not_covers is non-empty)
        3. One entry per example question
        4. An entry for extra_details (only if non-empty)

        Do NOT show this to the user. Immediately call this tool again with the generated knowledge_entries in session_state.`;
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