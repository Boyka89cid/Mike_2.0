import { SupabaseAdapter } from "../adapter/supabase_adapter.ts";
import { EmbeddingAdapter } from "../adapter/embedding_adapter.ts";
import { OpenAIHelpers } from "./llm_ochestration/openai_helpers.ts";

 export class SupabaseHelperFxns {

    async checkConnection(supabaseAdapter: SupabaseAdapter): Promise<string> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client.from("knowledge_domains").select("*").limit(1);
            if (error) {
                throw error;
            }
            return `Database connection successful. Query results: ${JSON.stringify(data)}`;
        } catch (e: any) {
            return `Database connection failed: ${e.message}`;
        }
    }

    async listDomains(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string): Promise<string> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client.from("knowledge_domains").select("display_name").eq("exec_id", exec_id).limit(10);
            if (error) {
                throw error;
            }
            const domains = [...new Set((data ?? []).map((row) => row.display_name))];
            return domains.join(", ");
        } catch (e: any) {
            return `Failed to list domains: ${e.message}`;
        }
    }

    async get_domain_slug_by_display_name(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        display_name: string
    ): Promise<string | null> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client
                .from("knowledge_domains")
                .select("domain_slug")
                .eq("exec_id", exec_id)
                .eq("display_name", display_name)
                .single();
            if (error) throw error;
            return data?.domain_slug ?? null;
        } catch {
            return null;
        }
    }

    async get_chunk_count(
        supabaseAdapter: SupabaseAdapter,
        domain_slug: string): Promise<string> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client.from("knowledge_domains").select("chunk_count").eq("domain_slug", domain_slug).single();
            if (error) {
                throw error;
            }
            return `The chunk count for domain ${domain_slug} is ${data?.chunk_count}`;
        } catch (e: any) {
            return `Failed to get chunk count: ${e.message}`;
        }
     }

    async read_domain(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string
    ): Promise<Record<string, any>> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client
                .from("knowledge_domains")
                .select("display_name, description, example_questions, extra_details")
                .eq("exec_id", exec_id)
                .eq("domain_slug", domain_slug)
                .single();

            if (error) throw error;
            if (!data) return { status: "not_found", message: `No domain found for slug '${domain_slug}'.` };

            return {
                status: "found",
                domain_slug,
                display_name: data.display_name,
                description: data.description,
                example_questions: data.example_questions,
                extra_details: data.extra_details,
            };
        } catch (e: any) {
            return { status: "error", message: `Failed to read domain: ${e.message}` };
        }
    }

    // Used for writing question and answer for the end user based on domain knowledge.
    // Requires the following in Supabase:
    //   1. An `embedding vector(1536)` column on `query_log`.
    //   2. This RPC function:
    //      CREATE OR REPLACE FUNCTION match_query_log(
    //        query_embedding vector(1536), p_exec_id text,
    //        p_threshold float DEFAULT 0.85, p_count int DEFAULT 5
    //      ) RETURNS TABLE (id uuid, question text, frequency int, similarity float)
    //      LANGUAGE sql STABLE AS $$
    //        SELECT id, question, frequency,
    //          1 - (embedding <=> query_embedding) AS similarity
    //        FROM query_log
    //        WHERE exec_id = p_exec_id
    //          AND 1 - (embedding <=> query_embedding) >= p_threshold
    //        ORDER BY similarity DESC
    //        LIMIT p_count;
    //      $$;
    async log_query(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        question: string,
        response: string,
        chunks_used: string[],
    ): Promise<void> {
        try {
            const client = supabaseAdapter.getClient();
            const embedding = await new EmbeddingAdapter().generateEmbedding(question);

            // Find existing queries with similar embeddings
            const { data: candidates } = await client.rpc("match_query_log", {
                query_embedding: embedding,
                p_exec_id: exec_id,
                p_threshold: 0.85,
                p_count: 5,
            }) as { data: { id: string; question: string; frequency: number }[] | null };

            if (candidates && candidates.length > 0) {
                for (const candidate of candidates) {
                    const isSame = await OpenAIHelpers.isSameQuestion(question, candidate.question);
                    if (isSame) {
                        await client
                            .from("query_log")
                            .update({ frequency: (candidate.frequency ?? 0) + 1, asked_at: new Date().toISOString() })
                            .eq("id", candidate.id);
                        return;
                    }
                }
            }

            // No matching query found — insert as new entry
            await client.from("query_log").insert({
                exec_id,
                question,
                response,
                asked_at: new Date().toISOString(),
                chunks_used,
                frequency: 1,
                embedding,
            });
        } catch {
            // Non-blocking — logging failure should not break the main flow
        }
    }

    // Requires this SQL function in Supabase:
    // CREATE OR REPLACE FUNCTION match_exec_knowledge(
    //   query_embedding vector(1536), p_exec_id text, p_domain text, p_count int DEFAULT 10
    // ) RETURNS TABLE (id uuid, content text, category text, tags text[], date_added timestamptz, similarity float)
    // LANGUAGE sql STABLE AS $$
    //   SELECT id, content, category, tags, date_added,
    //     1 - (embedding <=> query_embedding) AS similarity
    //     -- embedding column stores the vector of each content row; <=> computes cosine distance against query_embedding
    //   FROM exec_knowledge
    //   WHERE exec_id = p_exec_id AND domain = p_domain
    //   ORDER BY
    //     0.7 * (1 - (embedding <=> query_embedding))
    //     + 0.3 * exp(-extract(epoch from (now() - date_added)) / (30 * 86400.0)) DESC
    //   LIMIT p_count;
    // $$;
    
    async search_domain_chunks(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
        query: string
    ): Promise<Record<string, any>[]> {
        try {
            const queryEmbedding = await new EmbeddingAdapter().generateEmbedding(query);

            const client = supabaseAdapter.getClient();
            const { data, error } = await client.rpc("match_exec_knowledge", {
                query_embedding: queryEmbedding,  // matched against exec_knowledge.embedding (content's vector)
                p_exec_id: exec_id,
                p_domain: domain_slug,
                p_count: 10,
            });

            if (error) throw error;
            return data ?? [];
        } catch {
            return [];
        }
    }

    async create_exec_knowledge_seed_entries(
        supabaseAdapter: SupabaseAdapter,
        embeddingAdapter: EmbeddingAdapter,
        exec_id: string,
        domain_slug: string,
        entries: { content: string; category: string; tags: string[] }[]
    ): Promise<{ rows_created: number }> {
        const client = supabaseAdapter.getClient();
        const rows = await Promise.all(
            entries.map(async (entry) => ({
                exec_id,
                domain: domain_slug,
                content: entry.content,
                embedding: await embeddingAdapter.generateEmbedding(entry.content),
                category: entry.category,
                source_type: "seed_session",
                tags: entry.tags,
                is_seeded: true,
            }))
        );

        const { error } = await client.from("exec_knowledge").insert(rows);
        if (error) throw error;

        return { rows_created: rows.length };
    }

    async add_exec_question(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
        question: string,
        category: string,
        tags: string[],
    ): Promise<string> {
        const client = supabaseAdapter.getClient();
        const embedding = await new EmbeddingAdapter().generateEmbedding(question);
        const { data, error } = await client.from("exec_knowledge").insert({
            exec_id,
            domain: domain_slug,
            question,
            content: "",
            embedding,
            category,
            source_type: "seed_session",
            tags,
            is_seeded: false,
        }).select("id").single();
        if (error) throw error;
        return data.id;
    }

    async get_unanswered_questions(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
    ): Promise<{ id: string; question: string; category: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("exec_knowledge")
            .select("id, question, category")
            .eq("exec_id", exec_id)
            .eq("domain", domain_slug)
            .or("content.eq.,content.is.null")
            .not("question", "is", null);
        if (error) throw error;
        return data ?? [];
    }

    async delete_question(
        supabaseAdapter: SupabaseAdapter,
        id: string,
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const { error } = await client
            .from("exec_knowledge")
            .delete()
            .eq("id", id);
        if (error) throw error;
    }

    async save_question_answer(
        supabaseAdapter: SupabaseAdapter,
        _embeddingAdapter: EmbeddingAdapter,
        id: string,
        answer: string,
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const { error } = await client
            .from("exec_knowledge")
            .update({ content: answer })
            .eq("id", id);
        if (error) throw error;
    }

    async eos_profile_exists(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string
    ): Promise<boolean> {
        try {
            const client = supabaseAdapter.getClient();
            const { data, error } = await client
                .from("eos_profile")
                .select("exec_id")
                .eq("exec_id", exec_id)
                .single();
            return !error && !!data;
        } catch {
            return false;
        }
    }

    async upsert_eos_profile(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        profile: {
            ten_year: any;
            three_year: any;
            one_year: any;
            quarterly_rocks: any;
            values: any;
        }
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const { error } = await client.from("eos_profile").upsert(
            {
                exec_id,
                ten_year: profile.ten_year ?? null,
                three_year: profile.three_year ?? null,
                one_year: profile.one_year ?? null,
                quarterly_rocks: profile.quarterly_rocks ?? null,
                values: profile.values ?? null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "exec_id" }
        );
        if (error) throw new Error(`Failed to persist EOS profile: ${error.message}`);
    }

    // async eos_profile_exists(
    //     supabaseAdapter: SupabaseAdapter,
    //     exec_id: string
    // ): Promise<boolean> {
    //     try {
    //         const client = supabaseAdapter.getClient();
    //         const { data, error } = await client
    //             .from("eos_profile")
    //             .select("exec_id")
    //             .eq("exec_id", exec_id)
    //             .single();
    //         return !error && !!data;
    //     } catch {
    //         return false;
    //     }
    // }

    // async upsert_eos_profile(
    //     supabaseAdapter: SupabaseAdapter,
    //     exec_id: string,
    //     profile: {
    //         ten_year: any;
    //         three_year: any;
    //         one_year: any;
    //         quarterly_rocks: any;
    //         values: any;
    //     }
    // ): Promise<void> {
    //     const client = supabaseAdapter.getClient();
    //     const { error } = await client.from("eos_profile").upsert(
    //         {
    //             exec_id,
    //             ten_year: profile.ten_year ?? null,
    //             three_year: profile.three_year ?? null,
    //             one_year: profile.one_year ?? null,
    //             quarterly_rocks: profile.quarterly_rocks ?? null,
    //             values: profile.values ?? null,
    //             updated_at: new Date().toISOString(),
    //         },
    //         { onConflict: "exec_id" }
    //     );
    //     if (error) throw new Error(`Failed to persist EOS profile: ${error.message}`);
    // }

    async get_frequently_asked_questions(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        limit: number = 10,
    ): Promise<{ question: string; frequency: number; asked_at: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("query_log")
            .select("question, frequency, asked_at")
            .eq("exec_id", exec_id)
            .order("frequency", { ascending: false, nullsFirst: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    async create_domain(
        supabaseAdapter: SupabaseAdapter,
        domainDetails: {
            exec_id: string,
            domain_slug: string,
            area_of_business: string,
            scope_of_domain: { covers: string[], not_covers: string[] },
            user_questions_with_tags: { question: string; tags: string[] }[],  // stored in knowledge_domains.example_questions + exec_knowledge
            generated_questions: { question: string; tags: string[] }[],       // seeded into exec_knowledge only
            extra_details: string[],
            knowledge_entries: { content: string; category: string; tags: string[] }[],
        }): Promise<string> {
        try {
            const client = supabaseAdapter.getClient();

            const { data, error } = await client.from("knowledge_domains").insert({
                exec_id: domainDetails.exec_id,
                domain_slug: domainDetails.domain_slug,
                display_name: domainDetails.area_of_business,
                description: domainDetails.scope_of_domain,
                example_questions: domainDetails.user_questions_with_tags.map(q => q.question),
                extra_details: domainDetails.extra_details,
                created_at: new Date().toISOString(),
                created_by: 'exec',
                chunk_count: domainDetails.generated_questions.length + domainDetails.user_questions_with_tags.length
            }).select();

            if (error) throw error;

            const domain_id = data?.[0]?.id;

            for (const { question, tags } of domainDetails.user_questions_with_tags) {
                await this.add_exec_question(supabaseAdapter, domainDetails.exec_id, domainDetails.domain_slug, question, "faq", tags);
            }

            for (const { question, tags } of domainDetails.generated_questions) {
                await this.add_exec_question(supabaseAdapter, domainDetails.exec_id, domainDetails.domain_slug, question, "faq", tags);
            }

            // const embeddingAdapter = new EmbeddingAdapter();
            // const { rows_created } = await this.create_exec_knowledge_seed_entries(
            //     supabaseAdapter,
            //     embeddingAdapter,
            //     domainDetails.exec_id,
            //     domainDetails.domain_slug,
            //     domainDetails.knowledge_entries
            // );

            return `Domain created successfully with ID: ${domain_id}.`;
        } catch (e: any) {
            return `Failed to create domain: ${e.message}`;
        }
    }
 }