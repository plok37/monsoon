// Minimal OpenAI-compatible client for Gonka Router (api.gonkarouter.io).
// All Monsoon AI reasoning runs through Gonka.

const BASE = process.env.GONKA_BASE_URL ?? "https://api.gonkarouter.io/v1";
// MiniMax responds in ~1-2s on Gonka with working tool calls; Kimi-K2.6
// regularly hits Cloudflare's 100s timeout (524). MiniMax is a reasoning
// model: strip <think> blocks before showing content to users.
const MODEL = process.env.GONKA_MODEL ?? "MiniMaxAI/MiniMax-M2.7";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface GonkaResult {
  message: ChatMessage;
  requestId: string | null;
  model: string;
}

export async function gonkaChat(
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<GonkaResult> {
  const key = process.env.GONKA_API_KEY;
  if (!key) throw new Error("GONKA_API_KEY is not set");

  // The decentralized router occasionally throws transient 5xx (Cloudflare
  // pages). Retry twice with a short backoff before surfacing an error.
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
          temperature: 0.3,
          max_tokens: 2500,
        }),
      });
      if (res.ok) break;
      lastErr = `gonka ${res.status}`;
      if (res.status < 500 && res.status !== 429) {
        const body = await res.text();
        throw new Error(`gonka ${res.status}: ${body.slice(0, 200)}`);
      }
      res = null;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("gonka ")) throw e;
      lastErr = e instanceof Error ? e.message : "network error";
      res = null;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  if (!res) {
    throw new Error(
      `The Gonka network is having a moment (${lastErr}). Please ask again in a few seconds.`,
    );
  }
  const json = await res.json();
  return {
    message: json.choices[0].message as ChatMessage,
    requestId: json.id ?? res.headers.get("x-request-id"),
    model: json.model ?? MODEL,
  };
}
