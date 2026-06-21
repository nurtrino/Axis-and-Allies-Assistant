import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { buildGameStateContext } from "@/lib/gamestate";

export const runtime = "nodejs";
export const maxDuration = 120;

// Loaded once and reused; cached on Anthropic's side via cache_control below.
const RULEBOOK = fs.readFileSync(
  path.join(process.cwd(), "src", "data", "rulebook.txt"),
  "utf8",
);

const SYSTEM_INSTRUCTIONS = `You are the rules adjudicator and strategy advisor for Axis & Allies: Anniversary Edition (the 50th Anniversary edition). The complete official rulebook is provided below — treat it as the authoritative source and ground rules answers in it, quoting or paraphrasing the relevant rule.

When the user's message includes a "Current Game State" snapshot, use it: tailor strategy advice and "what should I do" questions to that exact board position and the asking player's coalition. For pure rules questions, answer from the rulebook regardless of game state.

Be concise, direct, and concrete. Lead with the answer, then a short justification. If a question is genuinely ambiguous or the rulebook is silent, say so briefly rather than inventing a rule. Do not claim certainty the rulebook doesn't support.`;

export async function POST(req: Request) {
  let body: { campaignId?: string; as?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return Response.json({ error: "Please enter a question." }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({
      answer:
        "⚠️ The assistant isn't configured yet. Set ANTHROPIC_API_KEY in the project's .env file and restart the dev server to enable game-aware rules answers.",
    });
  }

  // Build the live game-state context when a campaign is in scope.
  let context = "";
  if (body.campaignId) {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: body.campaignId },
        include: {
          players: { include: { assignments: true }, orderBy: { sortOrder: "asc" } },
          rounds: {
            orderBy: { number: "asc" },
            include: { entries: { include: { losses: true, raids: true } } },
          },
        },
      });
      if (campaign) context = buildGameStateContext(campaign, body.as);
    } catch {
      // Non-fatal — answer as a pure rules question if state can't be built.
    }
  }

  const userContent = context
    ? `${context}\n\n---\n\nQuestion: ${question}`
    : `Question: ${question}`;

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: SYSTEM_INSTRUCTIONS },
        {
          type: "text",
          text: `ANNIVERSARY EDITION RULEBOOK (full text):\n\n${RULEBOOK}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });

    const answer = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return Response.json({ answer: answer || "No answer was produced." });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return Response.json(
      { error: `The assistant request failed: ${detail}` },
      { status: 500 },
    );
  }
}
