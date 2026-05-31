# The Codex

> Life principles, mental models &amp; cognitive effects — the operating manual nobody hands you.

A searchable, beautifully-typeset codex of **160+ life principles, mental models, cognitive biases, and psychology effects** — the kind of ideas that, once you understand them, feel like cheat codes. **One new principle is added every day** by a Gemini-powered GitHub Action.

🌐 **Live site:** https://rahulkarda.github.io/the-codex/

From the **80/20 Rule** and the **Dunning-Kruger Effect** to **Antifragility**, **Stoic premeditation**, the **Habit Loop**, **Schelling Points**, and **Compound Interest** — each entry has a one-liner, a plain-English explanation, a real example, how to apply it, and (importantly) **the pitfalls and caveats** so you don't blindly weaponize a half-understood idea.

## What's inside

14 categories, 160+ entries:

| Category | Examples |
|---|---|
| **Mental Models** | First-Principles Thinking, Antifragility, Black Swan, Lindy Effect, Inversion, Map ≠ Territory, Via Negativa |
| **Cognitive Biases** | Confirmation Bias, Survivorship Bias, Anchoring, Sunk Cost, Loss Aversion, Hindsight Bias |
| **Decision-Making** | Pre-mortem, Second-Order Thinking, Expected Value, Regret Minimization, OODA Loop, Skin in the Game, Optionality |
| **Psychology Effects** | Placebo, Pygmalion, Zeigarnik, IKEA, Spotlight, Self-Fulfilling Prophecy, Flow |
| **Philosophy & Stoicism** | Dichotomy of Control, Memento Mori, Amor Fati, Negative Visualization, Wu Wei |
| **Productivity** | Pareto, Parkinson's Law, Eisenhower Matrix, Two-Minute Rule, Ivy Lee, Essentialism, Slack |
| **Focus & Habits** | Habit Loop, Habit Stacking, 2-Day Rule, Temptation Bundling, 4 Laws of Behavior Change |
| **Learning** | Spaced Repetition, Active Recall, Feynman Technique, Deliberate Practice, Interleaving |
| **Communication** | Active Listening, Steel-Manning, Socratic Method, NVC, BLUF, Graham's Hierarchy of Disagreement |
| **Social Dynamics** | Reciprocity, Social Proof, Dunbar's Number, Bystander Effect, Status Games |
| **Relationships** | Gottman Four Horsemen, 5:1 ratio, Bids for Connection, Repair Attempts |
| **Money & Time** | Compound Interest, Pay Yourself First, DCA, FU Money, Time Value of Money |
| **Economics & Incentives** | Opportunity Cost, Tragedy of the Commons, Goodhart's Law, Network Effects, Cobra Effect |
| **Health & Longevity** | Sleep, Resistance Training, Zone 2, Walking, Whole-food diet, Hormesis |

## Use it

- **Search** anything (`/` to focus the box)
- **Filter** by category chip
- **Random** principle (`R`) — great for daily browsing
- **Theme** light/dark (`T`)
- **Principle of the day** — surfaces a different one each day
- **Modal navigation** with `←` / `→`

## Run locally

It's just static HTML/CSS/JS — no build step. From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(You need a local server because the app `fetch`es the JSON file; opening `index.html` directly via `file://` will fail.)

## Daily auto-add (Gemini)

A GitHub Action runs every day at 09:17 UTC:

1. Picks the thinnest under-represented category.
2. Calls the **Gemini 2.5 Flash** API with the list of existing entry names so it can't repeat.
3. Validates the JSON against the schema, generates a stable `id`, dedupes against canonical keys.
4. Commits the change to `data/principles.json` — which redeploys Pages automatically.

Setup:

1. Add a repo secret `GEMINI_API_KEY` in **Settings → Secrets and variables → Actions** (free tier from [Google AI Studio](https://aistudio.google.com/apikey)).
2. The workflow lives at [.github/workflows/daily-principle.yml](.github/workflows/daily-principle.yml).
3. Trigger manually any time via the **Actions** tab → *Daily principle (Gemini)* → *Run workflow*.

Test it locally:

```bash
GEMINI_API_KEY=your_key node scripts/daily-principle.js --dry
```

## How the seed dataset was made

This codex was researched and written via a multi-agent Claude workflow:

1. **Fan-out research** — 14 specialist agents, one per category, each tasked with surfacing 10 entries from primary sources (Kahneman, Munger, Cialdini, Taleb, Stoic primary texts, peer-reviewed psychology, meta-analyses).
2. **Adversarial verification** — entries with known replication issues (ego depletion, marshmallow test, love languages, etc.) were sent to skeptical verifier agents that checked recent (2015+) replication studies and rewrote the *pitfalls* section accordingly.
3. **Editorial pass** — dedupe across categories, normalize taxonomy, polish language.

Every entry carries an `origin` line (who proposed it, when), tags, and the explicit *pitfalls* the popular framing usually leaves out.

## Files

- [index.html](index.html) — the page
- [styles.css](styles.css) — design tokens + light/dark theme
- [app.js](app.js) — search, filter, modal, keyboard shortcuts
- [data/principles.json](data/principles.json) — the entire dataset
- [scripts/daily-principle.js](scripts/daily-principle.js) — Gemini daily-add script
- [.github/workflows/](.github/workflows/) — Pages deploy + daily-principle action

## Add your own (manually)

The dataset is a flat JSON. Append an object with the same shape and refresh:

```json
{
  "id": "kebab-case-slug",
  "name": "Display Name",
  "category": "One of the 14 categories",
  "tags": ["lowercase", "two-to-five"],
  "oneLiner": "≤25-word summary.",
  "description": "2–4 sentences.",
  "example": "Concrete example.",
  "howToApply": "Tactical steps.",
  "pitfalls": "Misuses, replication issues, edge cases.",
  "origin": "Who proposed it, when."
}
```

## License

This is a personal study project; treat the text as a free-to-share digest of public ideas. Where an idea has a single canonical source (Munger, Taleb, Kahneman, Cialdini, the Stoa), the `origin` field cites it — please follow the citation back to the source for depth.
