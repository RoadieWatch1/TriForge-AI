# Shadow Trading System — Operator Runbook

## Overview

This runbook provides evaluation checklists and decision rules for operating the TriForge shadow trading system. All trading is simulated — no real orders are placed.

The system pipeline: **Level Detection -> Route Scoring -> Confirmation Scoring -> Trade Score -> Council Vote -> Risk Gate -> Shadow Execution -> Journal**.

---

## 1. Daily Review Checklist

Run this checklist at the end of each trading session (or the following morning).

### 1a. Session Health

- [ ] **Feed connectivity**: Were there any feed-stale events? (threshold: 5 000 ms)
- [ ] **Positions opened**: How many shadow trades were opened today? (max allowed: 6/session)
- [ ] **Concurrent positions**: Did concurrent positions stay within limit? (max: 2)
- [ ] **Daily loss limit**: Was the 5% daily loss cap reached? If so, were subsequent trades correctly blocked?
- [ ] **Consecutive losses**: Were there 3+ consecutive losses triggering the circuit breaker?

### 1b. Trade Quality Spot-Check

Pick 1-2 trades from today's journal and verify:

- [ ] **Entry level quality** >= 50 (the pipeline floor)
- [ ] **Route quality** >= 50
- [ ] **Confirmation score** >= 65 (B-band floor)
- [ ] **Trade score band** is B or above (>= 65)
- [ ] **RR ratio** >= 1.5 (hard floor at pipeline, score formula, and risk model)
- [ ] **Council vote** passed the correct tier:
  - 3-seat w/ Grok: 2+ TAKE, no Grok veto, avgConf >= 60
  - 2-seat w/ Grok: unanimous TAKE, no Grok veto, avgConf >= 65
  - 2-seat no Grok: unanimous TAKE, avgConf >= 70
- [ ] **Stop placement** is sensible relative to structure (max 3 ATR, padding 0.20 ATR)
- [ ] **Advisory targets** (if present): T2/T3 are beyond T1, spaced >= 0.3 ATR, within 5 ATR of entry

### 1c. Outcome Sanity

- [ ] **Win/loss assignment** makes sense (exit at target = win, exit at stop = loss)
- [ ] **MFE recorded**: Non-zero MFE values on all closed trades
- [ ] **Hold duration**: No absurdly short (< 1 min) or long (> 60 min) holds without explanation
- [ ] **Journal count**: Total entries below 500 cap (older entries auto-trimmed)

---

## 2. Weekly Review Checklist

Run this at the end of each trading week (Friday close or Saturday morning).

### 2a. Overall Performance (All Trades, Trailing 7 Days)

- [ ] **Total trades this week**: ___
- [ ] **Win rate**: ___ (healthy range: 0.40-0.65)
- [ ] **Expectancy (R)**: ___ (target: positive; > 0.15R is strong)
- [ ] **Profit factor**: ___ (target: > 1.2)
- [ ] **Avg win R**: ___ / **Avg loss R**: ___ (ratio should be > 1.0)
- [ ] **Max drawdown trade**: ___ R (flag if worse than -1.5R regularly)

### 2b. Dimension Breakdown (Key Buckets)

Review each dimension. Flag any bucket with negative expectancy AND >= 10 trades.

| Dimension | Buckets to Watch | Flag If |
|-----------|-----------------|---------|
| **scoreBand** | elite, A, B | B-band expectancy < 0 over 20+ trades |
| **levelType** | supply, demand, swing_high, swing_low | Any type with negative expectancy over 15+ trades |
| **confirmationType** | Each trigger type | Any type with win rate < 0.30 over 15+ trades |
| **sessionRegime** | open_drive, trend, range, reversal | Range/reversal with expectancy < -0.10R over 15+ trades |
| **sessionWindow** | opening, prime, reduced | Reduced-window expectancy < 0 over 15+ trades |
| **symbol** | NQ, ES, etc. | Any symbol diverging > 0.3R from overall expectancy |
| **councilConsensus** | Patterns | Any consensus pattern with win rate < 0.35 over 10+ trades |

### 2c. Advisory Target Review

- [ ] **Trades with advisory targets**: ___ / total trades
- [ ] **Overall T2 reach rate**: ___ (baseline expectation: 15-40%)
- [ ] **Overall T3 reach rate**: ___ (baseline expectation: 5-20%)
- [ ] **Avg MFE (R)**: ___ for trades with targets
- [ ] **Avg leftover R beyond T1**: ___ (positive = MFE typically exceeded T1)
- [ ] **Loser T2 reach rate**: ___ (key rescue signal)
- [ ] **Loser T3 reach rate**: ___
- [ ] **Avg T2 rescue R**: ___ (hypothetical R captured if partial taken at T2)
- [ ] **Best bucket for T2 reach**: ___ (which setup type reaches T2 most often?)
- [ ] **Worst bucket for T2 reach**: ___

**Data limitation reminder**: MFE is frozen at position close. Winner-side T2/T3 rates are understated because winning trades exit at T1, capping MFE near T1 distance. Interpret winner reach rates conservatively. Loser-side and overall rates are more informative.

### 2d. Council Effectiveness

- [ ] **Council approval rate**: ___ (should be 40-70%; too high = rubber-stamping, too low = over-filtering)
- [ ] **Approved trade win rate** vs **rejected trade hypothetical win rate**: Council should be adding value (approved > rejected)
- [ ] **False positive rate**: Approved trades that lost — acceptable if expectancy stays positive
- [ ] **False negative rate**: Rejected trades that would have won — some expected, flag if > 60%

### 2e. Stop Quality

- [ ] **Avg stop distance (ATR)**: ___ (should be 1.0-3.0 ATR typically)
- [ ] **Trades stopped out that later reached target**: ___ % (flag if > 40%)
- [ ] **Avg MFE on losers**: ___ R (if consistently > 0.5R, stops may be too tight)
- [ ] **Trades with stop > 2.5 ATR**: Review if these have worse outcomes

---

## 3. Key Metrics to Monitor

### 3a. Primary Metrics (Monitor Weekly)

| Metric | Source Dimension | Healthy Range | Action Trigger |
|--------|-----------------|---------------|----------------|
| Overall expectancy | all trades | > 0.00R | Negative over 30+ trades = investigate |
| Win rate | all trades | 0.40-0.65 | < 0.35 over 30+ trades = investigate |
| Profit factor | all trades | > 1.0 | < 0.9 over 30+ trades = investigate |
| Elite expectancy | scoreBand | > 0.20R | < 0.10R over 15+ trades = investigate |
| A-band expectancy | scoreBand | > 0.10R | < 0.00R over 20+ trades = investigate |
| B-band expectancy | scoreBand | > 0.00R | Negative over 20+ trades = consider raising floor |
| Council add-value | councilConsensus | approved > rejected | Approved worse than rejected over 20+ each = investigate |

### 3b. Secondary Metrics (Monitor Bi-Weekly)

| Metric | Source Dimension | What It Tells You |
|--------|-----------------|-------------------|
| Expectancy by levelType | levelType | Which level types produce edge |
| Expectancy by confirmationType | confirmationType | Which triggers are reliable |
| Win rate by sessionRegime | sessionRegime | Which market conditions favor the system |
| Expectancy by sessionWindow | sessionWindow | Time-of-day performance patterns |
| T2 reach rate by scoreBand | advisory targets | Whether higher-quality setups also have runner potential |
| Loser T2 reach rate overall | advisory targets | Rescue potential signal |
| Leftover R beyond T1 | advisory targets | Whether there is systematic untapped profit beyond T1 |

### 3c. Metric Computation Reference

**Expectancy formula**: `E[R] = (winRate * avgWinR) - (lossRate * avgLossR)`

**Trade score formula**: `level(30%) + route(25%) + confirmation(20%) + session(10%) + rr(15%)`

**Score bands**: elite >= 85, A >= 75, B >= 65, no_trade < 65

---

## 4. Minimum Sample Sizes

Do not make parameter changes based on small samples. Noise dominates at low N.

| Decision Type | Minimum Trades | Rationale |
|---------------|---------------|-----------|
| Overall system health assessment | 30 | Expectancy stabilizes around 30 trades |
| Score band evaluation (elite/A/B) | 20 per band | Need enough in each band to compare |
| Level type evaluation | 15 per type | Some types are rare; 15 is minimum for signal |
| Confirmation type evaluation | 15 per type | Same rationale |
| Session regime evaluation | 15 per regime | Same rationale |
| Council effectiveness assessment | 20 approved + 20 rejected | Need both sides for comparison |
| Advisory target T2/T3 evaluation | 25 trades with targets | Reach rate confidence interval is wide below 25 |
| Single bucket decision (e.g., "disable demand in range") | 20 in that specific bucket | Cross-referencing bucket requires solid count |
| Promote multi-target execution | 50 trades with targets | Execution changes need high confidence |
| Stop parameter adjustment | 30 trades | Stop changes affect all future trades |
| Weight/threshold adjustment | 40 trades since last change | Avoid chasing noise from recent parameter edits |

**Rule of thumb**: If the sample size is below the minimum, record the observation but do not act on it. Revisit when the sample grows.

---

## 5. Decision Rules

### 5a. When to Promote Multi-Target Execution

Multi-target execution means implementing partial exits at T2/T3 (runner management, partial closes). This is a significant pipeline change.

**Prerequisites (ALL must be met):**

1. **Sample size**: >= 50 trades with advisory targets in journal
2. **Overall T2 reach rate**: >= 25% across all trades with targets
3. **Loser T2 reach rate**: >= 15% (rescue signal is present)
4. **Avg leftover R beyond T1**: > 0.00R (MFE systematically exceeds T1)
5. **Consistency across buckets**: T2 reach rate >= 20% in at least 2 different scoreBand buckets with >= 10 trades each
6. **No regression**: Overall system expectancy remains positive during the observation period
7. **Advisory period**: At least 2 full trading weeks of advisory data collected

**Decision**:
- All 7 met → **Promote**: Begin designing partial-exit execution with T2 as first target
- 5-6 met → **Continue observing**: Collect more data, revisit in 1 week
- < 5 met → **Do not promote**: Advisory targets are not demonstrating sufficient value yet

**If promoting**: Start with conservative partial sizing (e.g., 33% at T2, hold remainder to T1 stop). Do NOT go straight to full runner management.

### 5b. When to Keep Single-Target Execution

**Keep single-target if ANY of these hold:**

1. **T2 reach rate < 20%** over 50+ trades — targets are not being reached
2. **Avg leftover R beyond T1 < 0.00R** — MFE does not consistently exceed T1
3. **Loser T2 reach rate < 10%** — rescue potential is negligible
4. **System expectancy is positive and stable** — no evidence that single-target is leaving significant R on the table
5. **Bucket analysis shows reach rates are concentrated** in one rare setup type — not a systemic pattern

**Action**: Continue collecting advisory data. Re-evaluate every 2 weeks. The advisory analytics panel costs nothing to run and may reveal patterns over longer timeframes.

### 5c. When to Revisit Council Thresholds

The council approval thresholds are:
- 3-seat w/ Grok: 2+ TAKE, no Grok veto, avgConf >= 60
- 2-seat w/ Grok: unanimous, no Grok veto, avgConf >= 65
- 2-seat no Grok: unanimous, avgConf >= 70

**Tighten thresholds (raise avgConf requirement) if:**

1. **Council-approved trades have negative expectancy** over 20+ trades AND
2. **Rejected trades have lower win rate than approved** (council IS discriminating, just not enough) AND
3. **The gap is in confidence**: Approved trades with avgConf 60-65 perform worse than those with avgConf > 70
4. Recommended adjustment: +5 to the relevant avgConf threshold (e.g., 60 → 65 for 3-seat)

**Loosen thresholds (lower avgConf requirement) if:**

1. **Council-rejected trades have positive expectancy** over 20+ rejected trades AND
2. **Rejected trade hypothetical win rate > 50%** AND
3. **Council false negative rate > 50%** (more than half of rejected trades would have won)
4. Recommended adjustment: -5 to the relevant avgConf threshold

**Revisit Grok veto power if:**

1. **Grok-vetoed trades would have been profitable** in > 60% of cases over 15+ vetoes
2. **Other 2 providers had correct TAKE signals** in those vetoed trades
3. Consider: downgrade Grok veto to a -10 confidence penalty instead of hard block

**Do not touch council thresholds if:**

- Sample size < 20 approved + 20 rejected
- System expectancy is positive and council approval rate is 40-70%
- Changes were made to thresholds within the last 40 trades (let the previous change settle)

### 5d. When to Revisit Stop Logic

Current stop parameters:
- Max stop distance: 3.0 ATR
- Stop padding: 0.20 ATR
- Stop quality floor: 50 (structure-based stops require quality >= 50)
- Null-hold threshold: 2 bars

**Tighten stops (reduce max distance or padding) if:**

1. **Avg stop distance > 2.5 ATR** across 30+ trades AND
2. **Avg loss > -1.2R** (losses are too large relative to 1R) AND
3. **Trades stopped out that later hit target < 25%** (stops are not being run over)
4. Recommended: reduce maxStopAtrMultiple by 0.25 (e.g., 3.0 → 2.75)

**Loosen stops (increase padding or max distance) if:**

1. **Trades stopped out that later hit target > 40%** over 30+ losing trades AND
2. **Avg MFE on losers > 0.5R** (price moved favorably before reversing through stop) AND
3. **Win rate < 0.40** (premature stops are reducing win rate)
4. Recommended: increase stop padding by 0.05 ATR (e.g., 0.20 → 0.25)

**Revisit null-hold threshold if:**

1. **Many trades exit as breakeven** that later would have been winners AND
2. **The null-hold bar count** is expiring positions prematurely
3. Recommended: increase from 2 → 3 bars (revert previous tune)

**Do not touch stop parameters if:**

- Sample size < 30 trades since last stop change
- Win rate is 0.40-0.60 and expectancy is positive
- Avg MFE on losers is < 0.3R (stops are correctly placed, price just went the wrong way)

### 5e. When to Revisit Score Weights or Band Thresholds

Current weights: level(30%) + route(25%) + confirmation(20%) + session(10%) + rr(15%)
Current bands: elite >= 85, A >= 75, B >= 65, no_trade < 65

**Adjust the no_trade floor (currently 65) if:**

1. **B-band (65-74) expectancy is negative** over 20+ B-band trades → raise floor to 70
2. **B-band expectancy is strongly positive** (> 0.20R) over 20+ trades AND many trades are being blocked at 65 → lower floor to 60
3. Only adjust by 5 points at a time

**Adjust component weights if:**

1. **One dimension consistently dominates edge**: e.g., high-route-quality trades win regardless of level quality → increase route weight
2. **One dimension shows no correlation with outcome**: e.g., session score has near-identical expectancy across high/low values → reduce its weight
3. Minimum 40 trades for weight analysis
4. Only adjust by 5% at a time, and rebalance other weights to maintain 100% total

---

## 6. Parameter Quick Reference

### Pipeline Thresholds

| Parameter | Value | Location |
|-----------|-------|----------|
| Level quality floor | 50 | TradeDecisionEngine |
| Route quality floor | 50 | TradeDecisionEngine |
| Confirmation threshold | 65 | TradeDecisionEngine |
| No-trade score floor | 65 | TradeDecisionEngine |
| RR hard minimum | 1.5 | TradeDecisionEngine + RiskModel |
| Max stop distance | 3.0 ATR | RiskModel |
| Stop padding | 0.20 ATR | TradeDecisionEngine |
| Stop quality floor | 50 | TradeDecisionEngine |
| Null-hold bars | 2 | TriForgeShadowSimulator |

### Trade Score Composition

| Component | Weight |
|-----------|--------|
| Level quality | 30% |
| Route quality | 25% |
| Confirmation | 20% |
| Session fit | 10% |
| Risk/reward | 15% |

### Level Quality Factors (10 factors, sum = 100)

| Factor | Weight |
|--------|--------|
| displacementAway | 15 |
| reactionStrength | 15 |
| htfAlignment | 15 |
| freshness | 10 |
| imbalancePresent | 10 |
| volumeSurge | 10 |
| liquidityRelevance | 10 |
| touchCountQuality | 5 |
| recency | 5 |
| structuralBreak | 5 |

### Route Quality Factors (6 factors, sum = 100)

| Factor | Weight |
|--------|--------|
| destinationClarity | 20 |
| cleanTravelSpace | 20 |
| congestionPenalty | 15 |
| destinationLiquidity | 15 |
| sessionAlignment | 15 |
| htfAlignment | 15 |

### Confirmation Factors (7 factors, sum = 100)

| Factor | Weight |
|--------|--------|
| displacement | 20 |
| microStructure | 20 |
| reclaimFailure | 15 |
| rejectionQuality | 15 |
| retestHold | 10 |
| volumeConfirmation | 10 |
| responseSpeed | 10 |

### Council Approval Tiers

| Configuration | TAKE Votes | Veto Rule | Min Avg Confidence |
|---------------|-----------|-----------|-------------------|
| 3-seat w/ Grok | >= 2 | Grok REJECT = veto | 60 |
| 2-seat w/ Grok | 2 (unanimous) | Grok REJECT = veto | 65 |
| 2-seat no Grok | 2 (unanimous) | N/A | 70 |

### Risk Model Defaults

| Parameter | Value |
|-----------|-------|
| minRR | 1.5 |
| maxDailyLossPct | 5% |
| maxTradesPerSession | 6 |
| maxConsecutiveLosses | 3 |
| maxConcurrentPositions | 2 |
| feedStaleThresholdMs | 5 000 ms |
| maxStopAtrMultiple | 3.0 |

### Advisory Target Parameters

| Parameter | Value |
|-----------|-------|
| Max distance from entry | 5 ATR |
| Min spacing between targets | 0.3 ATR |
| Level quality floor | 50 |
| Max targets (T2 + T3) | 2 |

### Journal

| Parameter | Value |
|-----------|-------|
| Max entries (JSONL file) | 500 |
| Analytics dimensions | 7 (levelType, confirmationType, sessionRegime, symbol, scoreBand, sessionWindow, councilConsensus) |

---

## 7. Change Log Protocol

When making any parameter change:

1. **Record the change**: parameter name, old value, new value, date
2. **Record the evidence**: sample size, metric values that triggered the decision
3. **Set a review date**: 40 trades after the change to evaluate impact
4. **Do not stack changes**: Only change one parameter category at a time (e.g., don't adjust both stop logic AND council thresholds simultaneously)
5. **Revert if inconclusive**: If 40 trades after a change show no improvement, revert to the previous value

---

*This runbook reflects the system state as of v1.16.9. Update parameter values if thresholds are changed.*
