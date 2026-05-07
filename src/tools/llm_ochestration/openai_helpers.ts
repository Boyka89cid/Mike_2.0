import { GenerationPrompts } from "./generation_prompts.ts";

export class QuestionWithTags {
  question: string;
  tags: string[];

  constructor(question: string, tags: string[] = []) {
    this.question = question;
    this.tags = tags;
  }

  static from(raw: { question: string; tags?: string[] }): QuestionWithTags {
    return new QuestionWithTags(raw.question, [...(raw.tags ?? [])]);
  }
}

export class OpenAIHelpers {
  private static getApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY in env");
    return apiKey;
  }

  static async generateTagsForQuestions(questions: string[], area_of_business: string): Promise<QuestionWithTags[]> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: `You generate 2–4 lowercase keyword tags for each question in a business knowledge base. Output ONLY a valid JSON array of objects with shape { "question": string, "tags": string[] }. No markdown, no explanation.`,
          },
          {
            role: "user",
            content: `Domain: ${area_of_business}\nQuestions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${err}`);
    }

    const json = (await response.json()) as { choices: { message: { content: string } }[] };
    const text = json.choices[0]?.message?.content ?? "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed: { question: string; tags?: string[] }[] = jsonMatch ? JSON.parse(jsonMatch[0]) : questions.map(q => ({ question: q }));
    return parsed.map(QuestionWithTags.from);
  }

  // Returns true if the two questions are semantically equivalent.
  // Fails open (returns false) so a failed check never silently merges unrelated queries.
  static async isSameQuestion(newQuestion: string, existingQuestion: string): Promise<boolean> {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 10,
          messages: [
            {
              role: "system",
              content: `You are evaluating questions from a business knowledge base. Determine if the two questions below are asking for the same information — meaning the same answer would fully satisfy both, regardless of how they are worded. Reply ONLY with "yes" or "no".`,
            },
            {
              role: "user",
              content: `Incoming question: ${newQuestion}\nStored question: ${existingQuestion}`,
            },
          ],
        }),
      });
      if (!response.ok) return false;
      const json = (await response.json()) as { choices: { message: { content: string } }[] };
      return json.choices[0]?.message?.content?.trim().toLowerCase().startsWith("yes") ?? false;
    } catch {
      return false;
    }
  }

  static async generateAdditionalQuestions(params: {
    area_of_business: string;
    questions_with_this_domain: string[];
    scope_of_domain: { covers: string[]; not_covers: string[] };
    extra_details: string;
  }): Promise<QuestionWithTags[]> {
    const prompt = GenerationPrompts.generate_additional_questions({
      area_of_business: params.area_of_business,
      questions_with_this_domain: params.questions_with_this_domain,
      covers: params.scope_of_domain.covers,
      not_covers: params.scope_of_domain.not_covers,
      extra_details: params.extra_details,
    });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.getApiKey()}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2048,
        messages: [
          { role: "system", content: GenerationPrompts.generate_additional_questions_system() },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${err}`);
    }

    const json = (await response.json()) as { choices: { message: { content: string } }[] };
    const text = json.choices[0]?.message?.content ?? "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const parsed: { question: string; tags?: string[] }[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    return parsed.map(QuestionWithTags.from);
  }
}
