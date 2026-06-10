import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32, pick } from './rng.js';
import { makeEntity, SCENARIOS, type SignalMap } from './signals.js';
import { MATCHERS, linked, CONFIRMED_THRESHOLD, type Matcher } from './matchers.js';

const SEED = 0x5ce7; // fixed → reproducible
const POPULATION = 5000; // distinct synthetic entities
const FALSE_MERGE_PAIRS = 20000; // random distinct-entity pairs for the FMR test

interface Cell {
  linked: number; // re-identified (matcher's link rule)
  confirmed: number; // Scent only: score ≥ 0.85
  scoreSum: number; // Scent only: for mean confidence
  total: number;
}
type Table = Record<string, Record<string, Cell>>; // matcher -> scenario -> cell

const cell = (): Cell => ({ linked: 0, confirmed: 0, scoreSum: 0, total: 0 });
const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const mean = (sum: number, d: number): number => (d === 0 ? 0 : Math.round((sum / d) * 100) / 100);

function record(c: Cell, m: Matcher, before: SignalMap, after: SignalMap): void {
  const s = m.score(before, after);
  c.total++;
  c.scoreSum += s;
  if (linked(m, s)) c.linked++;
  if (s >= CONFIRMED_THRESHOLD) c.confirmed++;
}

function run(): void {
  const rng = mulberry32(SEED);

  const entities: SignalMap[] = [];
  for (let i = 0; i < POPULATION; i++) entities.push(makeEntity(rng));

  // ── Recall: each entity returns once per scenario; was it re-linked?
  const recall: Table = {};
  for (const m of MATCHERS) {
    recall[m.name] = {};
    for (const s of SCENARIOS) recall[m.name]![s.key] = cell();
  }
  for (const base of entities) {
    for (const scenario of SCENARIOS) {
      const ret = scenario.apply(base, rng);
      for (const m of MATCHERS) record(recall[m.name]![scenario.key]!, m, base, ret);
    }
  }

  // ── False-merge rate: random pairs of DISTINCT entities should NOT link.
  const fmr: Record<string, Cell> = {};
  for (const m of MATCHERS) fmr[m.name] = cell();
  for (let i = 0; i < FALSE_MERGE_PAIRS; i++) {
    const a = pick(rng, entities);
    let b = pick(rng, entities);
    while (b === a) b = pick(rng, entities);
    for (const m of MATCHERS) record(fmr[m.name]!, m, a, b);
  }

  printReport(recall, fmr);
  writeResults(recall, fmr);
}

function weightedOverall(byScenario: Record<string, Cell>, field: 'linked' | 'confirmed'): number {
  let num = 0;
  let den = 0;
  for (const s of SCENARIOS) {
    const c = byScenario[s.key]!;
    num += (c.total ? c[field] / c.total : 0) * s.weight;
    den += s.weight;
  }
  return Math.round((num / den) * 1000) / 10;
}

function printReport(recall: Table, fmr: Record<string, Cell>): void {
  console.log(`\nScent accuracy benchmark — seed 0x${SEED.toString(16)}, ${POPULATION} entities\n`);
  console.log('Re-identification recall (% of drifted returns re-linked):\n');
  for (const m of MATCHERS) {
    console.log(`${m.name}`);
    for (const s of SCENARIOS) {
      const c = recall[m.name]![s.key]!;
      console.log(`  ${s.label.padEnd(52)} ${String(pct(c.linked, c.total)).padStart(5)}%`);
    }
    console.log(`  ${'→ weighted overall'.padEnd(52)} ${String(weightedOverall(recall[m.name]!, 'linked')).padStart(5)}%`);
    console.log(`  ${'→ false-merge rate'.padEnd(52)} ${String(pct(fmr[m.name]!.linked, fmr[m.name]!.total)).padStart(5)}%\n`);
  }
  // Scent's graded confidence — the real engine output behind the recall number.
  console.log('Scent confidence gradient (mean confidence · % confirmed @≥0.85 · % probable @≥0.60):\n');
  for (const s of SCENARIOS) {
    const c = recall['Scent']![s.key]!;
    console.log(
      `  ${s.label.padEnd(52)} ${mean(c.scoreSum, c.total).toFixed(2)}  ${String(pct(c.confirmed, c.total)).padStart(5)}%  ${String(pct(c.linked, c.total)).padStart(5)}%`,
    );
  }
  console.log();
}

function writeResults(recall: Table, fmr: Record<string, Cell>): void {
  const L: string[] = [];
  L.push('# Scent accuracy benchmark — results');
  L.push('');
  L.push('> **Generated artifact.** Run `pnpm bench` to regenerate. Fully deterministic');
  L.push(`> (seed \`0x${SEED.toString(16)}\`, ${POPULATION} entities, ${FALSE_MERGE_PAIRS} false-merge pairs). See [\`README.md\`](./README.md) for methodology and limits.`);
  L.push('');
  L.push('## What this measures');
  L.push('');
  L.push('Identity **continuity** under real-world signal drift. All three matchers see');
  L.push("the **same** synthetic signal vectors (Scent's real taxonomy, `docs/signals.md`)");
  L.push('— the only variable is the matching algorithm. FingerprintJS (OSS) and');
  L.push('ThumbmarkJS hash a fixed component set and re-identify a visitor **iff that hash');
  L.push('is byte-for-byte identical**; Scent runs its real production engine');
  L.push('(`weightedJaccard` → `scoreToIdentityContinuity`).');
  L.push('');
  L.push('## Re-identification recall');
  L.push('');
  L.push('% of drifted return visits correctly re-linked to the original entity');
  L.push('(deterministic libs: exact-hash match; Scent: continuity ≥ `probable`, score ≥ 0.60).');
  L.push('');
  const head = ['Scenario', ...MATCHERS.map((m) => m.name)];
  L.push(`| ${head.join(' | ')} |`);
  L.push(`| ${head.map(() => '---').join(' | ')} |`);
  for (const s of SCENARIOS) {
    L.push(`| ${[s.label, ...MATCHERS.map((m) => `${pct(recall[m.name]![s.key]!.linked, recall[m.name]![s.key]!.total)}%`)].join(' | ')} |`);
  }
  L.push(`| ${['**Weighted overall**', ...MATCHERS.map((m) => `**${weightedOverall(recall[m.name]!, 'linked')}%**`)].join(' | ')} |`);
  L.push('');
  L.push('## Scent confidence gradient');
  L.push('');
  L.push('The single recall number hides what makes Scent different: a **graded,');
  L.push('explainable** confidence, not a yes/no. The deterministic libraries have no');
  L.push('equivalent — they are binary. Below, `probable` (≥0.60) is the link threshold');
  L.push('above; `confirmed` (≥0.85) is the high-trust band. Watch confidence degrade');
  L.push('honestly with drift while continuity is preserved.');
  L.push('');
  L.push('| Scenario | Mean confidence | % confirmed (≥0.85) | % probable+ (≥0.60) |');
  L.push('| --- | --- | --- | --- |');
  for (const s of SCENARIOS) {
    const c = recall['Scent']![s.key]!;
    L.push(`| ${s.label} | ${mean(c.scoreSum, c.total).toFixed(2)} | ${pct(c.confirmed, c.total)}% | ${pct(c.linked, c.total)}% |`);
  }
  L.push('');
  L.push('## False-merge rate');
  L.push('');
  L.push('% of random pairs of **distinct** entities a matcher wrongly links. Lower is');
  L.push('better. Deterministic hashes essentially never collide (perfect precision);');
  L.push("Scent trades a small, **quantified** false-merge rate for the recall gains");
  L.push('above. Reporting it is the difference between a benchmark and a brochure.');
  L.push('');
  L.push('| Matcher | False-merge rate |');
  L.push('| --- | --- |');
  for (const m of MATCHERS) L.push(`| ${m.name} | ${pct(fmr[m.name]!.linked, fmr[m.name]!.total)}% |`);
  L.push('');
  L.push('## How to read this');
  L.push('');
  L.push('- **Deterministic libraries** are perfect on `same_session` / `minor` (the');
  L.push("  changed signals aren't hashed) and **collapse to ~0%** the instant a hashed");
  L.push('  component changes — a browser update, an anti-fingerprinting browser, or (for');
  L.push('  FingerprintJS) a new monitor or VPN-driven timezone shift. ThumbmarkJS survives');
  L.push('  the new monitor only because it drops screen geometry from its hash.');
  L.push('- **Scent** preserves continuity through every one of those because a few changed');
  L.push('  signals do not flip a probabilistic score below threshold — and it reports *how');
  L.push('  sure* it is, degrading confidence gracefully rather than declaring a stranger.');
  L.push('');

  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'RESULTS.md');
  writeFileSync(out, L.join('\n'));
  console.log(`Wrote ${out}`);
}

run();
