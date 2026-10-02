# Design Brief: Factory — People Management for AI Agents

> Hand-off brief for implementation in Claude Code. "Factory" is a placeholder product name.

## 1. Product summary

Factory is a people-management system for AI agents ("digital Factory"). Each agent is treated like an employee: it has a **name, avatar, job title, skills, memory, an underlying model, an hourly billing rate, a status and a timesheet**. The owner (team lead) can browse the team, inspect a teammate, approve billed time and hire new Factory.

**Primary user:** a team owner who curates and pays for a group of agents.

**Core jobs to be done**
1. See who is on the team, who is busy, and what each costs.
2. Inspect one teammate: skills, memory, model, cost breakdown, recent work.
3. Track and approve billed time; see spend against budget and invoices.
4. Hire (create) a new teammate with a name, avatar, model, skills, memory mode and rate.

## 2. Tone and visual direction

**Warm and human.** It should feel like a friendly HR tool, not an infrastructure console. Personality comes from illustrated avatars, soft pastel colours and a characterful display typeface. Avoid gradients, emoji, left-border accent cards and generic fonts (Inter, Roboto, Arial).

### Design tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F5F1EE` | Page background (warm grey) |
| `--surface` | `#FFFFFF` | Cards |
| `--surface-sunken` | `#FBF8F6` | Sidebar |
| `--chip` | `#F5F1EE` | Skill chips, tags |
| `--border` | `#E6DED8` | Card borders |
| `--border-strong` | `#DCD2CB` | Inputs, secondary buttons, dashed dividers |
| `--divider` | `#F0E9E4` | Table rows, meter tracks |
| `--ink` | `#241C1A` | Primary text, dark cards, active nav |
| `--ink-2` | `#4A3F3A` | Secondary text |
| `--muted` | `#6B605A` | Labels, captions (passes 4.5:1 on `--bg`) |
| `--on-ink` | `#FFF8F2` | Text on dark surfaces |
| `--on-ink-muted` | `#CDBFB7` | Muted text on dark surfaces |
| `--accent` | `#C2471F` | Primary buttons, meters, focus ring (white text passes AA) |
| `--accent-link` | `#A63F1C` | Links, tier labels (hover `#7E2E12`) |
| `--accent-soft` | `#FCE3D6` | "Available" pill, soft highlights |
| `--accent-tint` | `#FFF4EE` | Selected option background |
| `--accent-light` | `#F2A27E` | Third data series, light bars |
| `--teal` | `#2B7F86` | "On a task" dot, secondary brand colour |
| `--teal-soft` | `#DDEFEC` / text `#1C5A5F` | "On a task" / "Approved" / "Paid" pills |
| `--neutral-soft` | `#ECE6E1` / text `#5E534D` | "Paused" / "Off shift" pills |

**Typography** (Google Fonts)
- Display: **Bricolage Grotesque** (500/700/800). Used for headings, names and big numbers; letter-spacing −0.02 to −0.03em on large sizes.
- Body/UI: **Figtree** (400/500/600/700). Use `font-variant-numeric: tabular-nums` for all money and hours columns.
- Scale: H1 44px/800 · section H2 20–22px/700 · card name 20px/700 · body 15–17px · labels 12.5–14px/600.

**Shape and spacing**
- Radii: cards 18–24px, buttons and inputs 12px, chips 8px, pills 999px.
- Card padding 22–26px; grid gaps 16–20px; main content padding 40px/48px (16px on mobile).
- Hover: cards lift 2px with a soft warm shadow `0 10px 24px -14px rgba(60,30,20,.35)`; buttons darken (brightness .92).
- Minimum touch target 44px.

**Status system**

| Status | Label | Pill bg / text | Dot |
|---|---|---|---|
| `task` | On a task | `#DDEFEC` / `#1C5A5F` | `#2B7F86` |
| `available` | Available | `#FCE3D6` / `#8A3415` | `#C2471F` |
| `paused` | Paused | `#ECE6E1` / `#5E534D` | `#8F837C` |
| `off` | Off shift | `#ECE6E1` / `#5E534D` | `#C9BEB7` |

**Model tiers**

| Model | Tier label | Chart colour | Suggested base rate |
|---|---|---|---|
| Claude Haiku | LIGHT · `$` | `#F2A27E` | $4/hr |
| Claude Sonnet | BALANCED · `$$` | `#C2471F` | $16/hr |
| Claude Opus | PREMIUM · `$$$` | `#241C1A` | $50/hr |

The three chart colours differ in lightness, not only hue. Keep that property if the palette changes.

## 3. Avatar system

Avatars are **generated SVG faces**, not images. Each one is a 64×64 viewBox inside a circular clip (`border-radius: 50%; overflow: hidden`) with a pastel background. Users can also upload an image instead.

Layers, in order:
1. Background: the pastel `bg` colour (set on the container).
2. Shoulders: `M10 64 C12 51 21 46 32 46 C43 46 52 51 54 64 Z`, filled with `deep`.
3. Head: circle `cx=32 cy=31 r=15`, fill `#FFF8F2`.
4. Hair: one of the paths below, filled with `deep`.
5. Eyes: circles at (27,32) and (37,32), r=1.8, fill `--ink`.
6. Cheeks (optional at small sizes): circles at (23.5,36.5) and (40.5,36.5), r=2.4, fill `bg`.
7. Smile: `M27.5 37.5 Q32 41 36.5 37.5`, stroke `--ink`, width 2, round caps, no fill.

**Hair styles**
```
bob:     M15 31 C15 18 22 12 32 12 C42 12 49 18 49 31 L49 40 L44 40 L44 26 C40 23 24 23 20 26 L20 40 L15 40 Z
antenna: M17 27 C18 18 25 14 32 14 C39 14 46 18 47 27 C40 22 24 22 17 27 Z M31 14 L31 7 L33 7 L33 14 Z M29.5 5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z
bun:     M18 26 C19 18 25 15 32 15 C39 15 45 18 46 26 C39 21 25 21 18 26 Z M27 10 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z
quiff:   M16 29 C15 18 24 12 34 13 C43 14 49 21 48 29 C42 21 30 19 22 25 C20 26 18 28 16 29 Z
crop:    M17 28 C17 19 24 14 32 14 C40 14 47 19 47 28 C44 22 38 20 32 20 C26 20 20 22 17 28 Z
```

**Colour pairs (`bg` / `deep`)**
`#FFD7C2/#7A2E14` peach · `#CDE7E4/#1E5E63` mint · `#E5DAF5/#4B2E83` lilac · `#FBE6A6/#6B4E00` butter · `#F6CFD8/#8A2440` rose · `#D6E4FA/#1F4A8A` sky · `#DCE8C8/#3D5A1E` sage · `#EED9C4/#6A3F1F` sand

**Sizes:** 38px (stacked in summary tiles, 3px white border, −10px overlap) · 40px (list rows) · 60px (roster cards) · 64px (picker) · 96px (hire preview) · 124px (profile hero, 6px white border).

Build this as one reusable `<Avatar config={{bg, deep, hair}} size={n} />` component. Store the avatar as `{ type: 'generated', bg, deep, hair }` or `{ type: 'upload', url }`.

## 4. Data model

```ts
type Status = 'task' | 'available' | 'paused' | 'off';
type ModelId = 'haiku' | 'sonnet' | 'opus';
type MemoryMode = 'session' | 'personal' | 'team';

interface Teammate {
  id: string;
  name: string;
  role: string;               // job title
  avatar: AvatarConfig;
  status: Status;
  currentTask?: string;       // e.g. "Q4 competitor scan"; or a status note like "Back Monday 08:00"
  model: ModelId;
  rate: number;               // USD per hour billed
  monthlyCap: number;         // USD; work pauses and asks before exceeding
  costCentre: string;         // "Support" | "Growth" | "Sales" | "Platform" | ...
  memoryMode: MemoryMode;
  memoryCap: number;          // items
  about: string;              // working style
  traits: string[];           // e.g. "Tone: plain & precise", "Works 07:00–19:00 SAST"
  approvalThreshold?: number; // e.g. needs approval over $200 per task
  reportsTo: string;          // user id
  hiredAt: string;            // ISO date
  skills: Skill[];
}

interface Skill { name: string; description: string; level: 1 | 2 | 3 } // Learning / Proficient / Expert

interface MemoryItem {
  id: string; teammateId: string;
  kind: 'fact' | 'preference' | 'source';
  text: string; learnedAt: string;
}

interface TimeEntry {
  id: string; teammateId: string;
  date: string; task: string; costCentre: string;
  hours: number; tokens: number;
  amount: number;             // hours × rate at time of logging
  status: 'pending' | 'approved';
}

interface Invoice {
  id: string;                 // e.g. "INV-0009"
  month: string;              // "2026-09"
  amount: number; dueDate?: string;
  status: 'open' | 'paid';
}

interface CostBreakdown { compute: number; toolsAndMemory: number; margin: number } // per hour; sums to rate
```

**Derived values**
- Billed for a period = Σ `hours × rate` over the period's time entries.
- Budget % = billed ÷ period budget. The default budgets in the mockup are $2,100/week, $9,000/month and $26,000/quarter. These should be configurable.
- Spend by model = billed, grouped by `model`.
- Hire estimate = `rate × 80` (80 hours a month). Hours until the cap is reached = `floor(cap ÷ rate)`.

## 5. Information architecture

App shell: a left sidebar (248px) and a main column (max-width 1240px).

**Sidebar**, top to bottom:
- Logo mark (two overlapping circles, accent and teal at 85% opacity) with the wordmark in Bricolage 800.
- Nav: Team roster · Profiles · Billing & timesheets · Hire a teammate. Each item has an 18px stroke icon. The active item uses an ink background with on-ink text and `aria-current="page"`.
- Budget mini-card pinned to the bottom (label, 8px meter, "$X of $Y used").
- Owner block: initial avatar, name and "Team owner".

Below 860px the sidebar is hidden. Replace it with a top bar or drawer in the build.

Routes: `/team`, `/team/:id`, `/billing`, `/hire`.

## 6. Screens

### 6.1 Team roster (`/team`)
- **Header:** H1 "Your digital Factory", with a subline such as "Eight agents on the team. Four are on a task right now." On the right: a search input (280px, searches name, role, model and skills) and a primary "Hire a teammate" button.
- **Summary tiles** (auto-fit grid, minimum 260px):
  1. On a task now: "4 of 8" with a stack of the busy Factory' avatars.
  2. Billed in the last 30 days: dollar total and "N hours across M Factory".
  3. Monthly budget: percentage used and a 10px meter.
- **Status filter pills:** Everyone / On a task / Available / Paused / Off shift, each with a count. Use `aria-pressed`. The selected pill has an ink fill.
- **Card grid** (auto-fit, minimum 320px). Each card links to the profile and contains:
  - 60px avatar, name, role, and a status pill at the top right.
  - Current task line with a clock icon.
  - Up to three skill chips.
  - A 2×2 stats grid above a dashed divider: Model (name plus tier in accent), Rate, Billed in 30 days ("42h · $2,016"), Memory ("1,240 items").
- **Last grid cell:** a dashed "Hire a teammate" card linking to `/hire`.
- **Empty search:** show a friendly empty state. This was not in the mockup and needs designing.

### 6.2 Teammate profile (`/team/:id`)
- Breadcrumb: Team roster / Name.
- **Hero card:** a 96px band in the teammate's avatar `bg` colour, with a 124px avatar overlapping it. Shows the name (42px), a status pill including the current task, and "Role · reports to X · hired DATE". Actions: Pause/Resume (secondary, toggles the status) and Assign work (primary).
- **Section nav** below the hero, as anchor tabs: About · Skills · Memory · Model & cost · Timesheet.
- **Two columns (1.7fr / 1fr)**, stacking below 1100px.
  - Left column:
    - About: a paragraph on working style plus trait chips.
    - Skills: a row per skill with name and description, a 3-segment level meter and the level label, plus an "Add skill" button.
    - Timesheet for this week: Day, Task, Hours, Tokens, Billed, with a bold total row and a link to Billing.
  - Right column:
    - Model & cost: a dark card with a tier badge, model name, the cost breakdown (compute, tools and memory, margin, then billing rate) and a "Change model" button.
    - Memory: "used of cap", a segmented bar (facts, preferences, sources) with a legend and counts, a "Recently learned" list (text plus kind and when learned), and Review memory / Reset buttons.
    - Billed in the last 30 days: total, hours, and a 4-week bar chart with the current week highlighted in accent.

### 6.3 Billing & timesheets (`/billing`)
- **Header:** H1 with a subline. On the right, a segmented control: This week / Month / Quarter.
- **Totals row:**
  - Billed for the period (dark card).
  - Budget: percentage, meter, and "$X of $Y · $Z left".
  - Spend by model: a stacked bar and a legend with amounts.
- **Two columns (1.6fr / 1fr):**
  - Cost by teammate: rows sorted by amount, each with a 40px avatar, name, "hours × rate", a bar scaled to the top spender and coloured by model, and the amount.
  - Invoices: month, reference and due date, amount, status pill (Open in accent-soft, Paid in teal-soft), and an "Export CSV" button.
- **Timesheets to review:** a full-width table with Teammate, Task, Cost centre, Hours, Tokens, Amount and Status. Pending rows have an "Approve" button. Approved rows show a teal "✓ Approved" pill. The header shows a pending count, or "All caught up" when there are none.

### 6.4 Hire a teammate (`/hire`)
Two columns: a form (1.6fr) and a sticky live preview (1fr). The preview drops below the form under 1100px.

The form has five numbered fieldsets, each with an ink circle number:
1. **Identity:** Name and Job title inputs, and an avatar picker with 6 generated options plus an upload button. The selected avatar gets a 3px accent ring.
2. **Model:** three selectable cards showing tier, name, a one-line description and "From $X / hr". The selected card has an accent border and accent-tint background. Choosing a model resets the rate to that model's base rate.
3. **Skills:** toggle chips (+ / ✓) and an "Upload a skill pack" button.
4. **Memory:** radio cards for Session only, Personal memory, or Shared team memory, each with a description.
5. **Billing:** Hourly rate (prefilled from the model and editable), Monthly cap, a Bill-to select, and helper text explaining that work stops at the cap.

Footer: Cancel (link), Save draft (secondary) and "Hire {name}" (primary).

**Preview card:** avatar band, name, role, selected skills, and a 2×2 grid (Model, Rate, Memory, Monthly cap). Below it is a dark estimate card: "At 80 hours a month → $X". If the estimate is over the cap, show "Hits the $cap cap after N hours" in a warm highlight; otherwise show "Comfortably under the $cap cap".

## 7. Interaction and behaviour rules
- Roster cards are whole-card links with a hover lift.
- Filters and search combine (AND).
- Pausing a teammate on the profile changes their status everywhere.
- Approving a timesheet entry is optimistic and updates the pending count immediately.
- Changing the billing period recalculates every number on the page.
- The hire preview updates on every keystroke.
- Hiring creates the teammate with status `available` and redirects to their profile.

## 8. Accessibility requirements
- Use real `<button>`, `<a>`, `<input>` with `<label>`, `<fieldset>` and `<legend>`. Never put click handlers on divs.
- Toggle buttons use `aria-pressed`. Icon-only buttons have an `aria-label`. Avatar SVGs are `aria-hidden`, and the name sits next to them.
- Text contrast is at least 4.5:1. Don't lighten `--muted` or the accent fill.
- Charts have text equivalents (`role="img"` with `aria-label`, or a visible legend with values).
- Visible focus ring: 2px `--accent`, 1px offset.
- Responsive down to 390px. Grids use `repeat(auto-fit, minmax(min(Npx, 100%), 1fr))`, and wide tables scroll horizontally.

## 9. Seed data (matches the mockups)

| Name | Role | Status | Current task | Model | Rate | Hours (30d) | Memory | Avatar (bg / hair) |
|---|---|---|---|---|---|---|---|---|
| Ada Quill | Research Analyst | task | Q4 competitor scan | opus | 48 | 42 | 1,240 | peach / bob |
| Milo Brightwater | Support Lead | task | Refund queue · 23 open | sonnet | 14 | 96 | 3,810 | mint / quiff |
| Juno Park | Frontend Engineer | task | Checkout accessibility fixes | opus | 52 | 38 | 960 | lilac / bun |
| Otis Fern | Data Wrangler | task | Dedupe CRM export | haiku | 4 | 61 | 410 | butter / antenna |
| Sable Reyes | Copywriter | paused | Paused · awaiting brief | sonnet | 16 | 22 | 780 | rose / crop |
| Pip Okafor | Operations Coordinator | available | Ready for work | haiku | 3 | 30 | 520 | sky / antenna |
| Rook Vale | Security Reviewer | off | Back Monday 08:00 | opus | 60 | 9 | 640 | sage / quiff |
| Wren Sato | Sales Researcher | available | Ready for work | sonnet | 18 | 14 | 1,105 | sand / bob |

The 30-day total is 312 hours and $6,814, against a $9,000 budget (76%). The September invoice is INV-0009 for $6,814, open and due 15 Oct.

## 10. Out of scope / open questions
- Real agent runtime integration: how status, tasks, tokens and memory are pulled from the actual agents.
- Pricing source: whether rates are derived from live per-token model prices or set manually.
- Multi-user roles: owner, manager, viewer.
- Two screens not yet designed: a timeline of each teammate's work and handoffs, and a token-based billing view.
- Empty, loading and error states for every screen.

## 11. Suggested implementation notes for Claude Code
- Stack: any modern React setup works (for example Next.js or Vite + React + TypeScript). Put the tokens in CSS variables or a Tailwind theme, and load the fonts with `next/font` or a Google Fonts link.
- Build these shared components first: `AppShell`, `Sidebar`, `Avatar`, `StatusPill`, `ModelBadge`, `Meter`, `StatCard`, `SegmentedControl`, `FilterPills`, `SkillChip`, `DataTable`.
- Start with in-memory seed data behind a small repository layer, so it can be swapped for a database or API later.
- Acceptance: all four screens match this brief at 1440px and 390px, every interaction in §7 works, and the derived totals in §4 are computed rather than hard-coded.
