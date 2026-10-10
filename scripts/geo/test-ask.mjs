/**
 * Tests for "Ask the map" that need no model and no API key.
 * Usage: node scripts/geo/test-ask.mjs
 *
 * The real engine (src/lib/geo/ask-core.ts) is run with a SCRIPTED stand-in
 * for the model, so the server-side rules can be proven deterministically:
 * unsupported questions are refused before any model call, and an answer
 * containing an invented figure is rejected and never returned.
 */

import { runAsk, detectUnsupported } from '../../src/lib/geo/ask-core.ts';

const LAGOS = {
  metric: 'pop_15_34', label: 'Residents aged 15-34 (modelled)', geography: 'Lagos State', value: 5516818.4,
  display: '5,516,818', unit: 'people', dataset_id: 'worldpop_agesex_2020_constrained', reference_year: '2020',
};
const executeTool = async () => ({ figures: [LAGOS], notes: ['1 areas matched; showing 1, highest first.'] });

const toolCall = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'get_state_profile', input: { state: 'Lagos' } }] };
const final = answer => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] });
const cite = (overrides = {}) => ({ metric: LAGOS.metric, value: LAGOS.value, geography: LAGOS.geography, dataset_id: LAGOS.dataset_id, ...overrides });
const answered = (text, citations = [cite()]) => final({ status: 'answered', statements: [{ text, citations }], cannot_answer_reason: '', suggestion: '' });

/** A model that replies with the given responses in order, and counts how often it is called. */
function scripted(responses) {
  let calls = 0;
  const createMessage = async () => { const r = responses[Math.min(calls, responses.length - 1)]; calls++; return r; };
  return { createMessage, calls: () => calls };
}

let failed = 0;
function expect(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
  if (!condition) failed++;
}

console.log('── Refusals (decided before any model call) ──');
const REFUSED = [
  'How much traffic passes Ikeja under bridge each day?',
  'What is the dwell time at Lekki toll gate?',
  'What daily reach would a board in Kano get?',
  'How many impressions will this campaign deliver?',
  'Which state has the strongest brand affinity for MTN?',
  'What is the average income in naira in Abuja?',
  'What sales uplift can I expect in Port Harcourt?',
];
for (const question of REFUSED) {
  const model = scripted([answered('should never be used')]);
  const result = await runAsk({ question, tools: [], createMessage: model.createMessage, executeTool });
  expect(`refused: "${question}"`, result.status === 'refused' && model.calls() === 0 && result.statements.length === 0, result.reason);
}
const SUPPORTED = ['Which LGAs in Lagos have the most residents aged 15-34?', 'Compare Lagos and Kano', 'Which LGAs in Kano are Mass market?'];
for (const question of SUPPORTED) expect(`not refused: "${question}"`, detectUnsupported(question) === null);

console.log('\n── Numeric post-check ──');
{
  const model = scripted([toolCall, answered('Lagos State has about 6.2 million modelled residents aged 15-34.'), answered('Lagos State has 5,516,818 modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'How many young people live in Lagos?', tools: [], createMessage: model.createMessage, executeTool });
  expect('invented figure (6.2 million) is rejected, corrected answer is accepted',
    r.status === 'answered' && r.rejected.length === 1 && r.statements[0].text.includes('5,516,818') && !JSON.stringify(r.statements).includes('6.2'),
    `rejected draft because: ${r.rejected[0]?.join(' | ')}`);
  expect('accepted answer carries the dataset and its reference year from the tool result', r.sources.length === 1 && r.sources[0].reference_year === '2020' && r.statements[0].figures[0].dataset_id === LAGOS.dataset_id);
}
{
  const model = scripted([toolCall, answered('Lagos State has about 6.2 million modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'How many young people live in Lagos?', tools: [], createMessage: model.createMessage, executeTool });
  expect('a model that keeps inventing the figure is never shown: status "unverifiable", no statements',
    r.status === 'unverifiable' && r.statements.length === 0 && r.rejected.length === 3, `attempts: ${r.attempts}`);
}
{
  const model = scripted([toolCall, answered('Lagos State has 5,516,818 modelled residents aged 15-34.', [cite({ value: 6200000 })]), answered('Lagos State has 5,516,818 modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'Lagos youth?', tools: [], createMessage: model.createMessage, executeTool });
  expect('citation whose value differs from the tool result is rejected', r.rejected.length === 1 && /cites pop_15_34/.test(r.rejected[0].join(' ')), r.rejected[0]?.join(' | '));
}
{
  const model = scripted([toolCall, answered('Lagos State has 5,516,818 modelled residents aged 15-34.', [cite({ geography: 'Kano State' })]), answered('Lagos State has 5,516,818 modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'Lagos youth?', tools: [], createMessage: model.createMessage, executeTool });
  expect('citation for a geography no tool returned is rejected', r.rejected.length === 1 && /no tool returned/.test(r.rejected[0].join(' ')), r.rejected[0]?.join(' | '));
}
{
  const model = scripted([answered('Nigeria has 220,000,000 people.', [])]);
  const r = await runAsk({ question: 'How many people live in Nigeria?', tools: [], createMessage: model.createMessage, executeTool });
  expect('a figure recalled without calling any tool is rejected', r.status === 'unverifiable' && r.statements.length === 0, r.rejected[0]?.join(' | '));
}
{
  const model = scripted([toolCall, answered('Lagos is a vibrant, affluent market with 5,516,818 modelled residents aged 15-34.'), answered('Lagos State has 5,516,818 modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'Describe Lagos youth', tools: [], createMessage: model.createMessage, executeTool });
  expect('descriptive adjectives ("vibrant", "affluent") are rejected', r.rejected.length === 1 && /not allowed/.test(r.rejected[0].join(' ')), r.rejected[0]?.join(' | '));
}
{
  const model = scripted([toolCall, answered('A board here would reach 5,516,818 people.'), answered('Lagos State has 5,516,818 modelled residents aged 15-34.')]);
  const r = await runAsk({ question: 'Lagos youth?', tools: [], createMessage: model.createMessage, executeTool });
  expect('"reach" wording is rejected', r.rejected.length === 1 && /"reach"/.test(r.rejected[0].join(' ')), r.rejected[0]?.join(' | '));
}
{
  const model = scripted([toolCall, final({ status: 'cannot_answer', statements: [], cannot_answer_reason: 'The tables hold no figure for that.', suggestion: 'Ask for modelled residents by age band.' })]);
  const r = await runAsk({ question: 'What is the literacy rate in Lagos?', tools: [], createMessage: model.createMessage, executeTool });
  expect('a "cannot answer" from the model passes through with its explanation', r.status === 'cannot_answer' && r.reason.length > 0 && r.statements.length === 0);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll passed.');
process.exit(failed ? 1 : 0);

