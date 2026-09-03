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
  const res = await fetch(`${BASE}/chat/completions`, {
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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gonka ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return {
    message: json.choices[0].message as ChatMessage,
    requestId: json.id ?? res.headers.get("x-request-id"),
    model: json.model ?? MODEL,
  };
}
