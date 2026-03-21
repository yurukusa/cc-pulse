#!/usr/bin/env node
/**
 * cc-pulse — What's the rhythm of a Claude Code session?
 * Analyzes gaps between consecutive events within sessions.
 * Shows whether work is continuous flow, cyclic, or fragmented.
 */

import { readdirSync } from 'fs';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const showHelp = args.includes('--help') || args.includes('-h');

if (showHelp) {
  process.stdout.write(`cc-pulse — What's the rhythm of a Claude Code session?

Usage:
  npx cc-pulse          # Intra-session timing gap analysis
  npx cc-pulse --json   # JSON output

Metrics:
  - Gap distribution: instant (<2s) / quick (2–15s) / normal (15–60s) / slow (60–300s) / paused (300s+)
  - Median gap between consecutive events
  - Flow sessions: continuous rhythm (>50% instant/quick gaps)
  - Cycle sessions: human-in-the-loop rhythm (dominant 15–120s gaps)
`);
  process.exit(0);
}

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', purple: '\x1b[35m', red: '\x1b[31m',
  orange: '\x1b[38;5;208m',
};

function bar(pct, width = 22) {
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmt(n) { return Math.round(n).toLocaleString(); }
function fmtSec(s) {
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`;
  if (s >= 60) return `${Math.round(s / 60)}min`;
  return `${Math.round(s)}s`;
}

const claudeDir = join(homedir(), '.claude', 'projects');

// Gap thresholds in seconds
const INSTANT = 2;
const QUICK   = 15;
const NORMAL  = 60;
const SLOW    = 300;
// > SLOW = paused (likely user went away)
// > 1800s (30 min) = session break, excluded

async function processFile(filePath) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });

    const timestamps = [];

    rl.on('line', (line) => {
      if (!line) return;
      let d;
      try { d = JSON.parse(line); } catch { return; }
      if (d.timestamp) {
        const t = new Date(d.timestamp).getTime();
        if (!isNaN(t)) timestamps.push(t);
      }
    });

    rl.on('close', () => {
      if (timestamps.length < 3) { resolve(null); return; }
      timestamps.sort((a, b) => a - b);

      const gaps = []; // in seconds
      for (let i = 1; i < timestamps.length; i++) {
        const gap = (timestamps[i] - timestamps[i - 1]) / 1000;
        if (gap > 0 && gap <= 1800) { // exclude session breaks > 30min
          gaps.push(gap);
        }
      }

      if (gaps.length < 2) { resolve(null); return; }

      const instant = gaps.filter(g => g < INSTANT).length;
      const quick   = gaps.filter(g => g >= INSTANT && g < QUICK).length;
      const normal  = gaps.filter(g => g >= QUICK   && g < NORMAL).length;
      const slow    = gaps.filter(g => g >= NORMAL  && g < SLOW).length;
      const paused  = gaps.filter(g => g >= SLOW).length;

      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      // Classify session rhythm
      const flowPct = (instant + quick) / gaps.length;
      const pausePct = (slow + paused) / gaps.length;
      let rhythm;
      if (flowPct >= 0.5) rhythm = 'flow';        // mostly continuous
      else if (pausePct >= 0.3) rhythm = 'cyclic'; // lots of wait time
      else rhythm = 'mixed';

      resolve({ gaps: gaps.length, instant, quick, normal, slow, paused, median, rhythm });
    });
  });
}

async function main() {
  let projectDirs;
  try {
    projectDirs = readdirSync(claudeDir);
  } catch {
    process.stderr.write(`Cannot read ${claudeDir}\n`);
    process.exit(1);
  }

  const allFiles = [];
  for (const pd of projectDirs) {
    const pdPath = join(claudeDir, pd);
    try {
      const files = readdirSync(pdPath).filter(f => f.endsWith('.jsonl'));
      for (const f of files) allFiles.push(join(pdPath, f));
    } catch {}
  }

  const sessions = [];
  const BATCH = 16;
  for (let i = 0; i < allFiles.length; i += BATCH) {
    const batch = allFiles.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(f => processFile(f)));
    for (const r of results) {
      if (r) sessions.push(r);
    }
  }

  if (sessions.length === 0) {
    process.stderr.write('No sessions found.\n');
    process.exit(1);
  }

  const n = sessions.length;
  const totalGaps = sessions.reduce((a, s) => a + s.gaps, 0);

  // Aggregate gap counts
  const totInstant = sessions.reduce((a, s) => a + s.instant, 0);
  const totQuick   = sessions.reduce((a, s) => a + s.quick, 0);
  const totNormal  = sessions.reduce((a, s) => a + s.normal, 0);
  const totSlow    = sessions.reduce((a, s) => a + s.slow, 0);
  const totPaused  = sessions.reduce((a, s) => a + s.paused, 0);

  // Median gap (weighted median approximation: use session medians)
  const medians = sessions.map(s => s.median).sort((a, b) => a - b);
  const overallMedian = medians[Math.floor(n / 2)];
  const overallMean = sessions.reduce((a, s) => a + s.median, 0) / n;

  // Rhythm classification
  const flowSessions   = sessions.filter(s => s.rhythm === 'flow').length;
  const cyclicSessions = sessions.filter(s => s.rhythm === 'cyclic').length;
  const mixedSessions  = sessions.filter(s => s.rhythm === 'mixed').length;

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      sessionsAnalyzed: n,
      totalGaps,
      gapDistribution: {
        instant: totInstant,
        quick: totQuick,
        normal: totNormal,
        slow: totSlow,
        paused: totPaused,
      },
      medianGapSec: Math.round(overallMedian),
      rhythm: { flow: flowSessions, cyclic: cyclicSessions, mixed: mixedSessions },
    }, null, 2) + '\n');
    return;
  }

  // ── Pretty output ──────────────────────────────────────────────────────────
  process.stdout.write(`\n${C.bold}${C.cyan}cc-pulse${C.reset} — What's the rhythm of a Claude Code session?\n\n`);
  process.stdout.write(`${C.bold}Sessions analyzed:${C.reset} ${n.toLocaleString()}  ${C.dim}(${fmt(totalGaps)} total intra-session gaps)${C.reset}\n\n`);

  // Gap distribution
  process.stdout.write(`${C.bold}Gap distribution${C.reset}  ${C.dim}(time between consecutive events, excluding >30min breaks)${C.reset}\n`);
  const gaps = [
    ['instant', totInstant, C.green,  `<${INSTANT}s      — rapid-fire execution`],
    ['quick  ', totQuick,   C.blue,   `${INSTANT}–${QUICK}s    — normal tool sequence`],
    ['normal ', totNormal,  C.yellow, `${QUICK}–${NORMAL}s   — brief deliberation`],
    ['slow   ', totSlow,    C.orange, `${NORMAL}–${SLOW}s  — user reviewing / CC thinking`],
    ['paused ', totPaused,  C.purple, `${SLOW}s+     — long wait (user away?)`],
  ];
  for (const [label, count, color, desc] of gaps) {
    const pct = count / totalGaps;
    process.stdout.write(
      `  ${label}  ${color}${bar(pct, 22)}${C.reset}  ${C.bold}${(pct * 100).toFixed(0).padStart(3)}%${C.reset}  ${C.dim}(${fmt(count)})  ${desc}${C.reset}\n`
    );
  }
  process.stdout.write('\n');

  // Median gap
  process.stdout.write(`${C.bold}Timing${C.reset}\n`);
  process.stdout.write(`  median gap   ${C.bold}${C.green}${fmtSec(overallMedian)}${C.reset}  — typical time between events\n`);
  process.stdout.write(`  mean gap     ${C.bold}${fmtSec(overallMean)}${C.reset}  — (pulled higher by slow/paused)\n\n`);

  // Rhythm classification
  process.stdout.write(`${C.bold}Session rhythm${C.reset}\n`);
  const rhythms = [
    ['flow  ', flowSessions,   C.green,  '>50% instant/quick — continuous execution burst'],
    ['mixed ', mixedSessions,  C.blue,   'balanced mix of fast and deliberate'],
    ['cyclic', cyclicSessions, C.purple, '>30% slow/paused — human-in-the-loop pattern'],
  ];
  for (const [label, count, color, desc] of rhythms) {
    const pct = count / n;
    process.stdout.write(
      `  ${label}  ${color}${bar(pct, 22)}${C.reset}  ${C.bold}${(pct * 100).toFixed(0).padStart(3)}%${C.reset}  ${C.dim}(${count})  ${desc}${C.reset}\n`
    );
  }
  process.stdout.write('\n');

  // Insight
  process.stdout.write(`${C.dim}─────────────────────────────────────────────${C.reset}\n`);
  const fastPct = Math.round((totInstant + totQuick) / totalGaps * 100);
  const pausedPct = (totPaused / totalGaps * 100).toFixed(1);
  process.stdout.write(`${C.bold}${C.cyan}${fastPct}% of all events fire within ${QUICK}s of each other.${C.reset}\n`);
  process.stdout.write(`${C.dim}Median gap: ${fmtSec(overallMedian)}. Claude Code runs in near-continuous bursts.\n`);
  process.stdout.write(`Long pauses (300s+): ${fmt(totPaused)} gaps (${pausedPct}%) — user check-ins are rare\n`);
  process.stdout.write(`relative to the total event stream.${C.reset}\n\n`);

  process.stdout.write(`  ${C.dim}Running Claude Code autonomously? Check your safety score:${C.reset}\n`);
  process.stdout.write(`  ${C.dim}npx cc-health-check${C.reset}\n`);
  process.stdout.write(`  ${C.dim}Full production kit: https://yurukusa.github.io/cc-ops-kit-landing/?utm_source=npm&utm_medium=cli&utm_campaign=ops-kit${C.reset}\n\n`);
}

main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
