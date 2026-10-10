/**
 * "Ask the map" — the parts that decide what may be shown.
 *
 * The language model is an interface here, never a source. It may only
 * (1) choose which read-only tools to call and (2) phrase the figures those
 * tools returned. Everything in this file exists to enforce that:
 *
 *   - questions the data cannot answer are refused before any model call;
 *   - the model's final answer must be structured, every figure carrying the
 *     metric, value, geography and dataset id from a tool result;
 *   - `checkAnswer` rejects any answer containing a number that did not come
 *     from a tool result (or the user's own question), any citation that does
 *     not match a returned figure, and any wording the product forbids;
 *   - a rejected answer is sent back for another attempt, and if it still
 *     fails the user is told no verifiable answer could be produced.
 *
 * Deliberately dependency-free (types only) so the same code runs in the API
 * route and in scripts/geo/test-ask.mjs with a scripted stand-in for the model.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const ASK_MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 8;
const MAX_ATTEMPTS = 3;

/** One figure a tool returned. The model can cite these and nothing else. */
export type Figure = {
  metric: string;
  label: string;
  geography: string;
  value: number;
  /** The value formatted by the server; the model is told to use this text verbatim. */
  display: string;
  unit: string;
  dataset_id: string;
  reference_year: string;
};

export type ToolResult = { figures: Figure[]; notes?: string[]; error?: string };

export type Citation = { metric: string; value: number; geography: string; dataset_id: string };
export type Statement = { text: string; citations: Citation[] };
export type ModelAnswer = {
  status: 'answered' | 'cannot_answer';
  statements: Statement[];
  /** Why the data cannot answer, when status is cannot_answer. Empty otherwise. */
  cannot_answer_reason: string;
  /** What the data can say instead. Empty when not applicable. */
  suggestion: string;
};

export type ToolCallRecord = { name: string; input: unknown; figures: number; error?: string };

export type AskResult = {
  status: 'answered' | 'cannot_answer' | 'refused' | 'unverifiable' | 'error';
  statements: (Statement & { figures: Figure[] })[];
  reason: string;
  suggestion: string;
  /** Reference year of every dataset the answer drew on, attached by the server, not the model. */
  sources: { dataset_id: string; reference_year: string }[];
  tool_calls: ToolCallRecord[];
  attempts: number;
  /** Violations that caused an earlier attempt to be thrown away. Kept for the audit log. */
  rejected: string[][];
};

// ── Refusals decided without the model ─────────────────────────────────────

const SUGGESTION =
  'The data can show modelled residents by age band for a state, an LGA or the area around a board, population density, the affluence index and its parts, mapped places, state wealth fifths from the DHS survey, and which segment an LGA falls in.';

const UNSUPPORTED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(traffic|vehicles?|cars? per|footfall|foot fall|pedestrians?|commuters?|passers?-?by)\b/i, reason: 'This system holds no traffic, vehicle or pedestrian counts.' },
  { pattern: /\bdwell(ing)? ?time\b|\bhow long (do|does) (people|drivers|they)\b/i, reason: 'This system holds no dwell-time data.' },
  { pattern: /\b(reach|impressions?|opportunit(y|ies) to see|ots|eyeballs|viewers?|audience (size|delivered|delivery)|grps?|cpm)\b/i, reason: 'This system does not measure reach, impressions or audience delivery. It only models how many people live near a place.' },
  { pattern: /\b(brand (affinity|preference|loyalty|awareness)|favou?rite brands?|prefer(s|red)? (brand|to buy))\b/i, reason: 'This system holds no brand affinity or preference data.' },
  { pattern: /\b(income|salar(y|ies)|earnings?|wages?|purchasing power|spending power|disposable|gdp)\b|₦|\bnaira\b/i, reason: 'This system holds no income or spending figures in naira. Its wealth measures are a survey asset index by state and a rank-based affluence index, neither of which is money.' },
  { pattern: /\b(sales|revenue|turnover|conversions?|roi|return on)\b/i, reason: 'This system holds no sales or campaign-outcome data.' },
];

export function detectUnsupported(question: string): { reason: string; suggestion: string } | null {
  const hit = UNSUPPORTED.find(u => u.pattern.test(question));
  return hit ? { reason: hit.reason, suggestion: SUGGESTION } : null;
}

// ── Post-check ─────────────────────────────────────────────────────────────

/** Every number written in a text, canonicalised ("5,516,818" and "5516818.0" compare equal). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => String(parseFloat(n.replace(/,/g, ''))));
}

// Wording the product forbids in an answer: measurement claims the data cannot back, and
// descriptive adjectives about places. Segment names ("High value", "Youth hub", "Mass market") are allowed.
const FORBIDDEN_WORDS = /\b(reach(es|ed)?|impressions?|traffic|footfall|audience delivered|dwell|vibrant|affluent|wealthy|rich|poor|upscale|bustling|thriving|booming|prosperous|lucrative|prime|premium|trendy|elite|hotspots?)\b/i;

/**
 * Returns every reason the answer may not be shown. An empty list means it passed.
 * `toolText` is the exact text of every tool result the model was given.
 */
export function checkAnswer(answer: ModelAnswer, ledger: Figure[], toolText: string, question: string): string[] {
  const violations: string[] = [];
  const allowed = new Set([...numbersIn(toolText), ...numbersIn(question)]);

  if (answer.status === 'cannot_answer') {
    if (!answer.cannot_answer_reason.trim()) violations.push('A cannot_answer response must explain why.');
    for (const n of numbersIn(`${answer.cannot_answer_reason} ${answer.suggestion}`)) {
      if (!allowed.has(n)) violations.push(`The number ${n} does not appear in any tool result.`);
    }
    return violations;
  }

  if (answer.statements.length === 0) violations.push('An answered response needs at least one statement.');
  if (ledger.length === 0) violations.push('No tool returned any figure, so nothing can be stated. Use cannot_answer.');

  for (const [i, statement] of answer.statements.entries()) {
    const where = `Statement ${i + 1}`;
    const written = numbersIn(statement.text);
    for (const n of written) {
      if (!allowed.has(n)) violations.push(`${where}: the number ${n} does not appear in any tool result. Use only the "display" text of returned figures.`);
    }
    if (written.length > 0 && statement.citations.length === 0) {
      violations.push(`${where}: contains a figure but cites nothing.`);
    }
    for (const c of statement.citations) {
      const match = ledger.find(f => f.metric === c.metric && f.geography === c.geography && f.dataset_id === c.dataset_id);
      if (!match) {
        violations.push(`${where}: no tool returned ${c.metric} for "${c.geography}" from ${c.dataset_id}.`);
      } else if (Math.abs(match.value - c.value) > Math.abs(match.value) * 1e-9 + 1e-9) {
        violations.push(`${where}: cites ${c.metric} for "${c.geography}" as ${c.value}, but the tool returned ${match.value}.`);
      }
    }
    const word = statement.text.match(FORBIDDEN_WORDS);
    if (word) violations.push(`${where}: the word "${word[0]}" is not allowed. State the figure and the rule; do not characterise the place or imply measured exposure.`);
  }
  return violations;
}

// ── The conversation with the model ────────────────────────────────────────

export const ASK_SYSTEM = `You answer questions about Nigerian market data for an out-of-home advertising planner. You are an interface to a fixed set of computed tables. You have no other knowledge source and must not use anything you remember about Nigeria, its places or its people.

How to work:
- Call the tools to get figures. Every number you write must be the "display" text of a figure a tool returned in this conversation, copied exactly. Never calculate, round, estimate, convert, total or compare by arithmetic yourself; if you need a figure the tools did not return, call another tool or say the data cannot answer.
- Each statement lists in "citations" the figures it uses, with metric, value, geography and dataset_id copied exactly from the tool result.
- Population figures are modelled residents, not census counts and not people who see a board. Say "residents" and "modelled". Never write about reach, impressions, traffic, footfall or audience delivered.
- Do not describe places with adjectives. The only labels you may apply to a place are the segment names "High value", "Youth hub" and "Mass market", and only when a tool returned that segment for it; when you use one, state its rule as the tool gave it.
- If the tools cannot support an answer, set status to "cannot_answer", explain plainly in cannot_answer_reason, and put what the data can say instead in suggestion. Do not guess.
- Be brief: a few plain statements. Do not state reference years; the system attaches them.`;

export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'statements', 'cannot_answer_reason', 'suggestion'],
  properties: {
    status: { type: 'string', enum: ['answered', 'cannot_answer'] },
    statements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citations'],
        properties: {
          text: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['metric', 'value', 'geography', 'dataset_id'],
              properties: {
                metric: { type: 'string' },
                value: { type: 'number' },
                geography: { type: 'string' },
                dataset_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
    cannot_answer_reason: { type: 'string' },
    suggestion: { type: 'string' },
  },
} as const;

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
export type ExecuteTool = (name: string, input: unknown) => Promise<ToolResult>;

function parseAnswer(message: Anthropic.Message): ModelAnswer | null {
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  try {
    const parsed = JSON.parse(text) as ModelAnswer;
    if ((parsed.status !== 'answered' && parsed.status !== 'cannot_answer') || !Array.isArray(parsed.statements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function runAsk(options: {
  question: string;
  tools: Anthropic.Tool[];
  createMessage: CreateMessage;
  executeTool: ExecuteTool;
}): Promise<AskResult> {
  const { question, tools, createMessage, executeTool } = options;
  const result: AskResult = { status: 'error', statements: [], reason: '', suggestion: '', sources: [], tool_calls: [], attempts: 0, rejected: [] };

  const unsupported = detectUnsupported(question);
  if (unsupported) return { ...result, status: 'refused', reason: unsupported.reason, suggestion: unsupported.suggestion };

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];
  const ledger: Figure[] = [];
  let toolText = '';
  let toolRounds = 0;

  while (result.attempts < MAX_ATTEMPTS) {
    const response = await createMessage({
      model: ASK_MODEL,
      max_tokens: 4000,
      system: ASK_SYSTEM,
      tools,
      messages,
      // This model rejects temperature and other sampling parameters; low effort is the
      // closest control, and correctness rests on the post-check below, not on sampling.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
    });

    if (response.stop_reason === 'tool_use') {
      if (++toolRounds > MAX_TOOL_ROUNDS) return { ...result, status: 'unverifiable', reason: 'The question needed more lookups than allowed. Try a narrower question.' };
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const output = await executeTool(block.name, block.input);
        const text = JSON.stringify(output);
        ledger.push(...output.figures);
        toolText += ` ${text}`;
        result.tool_calls.push({ name: block.name, input: block.input, figures: output.figures.length, ...(output.error ? { error: output.error } : {}) });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: text, ...(output.error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'refusal') {
      return { ...result, status: 'cannot_answer', reason: 'The model declined to answer this question.', suggestion: SUGGESTION };
    }

    result.attempts++;
    const answer = response.stop_reason === 'end_turn' ? parseAnswer(response) : null;
    const violations = answer ? checkAnswer(answer, ledger, toolText, question) : ['The response was not a complete answer in the required structure.'];

    if (answer && violations.length === 0) {
      if (answer.status === 'cannot_answer') {
        return { ...result, status: 'cannot_answer', reason: answer.cannot_answer_reason, suggestion: answer.suggestion || SUGGESTION };
      }
      const statements = answer.statements.map(s => ({
        ...s,
        figures: s.citations.map(c => ledger.find(f => f.metric === c.metric && f.geography === c.geography && f.dataset_id === c.dataset_id)!),
      }));
      const sources = new Map<string, string>();
      for (const s of statements) for (const f of s.figures) sources.set(f.dataset_id, f.reference_year);
      return { ...result, status: 'answered', statements, sources: [...sources].map(([dataset_id, reference_year]) => ({ dataset_id, reference_year })) };
    }

    // Rejected: keep the violations for the audit log and ask for another attempt.
    result.rejected.push(violations);
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: `That answer was rejected by the server and was not shown to the user:\n- ${violations.join('\n- ')}\nAnswer again. Use only figures the tools returned, copied exactly, or call a tool for what is missing, or use cannot_answer.`,
    });
  }

  return { ...result, status: 'unverifiable', reason: 'No answer could be produced that passed the checks against the source data, so nothing is shown.', suggestion: SUGGESTION };
}
