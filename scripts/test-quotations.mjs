// Unit tests for src/lib/quotations.ts (run: node scripts/test-quotations.mjs).
// Node 24 strips the TypeScript types itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sellMonthly, costMonthly, lineTotals, quoteTotals, quoteProblems, monthsBetween } from '../src/lib/quotations.ts';

test('selling price per pricing mode', () => {
  assert.equal(sellMonthly(1_000_000, 'markup_percent', 20), 1_200_000);
  assert.equal(sellMonthly(1_000_000, 'markup_fixed', 150_000), 1_150_000);
  assert.equal(sellMonthly(1_000_000, 'manual', 1_400_000), 1_400_000);
  assert.equal(sellMonthly(1_000_000, 'commission', 15), 1_000_000);
  assert.equal(sellMonthly(333_333, 'markup_percent', 10), 366_666.3);
});

test('owner cost: commission is taken from the owner, markups are not', () => {
  assert.equal(costMonthly(1_000_000, 'commission', 15), 850_000);
  assert.equal(costMonthly(1_000_000, 'markup_percent', 20), 1_000_000);
  assert.equal(costMonthly(1_000_000, 'manual', 900_000), 1_000_000);
});

test('board line multiplies by months', () => {
  assert.deepEqual(lineTotals({ kind: 'board', owner_net_monthly: 500_000, pricing_mode: 'markup_percent', pricing_value: 20, months: 3 }),
    { unit: 600_000, total: 1_800_000, cost: 1_500_000 });
});

test('multi-board quote with extras, discount and VAT', () => {
  const t = quoteTotals([
    { kind: 'board', owner_net_monthly: 1_000_000, pricing_mode: 'markup_percent', pricing_value: 20, months: 2 }, // 2.4M sell, 2M cost
    { kind: 'board', owner_net_monthly: 800_000, pricing_mode: 'commission', pricing_value: 10, months: 1 },       // 0.8M sell, 0.72M cost
    { kind: 'printing', amount: 300_000, cost: 250_000 },
    { kind: 'installation', amount: 100_000, cost: 100_000 },
    { kind: 'discount', amount: 100_000 },
  ], 7.5);
  assert.equal(t.subtotal, 3_600_000);
  assert.equal(t.discount, 100_000);
  assert.equal(t.vat, 262_500);            // 7.5% of 3.5M
  assert.equal(t.total, 3_762_500);
  assert.equal(t.ownerCost, 3_070_000);
  assert.equal(t.revenue, 430_000);        // 3.5M − 3.07M
  assert.equal(t.marginPct, 12.29);
});

test('selling below cost shows a negative revenue, not an error', () => {
  const t = quoteTotals([{ kind: 'board', owner_net_monthly: 1_000_000, pricing_mode: 'manual', pricing_value: 900_000, months: 1 }], 0);
  assert.equal(t.revenue, -100_000);
});

test('problems: missing owner price, markup and boards', () => {
  assert.deepEqual(quoteProblems([]), ['Add at least one board.']);
  const p = quoteProblems([{ kind: 'board', owner_net_monthly: 0, pricing_mode: 'markup_percent', pricing_value: null, months: 1 }]);
  assert.ok(p.some(x => x.includes("owner's price")));
  assert.ok(p.some(x => x.includes('markup')));
  assert.ok(quoteProblems([{ kind: 'board', owner_net_monthly: 1, pricing_mode: 'commission', pricing_value: 100, months: 1 }]).some(x => x.includes('commission')));
  assert.deepEqual(quoteProblems([{ kind: 'board', owner_net_monthly: 1, pricing_mode: 'markup_percent', pricing_value: 0, months: 1 }]), []);
});

test('months between dates', () => {
  assert.equal(monthsBetween('2026-12-01', '2026-12-31'), 1);
  assert.equal(monthsBetween('2026-12-01', '2027-02-28'), 3);
  assert.equal(monthsBetween('2026-12-01', '2026-12-10'), 1);
  assert.equal(monthsBetween(null, null), 1);
});
