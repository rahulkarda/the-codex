#!/usr/bin/env node
/**
 * Daily principle generator — calls Gemini, validates, appends to data/principles.json.
 *
 * Env: GEMINI_API_KEY (required)
 * Flags: --dry  (skip writing)
 *
 * Strategy:
 *  1. Read existing principles.json — collect all names + ids so we don't repeat.
 *  2. Pick an under-represented category (lowest count among the 14).
 *  3. Ask Gemini for ONE new principle in that category, returning strict JSON
 *     matching our schema, and instruct it not to use any of the existing names.
 *  4. Validate the JSON, generate id from name, dedupe, append.
 *  5. Write back, sorted; print a one-line summary.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'principles.json');

// Load .env locally (no-op in CI where vars are already in env).
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]] && v) process.env[m[1]] = v;
  }
})();

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;
const DRY = process.argv.includes('--dry');

if (!API_KEY) {
  console.error('GEMINI_API_KEY env var is required.');
  process.exit(1);
}

const CATEGORY_ORDER = [
  'Mental Model','Cognitive Bias','Decision-Making','Psychology Effect','Philosophy & Stoicism',
  'Productivity','Focus & Habits','Learning','Communication','Social Dynamics','Relationships',
  'Money & Time','Economics & Incentives','Health & Longevity',
];

function slug(name) {
  return name
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function canonKey(name) {
  const stop = new Set(['the','rule','principle','law','effect','fallacy','of','a','an','and','for']);
  const words = (name.toLowerCase().match(/[a-z]+/g) || []).filter(w => !stop.has(w)).slice(0, 2);
  return words.length ? words.join('-') : slug(name);
}

function pickThinnestCategory(entries) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map(c => [c, 0]));
  for (const e of entries) if (e.category in counts) counts[e.category]++;
  const min = Math.min(...Object.values(counts));
  const candidates = CATEGORY_ORDER.filter(c => counts[c] === min);
  // tie-break with date for determinism per day
  const today = new Date().toISOString().slice(0, 10);
  const idx = [...today].reduce((a, c) => a + c.charCodeAt(0), 0) % candidates.length;
  return candidates[idx];
}

const SYSTEM_PROMPT = `You are a research-grade contributor to "The Codex" — a curated dataset of life principles, mental models, cognitive biases, and psychology effects.

Your job: produce ONE new entry in the requested category, citing primary sources where possible, with skeptical pitfalls when popular framings have weak replication.

Hard constraints:
- Output ONLY a JSON object matching the schema. No prose, no markdown fences.
- Do NOT repeat any of the existing names listed (case-insensitive, partial-match).
- oneLiner ≤ 25 words.
- description: 2–4 sentences.
- example: a concrete real-world scenario.
- howToApply: tactical, action-first steps.
- pitfalls: misuses, replication caveats (be honest), counter-examples.
- origin: who proposed it + year, one line.
- tags: 2–5 lowercase, useful for filtering.

Schema:
{
  "name": "...",
  "category": "<exact category requested>",
  "tags": ["...", "..."],
  "oneLiner": "...",
  "description": "...",
  "example": "...",
  "howToApply": "...",
  "pitfalls": "...",
  "origin": "..."
}`;

async function callGemini(category, existingNames) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const namesList = existingNames.slice().sort().join(', ');
  const userPrompt = `Category: ${category}

Existing names already in the codex (do NOT repeat any of these):
${namesList}

Produce ONE new high-value entry in this category. Pick something widely useful, well-sourced, and not in the list above. Return ONLY the JSON object.`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini: ' + JSON.stringify(data).slice(0, 500));
  return JSON.parse(text);
}

function validate(entry, expectedCategory) {
  const required = ['name','category','tags','oneLiner','description','example','howToApply','pitfalls','origin'];
  const missing = required.filter(k => !(k in entry));
  if (missing.length) throw new Error(`Missing fields: ${missing.join(', ')}`);
  if (typeof entry.name !== 'string' || entry.name.length < 3) throw new Error('Bad name');
  if (entry.category !== expectedCategory) {
    console.warn(`(category mismatch — model returned "${entry.category}", forcing "${expectedCategory}")`);
    entry.category = expectedCategory;
  }
  if (!Array.isArray(entry.tags) || entry.tags.length < 1) throw new Error('Bad tags');
  entry.tags = entry.tags.slice(0, 5).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  for (const f of ['oneLiner','description','example','howToApply','pitfalls','origin']) {
    if (typeof entry[f] !== 'string' || !entry[f].trim()) throw new Error(`Empty: ${f}`);
    entry[f] = entry[f].trim();
  }
  return entry;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const existingNames = data.entries.map(e => e.name);
  const existingKeys = new Set(data.entries.map(e => canonKey(e.name)));

  const category = pickThinnestCategory(data.entries);
  console.log(`Generating in category: ${category}`);
  console.log(`Existing total: ${data.entries.length}`);

  let entry;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      entry = await callGemini(category, existingNames);
      entry = validate(entry, category);
      const k = canonKey(entry.name);
      if (existingKeys.has(k)) throw new Error(`Duplicate of existing entry: ${entry.name}`);
      break;
    } catch (e) {
      console.warn(`Attempt ${attempt} failed: ${e.message}`);
      if (attempt === 3) throw e;
    }
  }

  const newEntry = {
    id: slug(entry.name),
    name: entry.name,
    category: entry.category,
    tags: entry.tags,
    oneLiner: entry.oneLiner,
    description: entry.description,
    example: entry.example,
    howToApply: entry.howToApply,
    pitfalls: entry.pitfalls,
    origin: entry.origin,
  };

  console.log(`\nNew entry: ${newEntry.name}`);
  console.log(`  ${newEntry.oneLiner}`);

  if (DRY) {
    console.log('\n[--dry] not writing.');
    return;
  }

  data.entries.push(newEntry);

  function catRank(c) { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 999 : i; }
  data.entries.sort((a, b) => {
    const r = catRank(a.category) - catRank(b.category);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });

  const used = [];
  for (const e of data.entries) if (!used.includes(e.category)) used.push(e.category);
  used.sort((a, b) => catRank(a) - catRank(b));
  data.categories = used;
  data.meta = data.meta || {};
  data.meta.count = data.entries.length;
  data.meta.generated = new Date().toISOString().slice(0, 10);
  data.meta.lastAdded = { name: newEntry.name, category: newEntry.category, date: data.meta.generated };

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote ${data.entries.length} entries to ${path.relative(ROOT, DATA_PATH)}`);
})().catch(e => { console.error(e); process.exit(1); });
