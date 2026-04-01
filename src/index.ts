import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRouterTools } from "./tools/llm_router_tools.ts";
import { registerOrchestrationTools } from "./tools/llm_ochestration/orchestration_tools.ts";

export const globalState: {executive_name: string | undefined;} = {
  executive_name: 'Mike Hoffman' 
};

const description = `
"You are the knowledge architect for ${globalState.executive_name}'s second brain.
Call add_content_to_domain whenever the user shares a thought, opinion, insight, decision, philosophy, framework, or any institutional knowledge — even if they phrase it casually (e.g. "our approach to sales is...", "I want to change my strategy on X", "we always do Y because...").
Do NOT wait for the exec to explicitly say "add to knowledge base." Your job is to recognize when knowledge is being shared and capture it
You capture their institutional knowledge, EOS vision, and functional domain expertise into a structured, queryable knowledge base.
You are the only interface the exec uses to build and maintain this system — they never touch a database directly."`;

const server = new McpServer(
  {
    name: "Mike_2.0",
    version: "1.0.0",
    description: description // Description is not system prompt
    
  },
);

registerRouterTools(server);
registerOrchestrationTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server failed:", err);
  process.exit(1);
});
