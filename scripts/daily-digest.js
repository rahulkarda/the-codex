#!/usr/bin/env node
/**
 * Daily mental-model digest — picks today's model, asks Gemini for a fresh
 * connecting insight, renders an HTML email, and sends via Resend.
 *
 * Env:  GEMINI_API_KEY   (required)
 *       RESEND_API_KEY   (required)
 *       DIGEST_TO_EMAIL  (required)
 * Flags: --dry  (render HTML to stdout, skip sending)
 *
 * Model selection: deterministic rotation — dayOfYear % totalModels.
 * No state file needed; same model always maps to the same day of year.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'principles.json');
const DRY       = process.argv.includes('--dry');

// ── env loader (mirrors daily-principle.js) ──────────────────────────────────
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]] && v) process.env[m[1]] = v;
  }
})();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL   = process.env.DIGEST_TO_EMAIL;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GEMINI_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
if (!DRY && !RESEND_KEY) { console.error('Missing RESEND_API_KEY'); process.exit(1); }
if (!DRY && !TO_EMAIL)   { console.error('Missing DIGEST_TO_EMAIL'); process.exit(1); }

// ── pick today's model ────────────────────────────────────────────────────────
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

const db      = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const entries = db.entries;
const model   = entries[dayOfYear() % entries.length];

console.log(`📖 Today's model: ${model.name} (${model.category})`);

// ── ask Gemini for a connecting insight ──────────────────────────────────────
async function geminiInsight(m) {
  const prompt = `You are writing a short insight paragraph for a daily mental-models email digest.

Today's model: "${m.name}"
Category: ${m.category}
One-liner: ${m.oneLiner}
Description: ${m.description}
How to apply: ${m.howToApply}

Write ONE paragraph (4–6 sentences) titled "Why this matters right now."
- Connect this model to something happening in tech, work, or everyday life in 2026.
- Be concrete and specific — name an industry, a situation, a pattern people recognise.
- End with one actionable sentence that starts with "Today, try..."
- Tone: sharp, direct, no fluff. Like a smart friend who reads a lot.
- Output the paragraph only. No heading, no JSON, no markdown.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 300 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

// ── render HTML email ─────────────────────────────────────────────────────────
function renderEmail(m, insight) {
  const codexUrl = `https://rahulkarda.github.io/the-codex/#${m.id}`;
  const categoryColour = {
    'Mental Model':          '#22C55E',
    'Cognitive Bias':        '#F59E0B',
    'Decision-Making':       '#3B82F6',
    'Psychology Effect':     '#A78BFA',
    'Philosophy & Stoicism': '#FB923C',
    'Productivity':          '#34D399',
    'Focus & Habits':        '#60A5FA',
    'Learning':              '#FBBF24',
    'Communication':         '#F472B6',
    'Social Dynamics':       '#C084FC',
    'Relationships':         '#FB7185',
    'Money & Time':          '#4ADE80',
    'Economics & Incentives':'#FCD34D',
    'Health & Longevity':    '#6EE7B7',
  }[m.category] || '#22C55E';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${m.name} — The Codex Daily</title>
</head>
<body style="margin:0;padding:0;background:#0A0F1E;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0F1E;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- header -->
      <tr><td style="padding-bottom:28px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Courier New',monospace;font-size:13px;color:#22C55E;letter-spacing:0.12em;text-transform:uppercase;">
              The Codex
            </td>
            <td align="right" style="font-family:'Courier New',monospace;font-size:11px;color:#4B5563;letter-spacing:0.06em;">
              Daily Model
            </td>
          </tr>
        </table>
        <div style="height:1px;background:#1F2937;margin-top:12px;"></div>
      </td></tr>

      <!-- category pill -->
      <tr><td style="padding-bottom:16px;">
        <span style="display:inline-block;background:transparent;border:1.5px solid ${categoryColour};color:${categoryColour};font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;padding:4px 12px;border-radius:20px;">
          ${m.category}
        </span>
      </td></tr>

      <!-- model name -->
      <tr><td style="padding-bottom:12px;">
        <h1 style="margin:0;font-size:36px;font-weight:800;color:#F9FAFB;line-height:1.1;letter-spacing:-0.02em;">
          ${m.name}
        </h1>
      </td></tr>

      <!-- one-liner -->
      <tr><td style="padding-bottom:28px;">
        <p style="margin:0;font-size:17px;color:${categoryColour};line-height:1.6;font-style:italic;">
          ${m.oneLiner}
        </p>
      </td></tr>

      <tr><td style="height:1px;background:#1F2937;padding-bottom:28px;"></td></tr>

      <!-- description -->
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#4B5563;">What it is</p>
        <p style="margin:0;font-size:15px;color:#D1D5DB;line-height:1.75;">
          ${m.description}
        </p>
      </td></tr>

      <!-- example -->
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#4B5563;">Real example</p>
        <div style="border-left:2px solid ${categoryColour};padding-left:16px;">
          <p style="margin:0;font-size:15px;color:#D1D5DB;line-height:1.75;">
            ${m.example}
          </p>
        </div>
      </td></tr>

      <!-- how to apply -->
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#4B5563;">How to apply it</p>
        <p style="margin:0;font-size:15px;color:#D1D5DB;line-height:1.75;">
          ${m.howToApply}
        </p>
      </td></tr>

      <!-- pitfall -->
      <tr><td style="padding-bottom:28px;">
        <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#4B5563;">Common pitfall</p>
        <div style="background:#111827;border:1px solid #374151;border-radius:8px;padding:16px;">
          <p style="margin:0;font-size:14px;color:#9CA3AF;line-height:1.7;">
            ⚠ ${m.pitfalls}
          </p>
        </div>
      </td></tr>

      <tr><td style="height:1px;background:#1F2937;padding-bottom:28px;"></td></tr>

      <!-- connecting insight -->
      <tr><td style="padding-bottom:32px;">
        <p style="margin:0 0 12px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${categoryColour};">Why this matters right now</p>
        <p style="margin:0;font-size:15px;color:#F9FAFB;line-height:1.8;">
          ${insight}
        </p>
      </td></tr>

      <!-- cta -->
      <tr><td style="padding-bottom:32px;" align="center">
        <a href="${codexUrl}" style="display:inline-block;background:${categoryColour};color:#0A0F1E;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 32px;border-radius:4px;">
          View on The Codex →
        </a>
      </td></tr>

      <!-- footer -->
      <tr><td>
        <div style="height:1px;background:#1F2937;margin-bottom:20px;"></div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Courier New',monospace;font-size:10px;color:#374151;letter-spacing:0.06em;">
              The Codex · ${entries.length} mental models &amp; growing
            </td>
            <td align="right" style="font-family:'Courier New',monospace;font-size:10px;color:#374151;letter-spacing:0.06em;">
              <a href="https://rahulkarda.github.io/the-codex/" style="color:#374151;text-decoration:none;">the-codex</a>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:'Courier New',monospace;font-size:9px;color:#1F2937;letter-spacing:0.04em;">
          Origin: ${m.origin}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── send via Resend ───────────────────────────────────────────────────────────
async function sendEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'The Codex <onboarding@resend.dev>',
      to: [TO_EMAIL],
      subject,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data.id;
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  let insight;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🤖 Asking Gemini for insight (attempt ${attempt})...`);
      insight = await geminiInsight(model);
      if (insight) break;
    } catch (e) {
      console.error(`Gemini attempt ${attempt} failed:`, e.message);
      if (attempt === 3) throw e;
    }
  }

  const html = renderEmail(model, insight);
  const subject = `${model.name} — The Codex Daily`;

  if (DRY) {
    console.log('\n── DRY RUN — email HTML ──────────────────────────────────\n');
    console.log(html);
    console.log('\n── Subject:', subject);
    return;
  }

  console.log('📧 Sending via Resend...');
  const id = await sendEmail(subject, html);
  console.log(`✅ Sent! Resend ID: ${id}`);
  console.log(`   To: ${TO_EMAIL}`);
  console.log(`   Subject: ${subject}`);
})();
