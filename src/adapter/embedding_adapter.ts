import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

dotenv.config({
  path: path.resolve(dirname, "../../.env"),
  quiet: true,
});

export class EmbeddingAdapter {
  private apiKey: string;
  private model = "text-embedding-3-small";

  constructor() {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      throw new Error("Missing OPENAI_API_KEY in env");
    }
    this.apiKey = key;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding API error: ${err}`);
    }

    const json = (await response.json()) as { data: { embedding: number[] }[] };
    return json.data[0].embedding;
  }
}
