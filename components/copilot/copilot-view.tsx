"use client";

import { useRef, useState, useEffect } from "react";
import { PaperPlaneRightIcon, CloudRainIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import type { TradeTicket } from "@/lib/copilot/tools";
import { TradeTicketCard } from "./trade-ticket";

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  ticket?: TradeTicket | null;
  requestIds?: string[];
  verification?: {
    score: number;
    issues: string[];
    requestId: string | null;
    corrected?: boolean;
  } | null;
}

/** Minimal markdown: only **bold** spans, rendered as React elements (no HTML injection). */
function renderBold(text: string) {
  return text.split("**").map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

const SUGGESTIONS = [
  "Why is the shelf closed right now?",
  "I fear a crash this week. What protection can $5 buy?",
  "How do I underwrite and earn premium here?",
];

const STORAGE_KEY = "monsoon-copilot-chat";

export function CopilotView() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // survive navigation within the tab (sessionStorage, not localStorage:
  // a chat about live prices should not resurrect days later)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {}
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-30)));
    } catch {}
  }, [items, restored]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatItem[] = [...items, { role: "user", content }];
    setItems(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        // platform error page (e.g. a function timeout) - not our JSON
        throw new Error(
          "The copilot took too long on that one. Ask again - repeat questions are usually fast.",
        );
      }
      if (!res.ok) throw new Error(json.error ?? `copilot ${res.status}`);
      setItems((cur) => [
        ...cur,
        {
          role: "assistant",
          content: json.reply,
          ticket: json.ticket,
          requestIds: json.requestIds,
          verification: json.verification,
        },
      ]);
    } catch (e) {
      setItems((cur) => [
        ...cur,
        { role: "assistant", content: e instanceof Error ? e.message : "Something went wrong." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-3xl flex-col px-4 pb-8 pt-12">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tighter">Copilot</h1>
        {items.length > 0 && (
          <button
            onClick={() => {
              setItems([]);
              try {
                sessionStorage.removeItem(STORAGE_KEY);
              } catch {}
            }}
            className="text-sm text-faint transition-colors hover:text-foreground"
          >
            Clear chat
          </button>
        )}
      </div>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Ask about the gates, the shelf, or a specific trade. Reasoning runs on the Gonka
        decentralized network; every answer is grounded in live Thetanuts data.
      </p>

      <div className="mt-8 flex-1 space-y-5">
        {items.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-lg border border-line bg-surface p-3 text-left text-sm text-muted transition-colors hover:border-accent-dim hover:text-foreground active:scale-[0.99]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {items.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-lg bg-surface-raised px-4 py-2.5 text-sm">
              {m.content}
            </p>
          ) : (
            <div key={i} className="max-w-[92%] space-y-3">
              <div className="flex gap-3">
                <CloudRainIcon size={18} weight="fill" className="mt-1 shrink-0 text-accent" />
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{renderBold(m.content)}</p>
              </div>
              {m.ticket && <TradeTicketCard ticket={m.ticket} />}
              {m.verification && (
                <div className="flex items-start gap-2 pl-8 text-xs">
                  <ShieldCheckIcon
                    size={14}
                    weight="fill"
                    className={m.verification.score >= 80 ? "text-accent" : "text-warn"}
                  />
                  <span className="text-muted">
                    Independently verified against the tool data: faithfulness{" "}
                    <span className="num text-foreground">{m.verification.score}/100</span>
                    {m.verification.corrected && (
                      <span className="text-faint">
                        {" "}
                        · first draft failed verification and was rewritten
                      </span>
                    )}
                    {m.verification.issues.length > 0 && (
                      <span className="text-faint"> · {m.verification.issues.join("; ")}</span>
                    )}
                  </span>
                </div>
              )}
              {m.requestIds && m.requestIds.length > 0 && (
                <p className="num pl-8 text-xs text-faint">
                  Gonka request{" "}
                  {[...m.requestIds, ...(m.verification?.requestId ? [m.verification.requestId] : [])].join(" · ")}
                </p>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-3 text-sm text-muted">
            <CloudRainIcon size={18} className="animate-pulse text-accent" />
            Checking the market…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 mt-8 flex gap-2 rounded-lg border border-line bg-surface p-2"
      >
        <label htmlFor="copilot-input" className="sr-only">
          Message the copilot
        </label>
        <input
          id="copilot-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. what would I earn selling a put 10% below spot?"
          className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-faint"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="rounded-md bg-accent p-2 text-accent-ink transition-transform hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
        >
          <PaperPlaneRightIcon size={16} weight="fill" />
        </button>
      </form>
    </div>
  );
}
