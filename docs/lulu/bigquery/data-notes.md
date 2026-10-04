# Data findings (from diagnostics, Oct 2026)

| Finding | Evidence | Consequence |
|---|---|---|
| ~92k all-NULL rows in `ksa_jackpot` | no phone / number / email | Empty rows — ignored |
| Only status `delivered` | 197,633 orders, SAR 30.7M | Sales ≈ SAR 155 per order |
| Orders table starts 2026-06-30 | monthly counts | "First order" = first in the data, not truly first |
| Items table starts 2026-04-22 | `instaleap_raw` | Older item rows exist, but with no phone they can't be tied to customers |
| Shared / dummy phones | e.g. 1,268 orders on one phone, 796 names | Flagged via `suspect_reason`, excluded |
| **Item data covers only the western region** | match rate: Jeddah 92 %, Madinah 99.6 %, Tabuk 99 %, Taif 100 %; **Riyadh, Khobar, Dammam, Jubail, Dhahran, Al Ahsa ≈ 0 %** | Preferred store/category (and so replenishment, buy-again, cross-sell, category offers) only possible for western-region customers until an item source for Riyadh/Eastern exists |
| Job numbers `Lulu-<N>INP1/INP2/INP3/PRP1/PRP2` | shapes query | Regex strips prefix + suffix; handled |
| Feed freshness | newest order 103 h behind when checked | Re-check before every send (`data_as_of` gate) |

Orders ≈ Riyadh 57 %, Jeddah 15 %, Eastern Province ≈ 25 % of the last 30 days.
