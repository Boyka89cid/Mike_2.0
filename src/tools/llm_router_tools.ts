import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SupabaseAdapter } from "../adapter/supabase_adapter.ts";
import { SupabaseHelperFxns } from "./supabase_helper_fxns.ts";
import { globalState } from "../index.ts";
import { ToolPrompts } from "./llm_ochestration/tool_prompts.ts";

export function registerRouterTools(mcp: McpServer) {
    const routerTools = new LLMRouterTools();
    const availableTools = Object.getOwnPropertyNames(LLMRouterTools.prototype).filter(
      (method) => method !== "constructor" && typeof (routerTools as any)[method] === "function"
    );
      for (const toolName of availableTools) {
        mcp.registerTool(
          toolName,
          {
            description: (ToolPrompts as any)[toolName] ? (ToolPrompts as any)[toolName] : `No description available for ${toolName}`,
            inputSchema: undefined, // You can define specific input schemas for each tool if needed
          },
          async () => {
            const result = await (routerTools as any)[toolName]();
          return {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result)
              }
            ]
          };
        }
        );
      }
}

// const LIST_DOMAIN_SESSIONS: Record<string, ListDomainsSessionState> = {};

class LLMRouterTools {
  private adapter: SupabaseAdapter;
  private helper: SupabaseHelperFxns;
  constructor() {
    this.adapter = new SupabaseAdapter();
    this.helper = new SupabaseHelperFxns();
  }

  async check_supabase_connection(): Promise<string> {
    try {
      const helper = new SupabaseHelperFxns();
      const result = await helper.checkConnection(this.adapter);
      return result;
    } catch (e: any) {
      return `Error checking Supabase connection: ${e.message}`;
    }
  }

  // We don't need the sessionState: ListDomainsSessionState a parameter for list_domains because we are only supporting one executive per server instance for now, so we can get the exec_name directly from globalState.
  // We can add sessionState as a parameter and implement a more complex state machine for handling multiple executives in the future if needed.
   async list_domains(): Promise<Record<string, any>> {
    try {
          const exec_name = globalState.executive_name!;
          const domains = await this.helper.listDomains(this.adapter, exec_name);
          // delete LIST_DOMAIN_SESSIONS[session.session_id];
          if (domains.length === 0) {
            return {
              status: "no_domains_found",
              message: `No domains found for executive name: '${exec_name}'.`,
            };
          }
          return {
            status: "listed_domains",
            message: `Domains for executive name '${exec_name}' fetched successfully.`,
            domains: domains,
          };
        } catch (e: any) {
          // delete LIST_DOMAIN_SESSIONS[session.session_id];
          return {
            status: "error",
            message: `Error listing domains: ${e.message}`,
          };
        }
  }
}

// if (!sessionState?.session_id) {
    //     return {
    //       status: "error",
    //       message: "Missing session_id in sessionState.",
    //     };
    //   }
    // const decideStep = (s: ListDomainsSessionState): string => {
    //   const hasExecName = Boolean(s.exec_name?.trim());
    //   return hasExecName ? ListDomainSteps.FETCH : ListDomainSteps.ASK_EXEC_NAME;
    // };
  
    // const session =
    // LIST_DOMAIN_SESSIONS[sessionState.session_id] ?? {
    //       session_id: sessionState.session_id,
    //       exec_name: "",
    //       step: ListDomainSteps.FETCH,
    //     };
  
    //   if (sessionState.exec_name !== undefined) {
    //     session.exec_name = globalState.executive_name;
    //   }
  
    //   session.step = ListDomainSteps.FETCH;
  
    //   LIST_DOMAIN_SESSIONS[sessionState.session_id] = session;
  
    // Only one executive per server as of now
    // if (session.step === ListDomainSteps.ASK_EXEC_NAME) {
    //   try {
    //     const list_exec_names = await this.helper.listExecs(this.adapter);
    //     return {
    //       status: "ask_exec_name",
    //       //session,
    //       message: "Can I know what name is associated with your executive profile?",
    //       examples: list_exec_names
    //         ? `Here are some examples of executive names from the database to choose from: ${list_exec_names}`
    //         : "No executive names found in the database.",
    //     };
    //   } catch (e: any) {
    //     delete LIST_DOMAIN_SESSIONS[session.session_id];
    //     return {
    //       status: "error",
    //       message: `Error fetching exec_name list: ${e.message}`,
    //     };
    //   }
    // }