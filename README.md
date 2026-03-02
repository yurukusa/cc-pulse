# cc-pulse

> What's the rhythm of a Claude Code session?

Analyzes the time gaps between consecutive events within sessions. Shows whether Claude Code runs in continuous bursts or fragmented cycles.

## Usage

```bash
npx cc-pulse
npx cc-pulse --json
```

Or open `index.html` in a browser and drag in `.jsonl` files.

## Metrics

- **Gap distribution** — instant (<2s) / quick (2–15s) / normal (15–60s) / slow (60–300s) / paused (300s+)
- **Median gap** — typical time between consecutive events
- **Session rhythm** — flow (continuous) / mixed / cyclic (human-in-the-loop)

## Sample output

```
cc-pulse — What's the rhythm of a Claude Code session?

Sessions analyzed: 521  (886,877 total intra-session gaps)

Gap distribution
  instant  81%  (715,580)  <2s      — rapid-fire execution
  quick    17%  (153,327)  2–15s    — normal tool sequence
  normal    1%   (12,849)  15–60s   — brief deliberation
  slow      0%    (4,142)  60–300s  — user reviewing / CC thinking
  paused    0%      (979)  300s+    — long wait (user away?)

Timing
  median gap   1s  — typical time between events
  mean gap     1s

Session rhythm
  flow    100%  (521)  >50% instant/quick — continuous execution burst

98% of all events fire within 15s of each other.
Median gap: 1s. Claude Code runs in near-continuous bursts.
Long pauses (300s+): 979 gaps (0.1%) — user check-ins are rare.
```

## License

MIT
