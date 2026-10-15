# CAPEX and depreciation: proposal for owner review

This is a proposal, not an active financial rule. No persisted data, calculator
or formula in `management-result.ts` changes in this iteration.

## Current behaviour

- `operatingResult = grossProfit - fixedOpex - commissions`: a management
  operating result on covered revenue, before depreciation.
- `cashResult = operatingResult - capex`: the entered one-time purchase reduces
  the period's cash result once. This is correct for the current cash scenario.
- An asset register, service dates, useful lives, depreciation and accumulated
  depreciation are absent. Calling the operating result a result *after*
  depreciation would currently be incorrect.

## Minimal proposed schedule

One explicit record per real asset: stable asset ID, name, acquisition cost,
residual value, commissioning date, useful life in months and retirement date
when relevant. These are owner-supplied values, never inferred from product
prices or inventory. Do not infer commissioning from payment date.

For review, use straight-line monthly depreciation:
`(acquisition cost - residual value) / useful life in months`. Keep cents and
reconcile the final month's rounding so the total equals the depreciable base.
The proposed output has month, asset ID/name, opening carrying value, monthly
depreciation, accumulated depreciation and closing carrying value.

Illustration only, not a KARIMOFF asset: cost 120,000 RUB, residual value 0,
60-month life, commissioning 2026-11-15. Assuming the owner chooses the
**following-month** convention:

| Month | Opening | Depreciation | Accumulated | Closing |
| --- | ---: | ---: | ---: | ---: |
| 2026-11 | 120,000 | 0 | 0 | 120,000 |
| 2026-12 | 120,000 | 2,000 | 2,000 | 118,000 |
| 2027-01 | 118,000 | 2,000 | 4,000 | 116,000 |
| 2031-11 | 2,000 | 2,000 | 120,000 | 0 |

Display this as a separate preview beside the existing management result.
Only after approval, a separate profit-after-depreciation line may subtract the
selected period's depreciation from operating result. It must not subtract
CAPEX a second time, alter revenue/food cost or rewrite the existing cash line.

## Decisions before implementation

1. The authoritative asset list and acquisition costs/residual values.
2. Useful life per asset and actual commissioning dates.
3. Start in the commissioning month, following month, or daily proration.
4. Treatment of retirement, upgrades and assets partly used outside KARIMOFF.
5. Whether this is management reporting only; accounting/tax depreciation must
   not be inferred from this illustrative management schedule.
