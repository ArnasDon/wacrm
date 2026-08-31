# wacrm Design System — "Quiet Precision"

The product should read as calm, professional software — closer to Linear,
Notion, and Apple's system apps than to a template. Every rule below exists
to remove noise so data and language can do the talking.

## 1. Surfaces — paper canvas, white cards

- The app canvas is a warm paper neutral (`--background`, ~L 0.977 in light).
- Content sits on **white cards** (`--card`) separated from the canvas by a
  **1px hairline** (`--border`). No shadows on surfaces; shadows are reserved
  for floating layers (popovers, dialogs, tooltips).
- Radius scale is tight: `8px` cards/inputs, `6px` small controls, `12px`
  max for chat bubbles. Nothing pill-shaped unless it's a count/status chip.
- The inbox follows the same model: list + contact panel are white surfaces,
  the thread canvas is paper. Inbound bubbles are white cards on paper;
  outbound bubbles carry a soft accent tint.

## 2. Accent discipline — color is earned

- One accent (per `data-theme`) marks **interaction and attention only**:
  active/pressed states, primary buttons, links, focus rings, unread counts.
- **Never** as decoration. No colored icon chips, no tinted icon squares,
  no gradient fills, no per-card accent rotations.
- Icons are monochrome (`currentColor`), 16px, and inherit the text color of
  their row. An icon never introduces a new hue.
- Semantic status colors are the only other hues allowed, and only for state:
  - Emerald — success / open / sent
  - Amber — pending / warning / expiring
  - Red — failed / destructive
  - Muted gray — closed / inactive

## 3. Typography — hierarchy without color

- Inter throughout. Body 13–14px; UI labels 12–13px.
- **Micro-labels**: 11px, `font-medium`, `uppercase`, `tracking-wider`,
  `text-muted-foreground` — used for section headers, field labels, and
  metric names (e.g. `TOTAL CHATS`, `TAGS`, `DEALS`).
- Numbers are the interface: `tabular-nums` everywhere data is compared.
  Metric values 24–26px `font-semibold tracking-tight`.
- Hierarchy comes from size, weight, and tracking — not from color.

## 4. Layout — density with air

- Compact, predictable rows: 36–44px list rows, 12px card padding on
  dense surfaces, 16px on analytics cards.
- Hairlines divide repeated rows; whitespace (not boxes) divides groups.
- Toolbars hold text-first controls (segmented switches, quiet dropdown
  triggers) at 28px height.

## 5. Charts — one accent, quiet grid

- A chart uses **one accent series plus neutral series** — never two
  saturated hues competing.
- Gridlines are solid hairlines at low opacity; axes are muted 10–11px.
- Empty states are plain (muted icon + one line of copy) — no dashed
  boxes, no illustrations.

## 6. Motion — functional only

- 150ms ease color/opacity transitions on hover, focus, and state change.
- No ping/pulse loops, no bounce, no decorative animation. Loading is
  communicated with skeletons or a single quiet spinner.

## 7. Copy — plain, specific, short

- Sentence case everywhere except micro-labels. No exclamation marks.
- Empty states say what will appear and how to make it appear.
