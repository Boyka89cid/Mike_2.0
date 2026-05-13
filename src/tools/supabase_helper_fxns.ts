import { SupabaseAdapter } from "../adapter/supabase_adapter.ts";
import { EmbeddingAdapter } from "../adapter/embedding_adapter.ts";
import { OpenAIHelpers } from "./llm_ochestration/openai_helpers.ts";

 export class SupabaseHelperFxns {

    private static buildEosEmbeddingText(eos_level: string, content: any): string {
        switch (eos_level) {
            case "ten_year":
                return `10-Year Target: ${content.goal}. Why: ${content.why}. Metrics: ${(content.metrics ?? []).join(", ")}. Confidence: ${content.confidence}.`;
            case "three_year":
                return `3-Year Picture: Revenue: ${content.revenue}. Product: ${content.product}. Team: ${content.team}. Market Position: ${content.market_position}. Key Capabilities: ${(content.key_capabilities ?? []).join(", ")}.`;
            case "one_year":
                return `1-Year Plan: Goals: ${(content.goals ?? []).join(", ")}. Priorities: ${(content.priorities ?? []).join(", ")}. Metrics: ${(content.metrics ?? []).join(", ")}. Constraints: ${(content.constraints ?? []).join(", ")}.`;
            case "quarterly_rock":
                return `Quarterly Rock: ${content.title}. Owner: ${content.owner}. Success Metric: ${content.success_metric}. Deadline: ${content.deadline}. Status: ${content.status}.`;
            case "values":
                return `Core Value: ${content.value}. ${content.description}. Examples: ${(content.examples ?? []).join(", ")}.`;
            case "context":
                if (content.functional_domains)
                    return `Functional Domains: ${(content.functional_domains ?? []).join(", ")}.`;
                return JSON.stringify(content);
            default:
                return JSON.stringify(content);
        }
    }

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
        domain_slug: string,
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
            }) as { data: { id: string; question: string; domain_slug: string; asked_at: string; frequency: number}[] | null };

            if (candidates && candidates.length > 0) {
                for (const candidate of candidates) {
                    const isSame = await OpenAIHelpers.isSameQuestion(question, candidate.question);
                    if (isSame) {
                        const updatePayload: Record<string, any> = { frequency: (candidate.frequency ?? 0) + 1, asked_at: new Date().toISOString() };
                        if (response?.trim()) updatePayload.response = response;
                        if (domain_slug && !candidate.domain_slug) updatePayload.domain_slug = domain_slug;
                        await client
                            .from("query_log")
                            .update(updatePayload)
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
                domain_slug
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
        const queryEmbedding = await new EmbeddingAdapter().generateEmbedding(query);
        const client = supabaseAdapter.getClient();
        const { data, error } = await client.rpc("match_exec_knowledge", {
            p_query_embedding: queryEmbedding,
            p_exec_id: exec_id,
            p_domain: domain_slug,
            p_count: 5,
        });
        if (error) throw error;
        return data ?? [];
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
        is_seeded: boolean = false,
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
            is_seeded,
        }).select("id").single();
        if (error) throw error;
        this.sync_chunk_count(supabaseAdapter, exec_id, domain_slug);
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

    async count_domain_questions(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
    ): Promise<number> {
        const client = supabaseAdapter.getClient();
        const { count, error } = await client
            .from("exec_knowledge")
            .select("id", { count: "exact", head: true })
            .eq("exec_id", exec_id)
            .eq("domain", domain_slug)
            .not("question", "is", null);
        if (error) throw error;
        return count ?? 0;
    }

    async get_answered_questions(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
    ): Promise<{ question: string; content: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("exec_knowledge")
            .select("question, content")
            .eq("exec_id", exec_id)
            .eq("domain", domain_slug)
            .not("question", "is", null)
            .not("content", "is", null)
            .neq("content", "");
        if (error) throw error;
        return data ?? [];
    }

    private async sync_chunk_count(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
    ): Promise<void> {
        try {
            const count = await this.count_domain_questions(supabaseAdapter, exec_id, domain_slug);
            const client = supabaseAdapter.getClient();
            await client
                .from("knowledge_domains")
                .update({ chunk_count: count })
                .eq("exec_id", exec_id)
                .eq("domain_slug", domain_slug);
        } catch {
            // Non-blocking — count sync failure should not break the main flow
        }
    }

    async delete_question(
        supabaseAdapter: SupabaseAdapter,
        id: string,
        exec_id: string,
        domain_slug: string,
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const { error } = await client
            .from("exec_knowledge")
            .delete()
            .eq("id", id);
        if (error) throw error;
        await this.sync_chunk_count(supabaseAdapter, exec_id, domain_slug);
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

    async search_question_across_domains(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        query: string
    ): Promise<{ id: string; question: string; content: string; domain: string; similarity: number }[]> {
        const client = supabaseAdapter.getClient();

        // Get all domain slugs for this exec
        const { data: domains, error: domainErr } = await client
            .from("knowledge_domains")
            .select("domain_slug")
            .eq("exec_id", exec_id);
        if (domainErr) throw domainErr;
        const slugs: string[] = (domains ?? []).map((r: any) => r.domain_slug);
        if (slugs.length === 0) return [];

        // Generate embedding once
        const queryEmbedding = await new EmbeddingAdapter().generateEmbedding(query);

        // Call match_exec_knowledge per domain, collect top 3 per domain
        const allHits: { id: string; similarity: number; domain: string }[] = [];
        await Promise.all(slugs.map(async (slug) => {
            const { data, error } = await client.rpc("match_exec_knowledge", {
                p_query_embedding: queryEmbedding,
                p_exec_id: exec_id,
                p_domain: slug,
                p_count: 3,
            });
            if (error || !data) return;
            for (const row of data) {
                allHits.push({ id: row.id, similarity: row.similarity, domain: slug });
            }
        }));

        if (allHits.length === 0) return [];

        // Sort by similarity descending, take top 5
        allHits.sort((a, b) => b.similarity - a.similarity);
        const top = allHits.slice(0, 5);

        // Fetch question + content for top IDs
        const topIds = top.map(h => h.id);
        const { data: rows, error: rowErr } = await client
            .from("exec_knowledge")
            .select("id, question, content")
            .in("id", topIds)
            .not("question", "is", null);
        if (rowErr) throw rowErr;

        const rowMap = new Map((rows ?? []).map((r: any) => [r.id, r]));
        return top
            .map(h => {
                const row = rowMap.get(h.id);
                if (!row || !row.question) return null;
                return { id: h.id, question: row.question, content: row.content ?? "", domain: h.domain, similarity: h.similarity };
            })
            .filter(Boolean) as { id: string; question: string; content: string; domain: string; similarity: number }[];
    }

    async get_domain_breakdown(supabaseAdapter: SupabaseAdapter, exec_id: string): Promise<Record<string, any>> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("query_log")
            .select("domain_slug, frequency, chunks_used")
            .eq("exec_id", exec_id);
        if (error) throw error;

        const map: Record<string, { query_count: number; total_asks: number; total_real_chunks: number }> = {};
        for (const row of data ?? []) {
            const slug = row.domain_slug ?? "unknown";
            if (!map[slug]) map[slug] = { query_count: 0, total_asks: 0, total_real_chunks: 0 };
            map[slug].query_count += 1;
            map[slug].total_asks += row.frequency ?? 1;
            // Only count real KB chunks (UUIDs), not synthetic desc_ chunks
            const realChunks = (row.chunks_used ?? []).filter((id: string) => !id.startsWith("desc_"));
            map[slug].total_real_chunks += realChunks.length;
        }

        const breakdown = Object.entries(map).map(([domain_slug, s]) => ({
            domain_slug,
            unique_queries: s.query_count,
            total_asks: s.total_asks,
            avg_kb_chunks_per_query: s.query_count > 0 ? Math.round((s.total_real_chunks / s.query_count) * 10) / 10 : 0,
        })).sort((a, b) => b.total_asks - a.total_asks);

        const most_asked = breakdown[0]?.domain_slug ?? null;
        const weakest = [...breakdown].sort((a, b) => a.avg_kb_chunks_per_query - b.avg_kb_chunks_per_query)[0]?.domain_slug ?? null;

        return { breakdown, most_asked, weakest };
    }

    async get_domain_health(supabaseAdapter: SupabaseAdapter, exec_id: string): Promise<Record<string, any>> {
        const client = supabaseAdapter.getClient();

        const [{ data: domains, error: dErr }, { data: knowledge, error: kErr }] = await Promise.all([
            client.from("knowledge_domains").select("domain_slug, display_name, chunk_count").eq("exec_id", exec_id),
            client.from("exec_knowledge").select("domain, content").eq("exec_id", exec_id),
        ]);
        if (dErr) throw dErr;
        if (kErr) throw kErr;

        const counts: Record<string, { answered: number; unanswered: number }> = {};
        for (const row of knowledge ?? []) {
            const slug = row.domain ?? "unknown";
            if (!counts[slug]) counts[slug] = { answered: 0, unanswered: 0 };
            if (row.content?.trim()) counts[slug].answered++;
            else counts[slug].unanswered++;
        }

        const health = (domains ?? []).map((d: any) => ({
            domain_slug: d.domain_slug,
            display_name: d.display_name,
            chunk_count: d.chunk_count ?? 0,
            answered: counts[d.domain_slug]?.answered ?? 0,
            unanswered: counts[d.domain_slug]?.unanswered ?? 0,
            is_thin: (d.chunk_count ?? 0) < 5,
        })).sort((a: any, b: any) => b.unanswered - a.unanswered);

        const thin_domains = health.filter((d: any) => d.is_thin);
        const bottom5 = health.slice(0, 5);

        return { health, thin_domains, bottom5 };
    }

    async eos_hierarchy_complete(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string
    ): Promise<boolean> {
        try {
            const client = supabaseAdapter.getClient();
            const required = ["ten_year", "three_year", "one_year", "quarterly_rock", "values"];
            const { data, error } = await client
                .from("eos_items")
                .select("eos_level")
                .eq("exec_id", exec_id);
            if (error || !data) return false;
            const present = new Set(data.map((r: any) => r.eos_level));
            return required.every(l => present.has(l));
        } catch {
            return false;
        }
    }

    async insert_eos_items(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        state: {
            captured_ten_year?: any;
            captured_three_year?: any;
            captured_one_year?: any[];
            captured_quarterly_rocks?: any[];
            captured_values?: any[];
            captured_functional_domains?: string[];
        }
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const embeddingAdapter = new EmbeddingAdapter();

        const now = new Date();
        const y = now.getFullYear();
        const qStart = new Date(y, Math.floor(now.getMonth() / 3) * 3, 1);
        const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);

        const periods: Record<string, { start: string; end: string } | null> = {
            ten_year:      { start: now.toISOString(), end: new Date(y + 10, now.getMonth(), now.getDate()).toISOString() },
            three_year:    { start: now.toISOString(), end: new Date(y + 3,  now.getMonth(), now.getDate()).toISOString() },
            one_year:      { start: now.toISOString(), end: new Date(y + 1,  now.getMonth(), now.getDate()).toISOString() },
            quarterly_rock:{ start: qStart.toISOString(), end: qEnd.toISOString() },
            values:        null,
            context:       null,
        };

        // Insert in hierarchy order so parent IDs are available
        let tenYearId: string | null = null;
        let threeYearId: string | null = null;
        let oneYearId: string | null = null;

        const insertedIds: string[] = [];

        const insertItem = async (
            eos_level: string,
            title: string,
            content: any,
            parent_id: string | null
        ): Promise<string> => {
            const period = periods[eos_level] ?? null;
            const embeddingText = SupabaseHelperFxns.buildEosEmbeddingText(eos_level, content);
            const { data: itemData, error: itemError } = await client
                .from("eos_items")
                .insert({
                    exec_id, eos_level, title, content,
                    parent_id,
                    period_start: period?.start ?? null,
                    period_end:   period?.end   ?? null,
                })
                .select("id")
                .single();
            if (itemError) throw new Error(`Failed to insert eos_item (${eos_level}): ${itemError.message}`);
            insertedIds.push(itemData.id);
            const embedding = await embeddingAdapter.generateEmbedding(embeddingText);
            const { error: embError } = await client
                .from("eos_item_embeddings")
                .insert({ eos_item_id: itemData.id, exec_id, embedding_text: embeddingText, embedding });
            if (embError) throw new Error(`Failed to insert embedding for eos_item ${itemData.id}: ${embError.message}`);
            return itemData.id;
        };

        try {
            if (state.captured_ten_year)
                tenYearId = await insertItem("ten_year", "10-Year Target", state.captured_ten_year, null);

            if (state.captured_three_year)
                threeYearId = await insertItem("three_year", "3-Year Picture", state.captured_three_year, tenYearId);

            for (const plan of state.captured_one_year ?? [])
                oneYearId = await insertItem("one_year", "1-Year Plan", plan, threeYearId);

            for (const rock of state.captured_quarterly_rocks ?? [])
                await insertItem("quarterly_rock", rock.title ?? "Quarterly Rock", rock, oneYearId);

            for (const val of state.captured_values ?? [])
                await insertItem("values", val.value ?? "Core Value", val, null);

            if (state.captured_functional_domains?.length)
                await insertItem("context", "Functional Domains", { functional_domains: state.captured_functional_domains }, null);
        } catch (e) {
            // Rollback: delete all items inserted so far (cascade deletes embeddings)
            if (insertedIds.length > 0) {
                await client.from("eos_items").delete().in("id", insertedIds);
            }
            throw e;
        }
    }

    async read_eos_items(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        eos_level?: string
    ): Promise<Record<string, any>[]> {
        const client = supabaseAdapter.getClient();
        let query = client
            .from("eos_items")
            .select("id, eos_level, title, content, period_start, period_end, parent_id, status, version")
            .eq("exec_id", exec_id)
            .eq("is_current", true)
            .order("created_at", { ascending: true });
        if (eos_level && eos_level !== "all")
            query = query.eq("eos_level", eos_level);
        const { data, error } = await query;
        if (error) throw new Error(`Failed to read EOS items: ${error.message}`);
        return (data ?? []).map((row: any) => ({
            ...row,
            content: typeof row.content === "string" ? JSON.parse(row.content) : row.content,
            period_start: row.period_start ? row.period_start.split("T")[0] : null,
            period_end:   row.period_end   ? row.period_end.split("T")[0]   : null,
        }));
    }

    async update_eos_item(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        item_id: string,
        eos_level: string,
        updated_content: any
    ): Promise<void> {
        const client = supabaseAdapter.getClient();
        const { error: updateError } = await client
            .from("eos_items")
            .update({ content: updated_content, updated_at: new Date().toISOString() })
            .eq("id", item_id)
            .eq("exec_id", exec_id);
        if (updateError) throw new Error(`Failed to update eos_item: ${updateError.message}`);

        const embeddingText = SupabaseHelperFxns.buildEosEmbeddingText(eos_level, updated_content);
        const embedding = await new EmbeddingAdapter().generateEmbedding(embeddingText);
        const { error: embError } = await client
            .from("eos_item_embeddings")
            .update({ embedding, embedding_text: embeddingText, updated_at: new Date().toISOString() })
            .eq("eos_item_id", item_id);
        if (embError) throw new Error(`Failed to update embedding for eos_item ${item_id}: ${embError.message}`);
    }

    async get_frequently_asked_questions_by_quantity(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        limit: number = 10,
    ): Promise<{ question: string; response: string; frequency: number; asked_at: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("query_log")
            .select("question, response, frequency, asked_at")
            .eq("exec_id", exec_id)
            .order("frequency", { ascending: false, nullsFirst: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    async get_frequently_asked_questions_by_time(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        limit: number = 10,
    ): Promise<{ question: string; response: string; frequency: number; asked_at: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("query_log")
            .select("question, response, frequency, asked_at")
            .eq("exec_id", exec_id)
            .order("asked_at", { ascending: false, nullsFirst: false })
            .limit(limit);
        if (error) throw error;
        return data ?? [];
    }

    async get_frequently_asked_questions_by_domain(
        supabaseAdapter: SupabaseAdapter,
        exec_id: string,
        domain_slug: string,
        limit: number = 10,
    ): Promise<{ question: string; response: string; frequency: number; asked_at: string }[]> {
        const client = supabaseAdapter.getClient();
        const { data, error } = await client
            .from("query_log")
            .select("question, response, frequency, asked_at")
            .eq("exec_id", exec_id)
            .eq("domain_slug", domain_slug)
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
                await this.add_exec_question(supabaseAdapter, domainDetails.exec_id, domainDetails.domain_slug, question, "faq", tags, true);
            }

            for (const { question, tags } of domainDetails.generated_questions) {
                await this.add_exec_question(supabaseAdapter, domainDetails.exec_id, domainDetails.domain_slug, question, "faq", tags, true);
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