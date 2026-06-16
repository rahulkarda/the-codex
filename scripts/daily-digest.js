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

// ── email template (Preview A — Wide & Airy) ─────────────────────────────────
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
  const codexUrl = `https://rahulkarda.github.io/the-codex/#${m.id}`;
  const colour   = CATEGORY_COLOURS[m.category] || '#16A34A';
  const tintBg   = colour.replace('#', '%23'); // unused but kept for reference
  const dateStr  = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

  const label = `margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#9CA3AF;`;

  // Build howToApply as numbered rows — split on "N. " pattern
  const steps = m.howToApply.split(/(?<!\d)\d+\.\s+/).map(s => s.trim()).filter(Boolean);
  const applyRows = steps.length > 1
    ? steps.map((s, i) => {
        // Split "Bold title: rest" if present
        const colon = s.indexOf(':');
        const bold  = colon > 0 && colon < 40 ? `<strong>${esc(s.slice(0, colon))}:</strong> ${esc(s.slice(colon + 1).trim())}` : esc(s);
        return `<table cellpadding="0" cellspacing="0" style="margin-bottom:${i < steps.length - 1 ? '8px' : '36px'};width:100%;">
        <tr>
          <td style="width:36px;vertical-align:top;padding-top:1px;">
            <span style="display:inline-block;width:26px;height:26px;border-radius:50%;background:${colour};color:#fff;font-family:'Courier New',monospace;font-size:11px;font-weight:700;text-align:center;line-height:26px;">${i + 1}</span>
          </td>
          <td style="font-size:17px;color:#374151;line-height:1.85;padding-bottom:12px;">${bold}</td>
        </tr>
      </table>`;
      }).join('\n')
    : `<p style="margin:0 0 36px;font-size:17px;color:#374151;line-height:1.85;">${esc(m.howToApply)}</p>`;

  // Tint colour for example/insight backgrounds (hex + alpha via opacity div trick)
  const tintStyle = `background:${colour}12;`; // works in webmail, falls back to white

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.name)} — The Codex Daily</title>
</head>
<body style="margin:0;padding:0;background:#ECEFF4;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#ECEFF4;padding:48px 24px;">
<tr><td align="center">
<table width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 32px rgba(0,0,0,0.07);">

  <!-- top accent bar -->
  <tr><td style="background:${colour};height:5px;font-size:0;line-height:0;">&nbsp;</td></tr>

  <!-- header -->
  <tr><td style="padding:32px 56px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:12px;font-weight:700;color:${colour};letter-spacing:0.18em;text-transform:uppercase;">The Codex</td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:11px;color:#9CA3AF;letter-spacing:0.05em;">${esc(dateStr)} &nbsp;&middot;&nbsp; Daily Model</td>
    </tr></table>
  </td></tr>

  <!-- hero -->
  <tr><td style="padding:0 56px 36px;">
    <span style="display:inline-block;border:1.5px solid ${colour};color:${colour};font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:5px 16px;border-radius:20px;margin-bottom:20px;">${esc(m.category)}</span>
    <h1 style="margin:0 0 18px;font-size:42px;font-weight:800;color:#111827;line-height:1.1;letter-spacing:-0.025em;font-family:Georgia,serif;">${esc(m.name)}</h1>
    <p style="margin:0;font-size:20px;color:#374151;line-height:1.65;font-style:italic;padding-left:18px;border-left:4px solid ${colour};">${esc(m.oneLiner)}</p>
  </td></tr>

  <tr><td style="padding:0 56px;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>

  <!-- body -->
  <tr><td style="padding:36px 56px 0;">

    <p style="${label}">What it is</p>
    <p style="margin:0 0 36px;font-size:17px;color:#374151;line-height:1.85;">${esc(m.description)}</p>

    <p style="${label}">Real-world example</p>
    <div style="${tintStyle}border-left:4px solid ${colour};border-radius:0 8px 8px 0;padding:20px 24px;margin-bottom:36px;">
      <p style="margin:0;font-size:17px;color:#374151;line-height:1.85;">${esc(m.example)}</p>
    </div>

    <p style="${label}">How to apply it</p>
    ${applyRows}

    <p style="${label}">Common pitfall</p>
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:20px 24px;margin-bottom:36px;">
      <p style="margin:0;font-size:16px;color:#92400E;line-height:1.8;"><strong>&#9888; Watch out:</strong> ${esc(m.pitfalls)}</p>
    </div>

    <div style="height:1px;background:#E5E7EB;margin-bottom:36px;"></div>

    <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${colour};">Why this matters right now</p>
    <div style="${tintStyle}border-radius:10px;padding:24px 28px;margin-bottom:40px;">
      <p style="margin:0;font-size:17px;color:#111827;line-height:1.9;">${esc(insight)}</p>
    </div>

  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:0 56px 48px;" align="center">
    <a href="${codexUrl}" style="display:inline-block;background:${colour};color:#FFFFFF;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;text-decoration:none;padding:16px 40px;border-radius:8px;">Read on The Codex &rarr;</a>
  </td></tr>

  <!-- footer -->
  <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:24px 56px;border-radius:0 0 16px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:10px;color:#9CA3AF;">The Codex &middot; ${entries.length} models &amp; growing</td>
      <td align="right" style="font-family:'Courier New',monospace;font-size:10px;color:#9CA3AF;"><a href="https://rahulkarda.github.io/the-codex/" style="color:#9CA3AF;text-decoration:none;">rahulkarda.github.io/the-codex</a></td>
    </tr></table>
    <p style="margin:10px 0 0;font-family:'Courier New',monospace;font-size:9px;color:#D1D5DB;">Origin: ${esc(m.origin)}</p>
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
