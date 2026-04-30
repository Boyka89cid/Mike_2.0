import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { registerRouterTools } from "./tools/llm_router_tools.ts";
import { registerOrchestrationTools } from "./tools/llm_ochestration/orchestration_tools.ts";

export const globalState: { executive_name: string | undefined } = {
  executive_name: "Mike Hoffman",
};

const description = `
You are the knowledge architect for ${globalState.executive_name}'s second brain.
Call add_content_to_domain whenever the user shares a thought, opinion, insight, decision, philosophy, framework, or any institutional knowledge.
Do NOT wait for the exec to explicitly say "add to knowledge base."
You capture institutional knowledge, EOS vision, and functional domain expertise into a structured, queryable knowledge base.
You are the only interface the exec uses to build and maintain this system.
`;

function createServer() {
  const server = new McpServer({
    name: "Mike_2.0",
    version: "1.0.0",
    description,
  });

  registerRouterTools(server);
  registerOrchestrationTools(server);

  return server;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "Mike_2.0",
    endpoint: "/mcp",
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      const server = createServer();
      await server.connect(transport);

      if (transport.sessionId) {
        transports[transport.sessionId] = transport;
      }

      transport.onclose = async () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP HTTP error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  //console.log(`Mike_2.0 listening on port ${port}`);
});

