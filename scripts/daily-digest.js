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

// ── env loader ───────────────────────────────────────────────────────────────
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

const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const TO_EMAIL     = process.env.DIGEST_TO_EMAIL;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (!GEMINI_KEY)             { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
if (!DRY && !RESEND_KEY)     { console.error('Missing RESEND_API_KEY'); process.exit(1); }
if (!DRY && !TO_EMAIL)       { console.error('Missing DIGEST_TO_EMAIL'); process.exit(1); }

// ── pick today's model ───────────────────────────────────────────────────────
function dayOfYear() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

const db      = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const entries = db.entries;
const model   = entries[dayOfYear() % entries.length];

console.log(`📖 Today's model: ${model.name} (${model.category})`);

// ── Gemini insight ───────────────────────────────────────────────────────────
async function geminiInsight(m) {
  const prompt = `You are writing a short insight paragraph for a daily mental-models email digest.

Today's model: "${m.name}"
Category: ${m.category}
One-liner: ${m.oneLiner}
Description: ${m.description}
How to apply: ${m.howToApply}

Write ONE paragraph (4–6 sentences).
- Connect this model to something concrete happening in tech, work, or everyday life in 2026.
- Name a specific industry, situation, or pattern people recognise.
- End with one actionable sentence starting with "Today, try..."
- Tone: sharp, direct, no fluff. Like a smart friend who reads a lot.
- Output the paragraph text only. No heading, no JSON, no markdown, no bullet points.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('No candidate returned from Gemini');

  // Concatenate all parts (Gemini can split across multiple part objects)
  const text = (candidate.content?.parts ?? [])
    .map(p => p.text ?? '')
    .join('')
    .trim();

  const finish = candidate.finishReason;
  if (finish && finish !== 'STOP') {
    console.warn(`⚠  Gemini finishReason: ${finish} — response may be truncated`);
  }
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "1. foo 2. bar 3. baz" → numbered list rows; plain text → single paragraph
function formatList(text, colour) {
  const parts = String(text ?? '').split(/(?<!\d)\d+\.\s+/).map(s => s.trim()).filter(Boolean);
  const pStyle = `margin:0 0 10px 0;font-size:16px;color:#374151;line-height:1.8;`;
  if (parts.length <= 1) {
    return `<p style="${pStyle}">${esc(text)}</p>`;
  }
  return parts.map((p, i) =>
    `<table cellpadding="0" cellspacing="0" style="margin-bottom:10px;width:100%;">
      <tr>
        <td style="width:28px;vertical-align:top;padding-top:2px;">
          <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${colour};color:#0A0F1E;font-family:'Courier New',monospace;font-size:10px;font-weight:700;text-align:center;line-height:22px;">${i + 1}</span>
        </td>
        <td style="font-size:16px;color:#374151;line-height:1.8;">${esc(p)}</td>
      </tr>
    </table>`
  ).join('\n');
}

// ── email template ───────────────────────────────────────────────────────────
const CATEGORY_COLOURS = {
  'Mental Model':           '#16A34A',
  'Cognitive Bias':         '#D97706',
  'Decision-Making':        '#2563EB',
  'Psychology Effect':      '#7C3AED',
  'Philosophy & Stoicism':  '#EA580C',
  'Productivity':           '#059669',
  'Focus & Habits':         '#0284C7',
  'Learning':               '#CA8A04',
  'Communication':          '#DB2777',
  'Social Dynamics':        '#9333EA',
  'Relationships':          '#E11D48',
  'Money & Time':           '#15803D',
  'Economics & Incentives': '#B45309',
  'Health & Longevity':     '#0D9488',
};

function renderEmail(m, insight) {
  const codexUrl  = `https://rahulkarda.github.io/the-codex/#${m.id}`;
  const colour    = CATEGORY_COLOURS[m.category] || '#16A34A';
  const colourBg  = colour + '14'; // ~8% opacity tint for backgrounds
  const dateStr   = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const labelStyle = `margin:0 0 6px 0;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#9CA3AF;`;
  const bodyText   = `font-size:16px;color:#374151;line-height:1.8;`;
  const divider    = `<tr><td style="padding:8px 0 24px 0;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.name)} — The Codex Daily</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- top accent bar -->
  <tr><td style="background:${colour};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- header -->
  <tr><td style="padding:28px 36px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:'Courier New',monospace;font-size:13px;font-weight:700;color:${colour};letter-spacing:0.14em;text-transform:uppercase;">
          The Codex
        </td>
        <td align="right" style="font-family:'Courier New',monospace;font-size:11px;color:#9CA3AF;letter-spacing:0.06em;">
          ${esc(dateStr)}
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- hero block -->
  <tr><td style="padding:0 36px 28px;">
    <div style="background:${colourBg};border-radius:10px;padding:28px 28px 24px;">

      <!-- category pill -->
      <div style="margin-bottom:16px;">
        <span style="display:inline-block;background:#FFFFFF;border:1.5px solid ${colour};color:${colour};font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:4px 14px;border-radius:20px;">
          ${esc(m.category)}
        </span>
      </div>

      <!-- model name -->
      <h1 style="margin:0 0 14px;font-size:32px;font-weight:800;color:#111827;line-height:1.15;letter-spacing:-0.02em;font-family:Georgia,serif;">
        ${esc(m.name)}
      </h1>

      <!-- one-liner -->
      <p style="margin:0;font-size:18px;color:#374151;line-height:1.6;font-style:italic;border-left:3px solid ${colour};padding-left:14px;">
        ${esc(m.oneLiner)}
      </p>
    </div>
  </td></tr>

  <!-- body sections -->
  <tr><td style="padding:0 36px;">
    <table width="100%" cellpadding="0" cellspacing="0">

      <!-- what it is -->
      <tr><td style="padding-bottom:24px;">
        <p style="${labelStyle}">What it is</p>
        <p style="${bodyText}margin:0;">${esc(m.description)}</p>
      </td></tr>

      ${divider}

      <!-- real example -->
      <tr><td style="padding-bottom:24px;">
        <p style="${labelStyle}">Real-world example</p>
        <div style="background:#F9FAFB;border-left:3px solid ${colour};border-radius:0 6px 6px 0;padding:16px 20px;">
          <p style="${bodyText}margin:0;">${esc(m.example)}</p>
        </div>
      </td></tr>

      ${divider}

      <!-- how to apply -->
      <tr><td style="padding-bottom:24px;">
        <p style="${labelStyle}">How to apply it</p>
        ${formatList(m.howToApply, colour)}
      </td></tr>

      ${divider}

      <!-- pitfall -->
      <tr><td style="padding-bottom:28px;">
        <p style="${labelStyle}">Common pitfall</p>
        <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:16px 20px;">
          <p style="margin:0;font-size:15px;color:#92400E;line-height:1.75;">
            <strong style="color:#B45309;">⚠ Watch out:</strong> ${esc(m.pitfalls)}
          </p>
        </div>
      </td></tr>

      ${divider}

      <!-- connecting insight -->
      <tr><td style="padding-bottom:32px;">
        <p style="${labelStyle.replace('#9CA3AF', colour)}">Why this matters right now</p>
        <div style="background:${colourBg};border-radius:8px;padding:20px 24px;">
          <p style="margin:0;font-size:16px;color:#111827;line-height:1.85;">
            ${esc(insight)}
          </p>
        </div>
      </td></tr>

    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 36px 36px;" align="center">
    <a href="${codexUrl}" style="display:inline-block;background:${colour};color:#FFFFFF;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 36px;border-radius:6px;">
      Read on The Codex &rarr;
    </a>
  </td></tr>

  <!-- footer -->
  <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 36px;border-radius:0 0 12px 12px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:'Courier New',monospace;font-size:10px;color:#9CA3AF;letter-spacing:0.05em;">
          The Codex &middot; ${entries.length} models &amp; growing
        </td>
        <td align="right" style="font-family:'Courier New',monospace;font-size:10px;color:#9CA3AF;letter-spacing:0.05em;">
          <a href="https://rahulkarda.github.io/the-codex/" style="color:#9CA3AF;text-decoration:none;">rahulkarda.github.io/the-codex</a>
        </td>
      </tr>
      <tr><td colspan="2" style="padding-top:8px;font-family:'Courier New',monospace;font-size:9px;color:#D1D5DB;letter-spacing:0.03em;">
        Origin: ${esc(m.origin)}
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

// ── send via Resend ──────────────────────────────────────────────────────────
async function sendEmail(subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'The Codex <onboarding@resend.dev>',
      to:      [TO_EMAIL],
      subject,
      html,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data.id;
}

// ── main ─────────────────────────────────────────────────────────────────────
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

  const html    = renderEmail(model, insight);
  const subject = `${model.name} — The Codex Daily`;

  if (DRY) {
    // Write to a temp file so it can be opened in a browser
    const outPath = path.join(ROOT, 'tmp-email-preview.html');
    fs.writeFileSync(outPath, html);
    console.log(`\n── DRY RUN ──────────────────────────────────────────────`);
    console.log(`   Subject : ${subject}`);
    console.log(`   Preview  : ${outPath}`);
    console.log(`   Open with: open ${outPath}`);
    return;
  }

  console.log('📧 Sending via Resend...');
  const id = await sendEmail(subject, html);
  console.log(`✅ Sent!  Resend ID : ${id}`);
  console.log(`          To        : ${TO_EMAIL}`);
  console.log(`          Subject   : ${subject}`);
})();
