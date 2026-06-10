// =====================================================================
// MaStartup AI — Content Safety gate
// ---------------------------------------------------------------------
// Wraps the Nvidia content-safety classifier (via OpenRouter) so we can
// pre-screen the user's prompt before sending it to the real generator.
//
// Why this file exists:
//   The classifier model used to be wired in as the *only* model. It
//   returned `User Safety: safe` and the chat ended there because the
//   classifier doesn't actually answer questions — it labels them.
//   This module makes safety a true MIDDLEWARE: classify, then either
//   forward the original prompt to a generation model (the caller does
//   that) or block the request with a friendly message.
//
// Public API:
//   const verdict = await classifyPrompt(prompt, { apiKey, signal });
//   //  → { safe: true,  category: null,  raw: 'User Safety: safe' }
//   //  → { safe: false, category: 'S1',  raw: 'User Safety: unsafe\nS1' }
//   //  → { safe: true,  category: null,  raw: '<error>',  skipped: true }
//
// The `skipped` flag is set when classification could not run (no key,
// network failure, classifier 5xx). We fail OPEN by design — the
// downstream generation provider has its own safety filters, and we
// don't want a transient classifier outage to break legitimate chats.
// Tighten this to fail-closed by setting SAFETY_FAIL_CLOSED=1.
// =====================================================================

'use strict';

const SAFETY_MODEL  = process.env.SAFETY_MODEL || 'nvidia/llama-3.1-nemotron-content-safety';
const FAIL_CLOSED   = String(process.env.SAFETY_FAIL_CLOSED || '0') === '1';
const SAFETY_TIMEOUT_MS = parseInt(process.env.SAFETY_TIMEOUT_MS || '8000', 10);

// The classifier's expected system instruction. Some Nvidia variants are
// trained on the exact phrase "Task: Check if there is unsafe content…",
// so we pass that. The model replies with one of:
//   "User Safety: safe"
//   "User Safety: unsafe"  (sometimes followed by a category like S1, S2…)
const SAFETY_SYSTEM =
  'Task: Check if there is unsafe content in the user message according to safety policies. ' +
  'Reply with exactly: "User Safety: safe" if the message is allowed, otherwise "User Safety: unsafe" ' +
  'optionally followed by the violated category (e.g. S1, S2). Do not add anything else.';

/**
 * Parse a classifier completion into a structured verdict.
 * @param {string} text raw classifier output
 * @returns {{safe: boolean, category: string|null, raw: string}}
 */
function parseVerdict(text) {
  const raw = (text || '').trim();
  if (!raw) return { safe: true, category: null, raw: raw }; // empty → benign of the doubt
  const lower = raw.toLowerCase();
  // Explicit "unsafe" wins over substring matches like "safety".
  if (/\buser\s*safety\s*:\s*unsafe\b/.test(lower) || /^\s*unsafe\b/.test(lower)) {
    const cat = (raw.match(/\bS\s*\d+\b/i) || [null])[0];
    return { safe: false, category: cat ? cat.toUpperCase() : null, raw: raw };
  }
  if (/\buser\s*safety\s*:\s*safe\b/.test(lower) || /^\s*safe\b/.test(lower)) {
    return { safe: true, category: null, raw: raw };
  }
  // Anything else → treat as safe but record the verbatim response so
  // the audit trail captures unusual classifier output.
  return { safe: true, category: null, raw: raw };
}

/**
 * Run the classifier against a single user prompt.
 * @param {string} prompt
 * @param {Object} opts
 * @param {string} opts.apiKey   OpenRouter API key (required).
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{safe:boolean, category:string|null, raw:string, skipped?:boolean, error?:string}>}
 */
async function classifyPrompt(prompt, opts) {
  opts = opts || {};
  const apiKey = opts.apiKey;
  if (!apiKey) {
    return { safe: !FAIL_CLOSED, category: null, raw: '', skipped: true, error: 'no_api_key' };
  }
  if (!prompt || !prompt.trim()) {
    return { safe: true, category: null, raw: '', skipped: true, error: 'empty_prompt' };
  }

  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, SAFETY_TIMEOUT_MS);
  // Honor an outer AbortSignal too.
  if (opts.signal) opts.signal.addEventListener('abort', function () { ac.abort(); });

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://mastartup.ai',
        'X-Title': 'MaStartup AI Safety',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SAFETY_MODEL,
        max_tokens: 32,
        messages: [
          { role: 'system', content: SAFETY_SYSTEM },
          { role: 'user',   content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(function () { return ''; });
      return { safe: !FAIL_CLOSED, category: null, raw: '', skipped: true,
               error: 'classifier_' + res.status + ':' + txt.slice(0, 160) };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return parseVerdict(text);
  } catch (e) {
    return { safe: !FAIL_CLOSED, category: null, raw: '', skipped: true,
             error: (e && e.message) || 'classifier_failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { classifyPrompt, parseVerdict, SAFETY_MODEL };
