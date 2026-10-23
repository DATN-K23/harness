# LP pool cap is not enforced on drawing settlement, so the pool can grow past `lpPoolCap` / `governancePoolCap`

**Severity:** High
**Contracts:** `contracts/Jackpot.sol`, `contracts/JackpotLPManager.sol`
**Functions:** `Jackpot.scaledEntropyCallback`, `Jackpot._setNewDrawingState`, `Jackpot._calculateLpPoolCap`, `JackpotLPManager.processDrawingSettlement`

## Description

`Jackpot._calculateLpPoolCap` derives the maximum LP pool size from two constraints:

1. the number of tickets that fit in the `TicketComboTracker` bit vector
   (`Combinations.choose(normalBallMax, NORMAL_BALL_COUNT) * (MAX_BIT_VECTOR_SIZE - normalBallMax)`), so that
   `bonusballMax + normalBallMax <= 255`;
2. `governancePoolCap`.

The cap is only enforced on the deposit path (`JackpotLPManager.lpDeposit` reverts with `ExceedsPoolCap` when
`_amount + totalPoolValue > lpPoolCap`) and when governance parameters change (`setLPPoolCap`).

On settlement, `Jackpot.scaledEntropyCallback` calls `JackpotLPManager.processDrawingSettlement`, which computes

```
postDrawLpValue = lpPoolTotal + _lpEarnings - _userWinnings - _protocolFeeAmount
newLPValue      = postDrawLpValue + pendingDeposits - withdrawalsInUSDC
```

with no comparison against `lpPoolCap` or `governancePoolCap`. When a drawing has no jackpot winner, LP earnings
(ticket sales minus edge/fees) are added to the pool, so a pool that sat at (or just below) the cap ends the drawing
above it.

`_setNewDrawingState(newLpValue, ...)` then sizes the next drawing from this uncapped value:

```
newPrizePool     = _newLpValue * (PRECISE_UNIT - reserveRatio) / PRECISE_UNIT
minNumberTickets = newPrizePool * PRECISE_UNIT / ((PRECISE_UNIT - lpEdgeTarget) * ticketPrice)
bonusballMax     = max(bonusballMin, ceilDiv(minNumberTickets, combosPerBonusball))
```

Because the prize pool is now larger than the size the cap was calibrated for, `bonusballMax` can exceed
`MAX_BIT_VECTOR_SIZE - normalBallMax`.

## Impact

- The protocol invariant "LP pool total never exceeds the governance pool cap" is broken after an ordinary
  drawing with no winner.
- `bonusballMax + normalBallMax` can exceed 255. Buying a ticket whose bonusball is near `bonusballMax` makes
  `TicketComboTracker` shift `1 << (bonusball + normalMax)` past bit 255, which reverts (overflow), so part of the
  advertised bonusball range cannot be bought (DoS on those tickets / unfair odds).

## Attack / trigger scenario

1. Owner calls `initializeLPDeposits(governancePoolCap)`; LPs deposit up to `lpPoolCap`.
2. Users buy tickets during the drawing; `runJackpot` locks it and requests entropy.
3. Entropy provider calls `scaledEntropyCallback`; the winning numbers match no ticket, so `drawingUserWinnings`
   is small and `lpEarnings` is positive.
4. `processDrawingSettlement` returns `newLPValue > lpPoolCap` (and `> governancePoolCap`); no revert occurs.
5. `_setNewDrawingState` sets `bonusballMax` above `255 - normalBallMax`; buying a ticket with that bonusball reverts.

## Recommended fix

Apply the same cap in settlement: clamp or route the excess of `newLPValue` above `lpPoolCap` (for example, pay it
out to LPs as withdrawable earnings), and bound `bonusballMax` by `MAX_BIT_VECTOR_SIZE - normalBallMax` in
`_setNewDrawingState`.
