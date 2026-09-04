// POST /api/copilot { messages: [{role, content}] }
// Runs the Gonka Router tool loop and returns the assistant reply,
// any trade ticket the model prepared, and the Gonka request ids.
import { NextRequest, NextResponse } from "next/server";
import { gonkaChat, type ChatMessage } from "@/lib/gonka";
import { TOOL_DEFS, runTool, type TradeTicket } from "@/lib/copilot/tools";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the Monsoon copilot, for a two-sided ETH options market on Thetanuts (Base mainnet). You explain options in plain language for a smart beginner.

The two sides:
- BUY protection (executable HERE): filling any OptionBook offer means PAYING premium. A protective put pays out if ETH ends below the strike at expiry; the premium is the buyer's max loss. You can build buy tickets with propose_trade.
- UNDERWRITE / sell (NOT executable in chat): selling puts happens only through the sealed-bid RFQ auction on the shelf page, and covered calls through the auction on the Position page. When someone wants to sell, explain and point them there. Monsoon's three gates advise WHEN underwriting is well paid.

Rules:
- Ground every number in tool output; never invent prices. Call get_conditions or get_shelf before quoting anything.
- For a BUY, always state: premium paid (= max loss), what pays out and when (European: only the price AT expiry matters), breakeven, and payout odds.
- A put's payout is (strike minus ETH settlement price) per contract, growing as ETH falls; the "cap" is hit only if ETH goes to zero. NEVER describe it as a fixed payout at the strike.
- For SELLING questions: explain the mechanics (premium received, collateral locked, worst case) and point to the right auction; never pretend chat can execute a sell.
- If the gates are closed, say plainly that Monsoon is not underwriting at these conditions and why. Buying protection is a different decision (hedgers buy when THEY need cover) and stays available.
- Only call propose_trade after the user clearly picked an offer and an amount. Never propose more than the user's stated budget.
- Never recommend leverage, never promise returns, never call anything safe. Keep replies under 150 words unless asked for depth.
- Offer ids (P1.., PS1.., C1.., M1..) are MONSOON's own shelf labels, assigned by the get_shelf tool. They are not Thetanuts identifiers; never claim they come from Thetanuts.
- A BOUGHT put spread's max payout is the width times contracts; the max loss is the premium paid. Distinguish this carefully from seller math.
- Never annualize an offer shorter than 7 days; an APY on a 1-day option is meaningless. Quote the raw cycle yield instead.
- Moneyness: a put is IN the money (assignment likely) when spot is BELOW the strike, and out of the money when spot is ABOVE it. Always check which side spot is on before describing an offer's risk direction, and say plainly when a short strike is already in the money.
- Formatting: plain sentences, short **bold** lead-ins, and hyphen lists only. Never output markdown tables, horizontal rules (---), or em-dashes; the chat cannot render them.`;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Verification {
  score: number;        // 0-100 faithfulness of the reply to the tool data
  issues: string[];
  requestId: string | null;
  corrected?: boolean;  // true when a failed first draft was rewritten and re-verified
}

/** MiniMax is a reasoning model; drop its <think> scratchpad. */
function stripThink(content: string | null): string {
  return (content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^<think>[\s\S]*/g, "")
    .trim();
}

/** Independent second Gonka pass: does the reply's every claim match the tool data?
 *  No tool data means nothing to verify (pure explanation), so we skip. */
async function verifyReply(reply: string, toolLog: string[]): Promise<Verification | null> {
  if (!reply || toolLog.length === 0) return null;
  try {
    const { message, requestId } = await gonkaChat([
      {
        role: "system",
        content:
          "You are a strict verification pass. Compare the ANSWER against the TOOL DATA it was derived from. Check every number, gate status, strike, premium, and probability. Reply with ONLY a JSON object: {\"score\": 0-100, \"issues\": [\"...\"]}. score 100 = every claim traceable to the data; deduct for unsupported or contradicted claims. No prose.",
      },
      {
        role: "user",
        content: `TOOL DATA:\n${toolLog.join("\n").slice(0, 6000)}\n\nANSWER:\n${reply.slice(0, 3000)}`,
      },
    ]);
    const raw = (message.content ?? "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(0, Math.min(100, Number(parsed.score)));
    if (!Number.isFinite(score)) return null;
    return {
      score,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 3).map(String) : [],
      requestId,
    };
  } catch (e) {
    console.error("verification pass failed:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: { messages?: ClientMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const history = (body.messages ?? []).slice(-16);
  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "last message must be from user" }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const requestIds: string[] = [];
  const toolLog: string[] = [];
  let ticket: TradeTicket | undefined;

  try {
    for (let round = 0; round < 6; round++) {
      const { message, requestId } = await gonkaChat(messages, TOOL_DEFS);
      if (requestId) requestIds.push(requestId);

      if (!message.tool_calls?.length) {
        let reply = stripThink(message.content);
        let verification = await verifyReply(reply, toolLog);
        // Self-correction: if the verifier flags factual errors, give the model
        // one chance to fix them before the user ever sees the answer.
        if (verification && verification.score < 80 && verification.issues.length) {
          try {
            const { message: fixed, requestId: fixId } = await gonkaChat([
              ...messages,
              { role: "assistant", content: reply },
              {
                role: "user",
                content: `An independent verification pass found factual errors in your answer: ${verification.issues.join("; ")}. Rewrite the full answer using only correct numbers from the tool data. Same formatting rules.`,
              },
            ]);
            if (fixId) requestIds.push(fixId);
            const fixedReply = stripThink(fixed.content);
            const fixedVerification = await verifyReply(fixedReply, toolLog);
            if (fixedVerification && fixedVerification.score > verification.score) {
              reply = fixedReply;
              verification = { ...fixedVerification, corrected: true };
            }
          } catch (e) {
            console.error("self-correction failed:", e);
          }
        }
        return NextResponse.json({
          reply,
          ticket: ticket ?? null,
          requestIds,
          verification,
        });
      }

      messages.push(message);
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {}
        const out = await runTool(tc.function.name, args);
        if (out.ticket) ticket = out.ticket;
        toolLog.push(`${tc.function.name}(${tc.function.arguments}) -> ${out.result}`);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: out.result,
        });
      }
    }
    return NextResponse.json({
      reply: "I looked at too many things in one go. Ask me that again in a smaller step.",
      ticket: ticket ?? null,
      requestIds,
    });
  } catch (e) {
    console.error("copilot error:", e);
    const msg = e instanceof Error ? e.message : "unknown";
    const status = msg.includes("GONKA_API_KEY") ? 503 : 502;
    return NextResponse.json(
      {
        error: msg.includes("GONKA_API_KEY")
          ? "Copilot is not configured yet: the GONKA_API_KEY environment variable is missing."
          : `The Gonka Router request failed: ${msg}`,
        requestIds,
      },
      { status },
    );
  }
}
