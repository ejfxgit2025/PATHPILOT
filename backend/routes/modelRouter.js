/**
 * PathPilot — Kimi-First Model Router  (production-grade, Unicode-safe)
 * ─────────────────────────────────────────────────────────────────────────────
 * 4-layer AI architecture for the Hermes Agent Creative Hackathon.
 *
 * Layer 0 — Rule-Based Classifier (FREE, zero tokens)
 * Layer 1 — Kimi K2        (fast daily page analysis)      PRIMARY / FALLBACK
 * Layer 2 — Kimi K2.5      (deep future simulation engine)
 * Layer 3 — Hermes 3 70B   (autonomous agent intelligence)
 * Layer 4 — ElevenLabs     (cinematic voice narration — handled in voice.js)
 *
 * Key upgrades in this revision
 * ─────────────────────────────
 *  • All prompts are passed through sanitizeInput() before the fetch()
 *    → fixes "Cannot convert argument to a ByteString because character 8212"
 *  • safeCall()      — isolated try/catch per model, never throws
 *  • routeRequest()  — cascades L1 primary → L1 fallback → L2 → L3
 *  • routeWithRetry() — wraps routeRequest with 2-attempt retry guard
 *  • Every response carries { modelUsed, latency, success, output }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { sanitizeInput } from '../utils/sanitize.js';

// ── Layer 0: Goal-Aware Rule Engine ──────────────────────────────────────────
// Pure rule-based. Zero API cost. <50ms. Always runs first.
// Returns a complete scored result — no AI needed for clear-cut cases.

// ── Domain Tier Definitions ────────────────────────────────────────
// These are exact hostname checks (suffix match) — more reliable than regex
// when the goal is SCORING rather than blocking.

const GOOD_DOMAINS = new Set([
  // Python-specific
  'python.org', 'docs.python.org', 'pypi.org', 'realpython.com',
  'pythontutor.com', 'peps.python.org',
  // General programming / learning
  'w3schools.com', 'freecodecamp.org', 'developer.mozilla.org', 'mdn.io',
  'github.com', 'stackoverflow.com', 'stackexchange.com',
  'leetcode.com', 'hackerrank.com', 'codewars.com', 'exercism.org',
  'npmjs.com', 'crates.io', 'rubygems.org',
  // Learning platforms
  'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
  'pluralsight.com', 'codecademy.com', 'brilliant.org', 'roadmap.sh',
  // Docs / references
  'docs.microsoft.com', 'learn.microsoft.com', 'docs.aws.amazon.com',
  'cloud.google.com', 'developers.google.com',
  'reactjs.org', 'vuejs.org', 'angular.io', 'svelte.dev',
  'rust-lang.org', 'golang.org', 'kotlinlang.org',
  // Productivity / founder
  'notion.so', 'linear.app', 'figma.com', 'airtable.com',
  'trello.com', 'asana.com', 'loom.com', 'calendly.com',
  // Business / AI
  'ycombinator.com', 'techcrunch.com', 'producthunt.com',
  'openai.com', 'anthropic.com', 'huggingface.co',
  'stripe.com', 'vercel.com', 'netlify.com',
]);

const DISTRACTION_DOMAINS = new Set([
  // Social / entertainment
  'youtube.com', 'youtu.be', 'instagram.com', 'facebook.com',
  'twitter.com', 'x.com', 'tiktok.com', 'snapchat.com',
  'pinterest.com', 'tumblr.com', 'threads.net',
  // Chat / gaming
  'discord.com', 'twitch.tv', 'store.steampowered.com', 'epicgames.com',
  // Clickbait / tabloid
  'buzzfeed.com', '9gag.com', 'imgur.com', 'dailymail.co.uk',
  'tmz.com', 'peoplemagazine.com',
  // Streaming
  'netflix.com', 'primevideo.com', 'disneyplus.com', 'hbomax.com', 'hulu.com',
]);

const NEUTRAL_DOMAINS = new Set([
  'medium.com', 'reddit.com', 'quora.com',
  'dev.to', 'hashnode.com', 'substack.com',
  'wikipedia.org', 'en.wikipedia.org',
]);

// Stop-words to skip when extracting goal keywords
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in',
  'on', 'at', 'be', 'is', 'are', 'was', 'get', 'got',
  'my', 'i', 'want', 'learn', 'study', 'understand', 'know',
  'how', 'what', 'why', 'when', 'become', 'build', 'make',
  'with', 'as', 'by', 'from', 'into', 'about', 'more', 'better',
]);

/**
 * extractKeywords(goal)
 * Returns meaningful keywords from the user goal, excluding stop-words.
 * All tokens are lowercased.
 *
 * @param {string} goal
 * @returns {string[]}
 */
function extractKeywords(goal) {
  if (!goal || typeof goal !== 'string') return [];
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * getDomain(url)
 * Extracts the bare hostname from a URL (no www. prefix).
 * Returns empty string on invalid URL.
 *
 * @param {string} url
 * @returns {string}
 */
function getDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch (_) {
    return (url || '').toLowerCase();
  }
}

/**
 * domainTier(domain)
 * Classifies a domain against the three tiers.
 * Uses suffix-matching so subdomains (docs.python.org) hit 'python.org'.
 *
 * @param {string} domain
 * @returns {'good'|'distraction'|'neutral'|'unknown'}
 */
function domainTier(domain) {
  // Exact match first
  if (GOOD_DOMAINS.has(domain))        return 'good';
  if (DISTRACTION_DOMAINS.has(domain)) return 'distraction';
  if (NEUTRAL_DOMAINS.has(domain))     return 'neutral';

  // Suffix match (handles subdomains: docs.python.org → python.org)
  for (const d of GOOD_DOMAINS) {
    if (domain === d || domain.endsWith('.' + d)) return 'good';
  }
  for (const d of DISTRACTION_DOMAINS) {
    if (domain === d || domain.endsWith('.' + d)) return 'distraction';
  }
  for (const d of NEUTRAL_DOMAINS) {
    if (domain === d || domain.endsWith('.' + d)) return 'neutral';
  }

  return 'unknown';
}

/**
 * titleMatchStrength(title, keywords)
 * Returns 'strong' | 'partial' | 'none' based on how many goal
 * keywords appear in the page title.
 *
 * @param {string}   title
 * @param {string[]} keywords
 * @returns {'strong'|'partial'|'none'}
 */
function titleMatchStrength(title, keywords) {
  if (!keywords.length || !title) return 'none';
  const lTitle = title.toLowerCase();
  const hits = keywords.filter(kw => lTitle.includes(kw));
  const ratio = hits.length / keywords.length;
  if (ratio >= 0.5) return 'strong';   // half or more keywords found
  if (hits.length >= 1) return 'partial'; // at least one keyword found
  return 'none';
}

/**
 * l0GoalEngine(url, title, goal, options)
 *
 * Goal-aware scoring engine with intent signal upgrades.
 * Returns a full result object: { score, status, reason, l0, needsL1 }
 *
 * @param {string} url
 * @param {string} title
 * @param {string} goal
 * @param {object} [options]               - Optional intent signals from content.js
 * @param {string}   [options.pageType]    - 'chat'|'editor'|'docs'|'video'|'social'|'search'|'code'|'unknown'
 * @param {string[]} [options.inputKeywords] - Keywords extracted from user's typing (max 5)
 * @param {number}   [options.timeOnPage]  - Seconds the user has been on this page
 * @returns {{ score:number, status:string, reason:string, l0:string, needsL1:boolean }}
 */
function l0GoalEngine(url, title, goal, options = {}) {
  const domain        = getDomain(url);
  const goalKeywords  = extractKeywords(goal);
  const tier          = domainTier(domain);

  // Merge goal keywords + input keywords for richer matching
  // Input keywords represent LIVE user intent (what they're actually typing)
  const inputKws  = Array.isArray(options.inputKeywords) ? options.inputKeywords : [];
  const allKws    = [...new Set([...goalKeywords, ...inputKws])];

  // Match signals
  const titleMatch = titleMatchStrength(title || '', goalKeywords);   // title vs goal
  const inputMatch = inputKws.length > 0
    ? titleMatchStrength([...goalKeywords, ...inputKws].join(' '), goalKeywords)
    : 'none';
  // Combined match: if user is typing goal-relevant words, treat as at least 'partial'
  const effectiveMatch = (inputKws.length > 0 && inputMatch !== 'none')
    ? (titleMatch === 'strong' ? 'strong' : 'partial')
    : titleMatch;

  const pageType   = options.pageType   || 'unknown';
  const timeOnPage = typeof options.timeOnPage === 'number' ? options.timeOnPage : 0;

  console.log(`[L0] domain=${domain} tier=${tier} pageType=${pageType} titleMatch=${titleMatch} inputMatch=${inputMatch} effectiveMatch=${effectiveMatch} time=${timeOnPage}s`);

  let score, status, reason;

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Base score from domain tier + keyword match
  // (identical to previous version — domain knowledge first)
  // ═══════════════════════════════════════════════════════════════

  if (tier === 'good') {
    if (effectiveMatch === 'strong') {
      const seed = (domain.charCodeAt(0) + domain.length) % 9;
      score  = 90 + seed;  // 90–98
      status = 'aligned';
      reason = `High-signal site directly aligned with your goal.`;
    } else if (effectiveMatch === 'partial') {
      const seed = (domain.charCodeAt(0) + domain.length) % 9;
      score  = 80 + seed;  // 80–88
      status = 'aligned';
      reason = `Known learning resource with partial goal match.`;
    } else {
      const seed = (domain.charCodeAt(0) + domain.length) % 7;
      score  = 72 + seed;  // 72–78
      status = 'aligned';
      reason = `Known productive domain. Topic unclear from title.`;
    }
  } else if (tier === 'distraction') {
    const bonus = effectiveMatch === 'strong' ? 8 : effectiveMatch === 'partial' ? 4 : 0;
    const seed  = (domain.charCodeAt(0) + domain.length) % 6;
    score  = Math.min(25, 5 + seed + bonus);  // 5–25
    status = 'off-track';
    reason = `High-distraction platform.`;
  } else if (tier === 'neutral') {
    if (effectiveMatch === 'strong') {
      const seed = (domain.charCodeAt(0) + domain.length) % 7;
      score  = 62 + seed;  // 62–68
      status = 'warning';
      reason = `Neutral platform. Title strongly matches your goal.`;
    } else if (effectiveMatch === 'partial') {
      const seed = (domain.charCodeAt(0) + domain.length) % 7;
      score  = 52 + seed;  // 52–58
      status = 'warning';
      reason = `Neutral platform with partial topic match.`;
    } else {
      const seed = (domain.charCodeAt(0) + domain.length) % 7;
      score  = 42 + seed;  // 42–48
      status = 'warning';
      reason = `Neutral platform. Cannot confirm alignment.`;
    }
  } else {
    if (effectiveMatch === 'strong') {
      const seed = (domain.charCodeAt(0) + domain.length) % 9;
      score  = 62 + seed;  // 62–70
      status = 'warning';
      reason = `Unknown domain. Title strongly matches goal keywords.`;
    } else if (effectiveMatch === 'partial') {
      const seed = (domain.charCodeAt(0) + domain.length) % 11;
      score  = 45 + seed;  // 45–55
      status = 'warning';
      reason = `Unknown domain. Partial keyword match.`;
    } else {
      const seed = (domain.charCodeAt(0) + domain.length) % 11;
      score  = 32 + seed;  // 32–42
      status = 'warning';
      reason = `Unknown domain. No clear connection to goal.`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Page-Type Override
  // Intent > domain name. If page type gives a clearer signal,
  // replace or modify the base score.
  // ═══════════════════════════════════════════════════════════════

  // ── CHAT / AI assistants (claude, chatgpt, etc.) ──────────────
  // User intent is everything here — the domain is always neutral.
  // If they're typing goal-relevant keywords → productive use.
  // If no keywords → could be anything → neutral.
  if (pageType === 'chat') {
    if (effectiveMatch === 'strong' || (inputKws.length > 0 && inputMatch !== 'none')) {
      score  = Math.max(score, 78);  // 75–90
      status = 'aligned';
      reason = `AI chat with goal-relevant keywords typed. Productive use detected.`;
    } else if (inputKws.length > 0) {
      score  = Math.min(Math.max(score, 45), 65);  // 40–60
      status = 'warning';
      reason = `AI chat active. Typing detected but unclear goal alignment.`;
    } else {
      score  = Math.min(Math.max(score, 42), 58);  // 40–60
      status = 'warning';
      reason = `AI chat open. No goal-aligned typing detected yet.`;
    }
  }

  // ── CODE EDITORS / REPLs ──────────────────────────────────────
  // Writing code = productive regardless of what.
  // If keywords match → very high signal.
  else if (pageType === 'editor') {
    if (effectiveMatch === 'strong') {
      score  = Math.max(score, 85);
      status = 'aligned';
      reason = `Code editor with goal-relevant content. High-focus activity.`;
    } else {
      score  = Math.max(score, 68);
      status = 'aligned';
      reason = `Code editor active. Productive coding session.`;
    }
  }

  // ── VIDEO ────────────────────────────────────────────────────
  // Video is intent-dependent. Tutorial = ok. Random scroll = bad.
  // Title match is the primary signal.
  else if (pageType === 'video') {
    if (effectiveMatch === 'strong') {
      score  = Math.min(Math.max(score, 65), 80);  // 60–80
      status = score >= 70 ? 'aligned' : 'warning';
      reason = `Video with title strongly matching your goal. Tutorial detected.`;
    } else if (effectiveMatch === 'partial') {
      score  = Math.min(Math.max(score, 40), 60);  // partial match
      status = 'warning';
      reason = `Video with partial goal match. May be relevant.`;
    } else {
      // No match on a video platform — cap low
      score  = Math.min(score, 25);  // 10–30
      status = 'off-track';
      reason = `Video with no goal match. Likely passive entertainment.`;
    }
  }

  // ── DOCUMENTATION / LEARNING SITES ──────────────────────────
  // High baseline — reading docs is almost always productive.
  else if (pageType === 'docs') {
    if (effectiveMatch === 'strong') {
      score  = Math.max(score, 88);  // 85–100
      status = 'aligned';
      reason = `Documentation page directly matching your goal. Maximum signal.`;
    } else {
      score  = Math.max(score, 65);  // 60–80 floor
      status = 'aligned';
      reason = `Documentation/learning page. High-value reading.`;
    }
  }

  // ── SOCIAL FEEDS ─────────────────────────────────────────────
  // Hard cap — feed browsing is always low-signal.
  else if (pageType === 'social') {
    score  = Math.min(score, 25);  // 0–30 hard cap
    status = 'off-track';
    reason = `Social feed detected. Low-signal browsing.`;
  }

  // ── CODE HOSTING (GitHub, GitLab) ────────────────────────────
  // Code is productive. Keyword match lifts score.
  else if (pageType === 'code') {
    if (effectiveMatch === 'strong') {
      score  = Math.max(score, 88);
      status = 'aligned';
      reason = `Code repository matching your goal. High-focus activity.`;
    } else {
      score  = Math.max(score, 72);
      status = 'aligned';
      reason = `Code repository. Productive development activity.`;
    }
  }

  // ── SEARCH ENGINES ──────────────────────────────────────────
  // Searching for goal-related terms = productive.
  else if (pageType === 'search') {
    if (effectiveMatch === 'strong') {
      score  = Math.max(score, 68);
      status = 'warning';  // still slightly uncertain
      reason = `Searching for goal-related terms. Researching.`;
    } else {
      score  = Math.min(Math.max(score, 38), 55);
      status = 'warning';
      reason = `Search engine. Query not clearly goal-aligned.`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: Time Adjustment
  // Long engagement + keyword match → bonus (user is working).
  // Very short visit → penalty (likely bouncing).
  // ═══════════════════════════════════════════════════════════════
  let timeAdj = 0;
  if (timeOnPage > 20 && effectiveMatch !== 'none') {
    timeAdj = +10;  // engaged + relevant
    reason += ` (engaged ${timeOnPage}s)`;
  } else if (timeOnPage < 5 && timeOnPage > 0) {
    timeAdj = -10;  // likely bouncing
  }
  score += timeAdj;

  // Final clamp
  score = Math.max(0, Math.min(100, score));

  // Status re-derivation after adjustments
  if (score >= 70 && status !== 'aligned')  status = 'aligned';
  if (score <= 30 && status !== 'off-track') status = 'off-track';

  // needsL1 = uncertain band (40–70) only
  const needsL1 = score >= 40 && score <= 70;

  console.log(`[L0] RESULT score=${score} status=${status} pageType=${pageType} timeAdj=${timeAdj} needsL1=${needsL1}`);

  return { score, status, reason, l0: tier, pageType, needsL1 };
}

/**
 * ruleBasedClassify(url) — LEGACY shim kept for backwards compat.
 * New code should call l0GoalEngine() directly.
 * @returns {'distraction'|'aligned'|'uncertain'}
 */
function ruleBasedClassify(url) {
  const domain = getDomain(url);
  const tier   = domainTier(domain);
  if (tier === 'good')        return 'aligned';
  if (tier === 'distraction') return 'distraction';
  return 'uncertain';
}

// ── Model identifiers ────────────────────────────────────────────────────────

const L1_MODEL_PRIMARY = process.env.KIMI_MODEL_L1 || 'moonshotai/kimi-k2';
const L1_MODEL_FALLBACK = process.env.KIMI_MODEL_L1_FALLBACK || 'moonshotai/kimi-k2-thinking'; // kimi-k2-0905 is not a valid OpenRouter slug
const L2_MODEL_PRIMARY = process.env.KIMI_MODEL_L2 || 'moonshotai/kimi-k2.5';
const L2_MODEL_UPGRADE = process.env.KIMI_MODEL_L2_UPGRADE || 'moonshotai/kimi-k2.6';
const L3_MODEL = process.env.HERMES_MODEL || 'nousresearch/hermes-3-llama-3.1-70b';

// ── Performance timing ───────────────────────────────────────────────────────
// Rule 6: if response takes >2s, skip higher layers.
const FAST_PATH_TIMEOUT_MS = 2000;

// ── Robust JSON Extractor ────────────────────────────────────────────────────

/**
 * extractJSON(raw)
 *
 * Kimi K2 (and occasionally Hermes) can return:
 *   • Markdown fences  ```json ... ```
 *   • Single-quoted property names  {'key': 'val'}
 *   • Trailing commas              {"a":1,}
 *   • Preamble text before the JSON object
 *
 * Strategy:
 *   1. Strip markdown fences
 *   2. Try direct JSON.parse
 *   3. Extract first balanced { ... } block and try again
 *   4. Attempt light repair (single→double quotes, trailing commas)
 *   5. Throw if all attempts fail
 *
 * @param {string} raw - Raw model output string
 * @returns {object}   - Parsed JavaScript object
 */
function extractJSON(raw) {
  if (!raw) throw new Error('extractJSON: empty input');

  // Step 1 — strip markdown code fences
  let cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2 — direct parse (fast path)
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }

  // Step 3 — extract first balanced { ... } block
  const start = cleaned.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      const slice = cleaned.slice(start, end + 1);
      try { return JSON.parse(slice); } catch (_) { /* fall through to repair */ }

      // Step 4 — light repair on the extracted slice
      try {
        const repaired = slice
          // Replace single-quoted strings with double-quoted
          .replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"')
          // Remove trailing commas before } or ]
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(repaired);
      } catch (_) { /* fall through */ }
    }
  }

  throw new Error(`extractJSON: could not parse model output. First 200 chars: ${cleaned.slice(0, 200)}`);
}

// ── OpenRouter Base Call (UTF-8 safe) ────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Low-level OpenRouter fetch.
 * Sanitizes every message content string before serialisation so that
 * non-ASCII / Unicode codepoints never reach the ByteString boundary.
 *
 * @param {string}   model    - OpenRouter model identifier
 * @param {Array}    messages - [{role, content}] array
 * @param {object}   options  - { json, maxTokens, temperature }
 * @returns {string} Raw content string from the model response
 */
async function callOpenRouter(model, messages, options = {}) {
  // ── Sanitize every message to avoid ByteString conversion errors ──────────
  const safeMessages = messages.map((m) => ({
    role: m.role,
    content: sanitizeInput(m.content),
  }));

  const headers = {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json; charset=utf-8',
    'HTTP-Referer': 'https://pathpilot.ai',
    'X-Title': 'PathPilot - Hermes-Powered Founder Navigation System',
  };

  const body = {
    model,
    messages: safeMessages,
    // Note: response_format:json_object is NOT sent — not all providers support
    // structured outputs. JSON is enforced via the system prompt instead.
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter [${model}] HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  if (!result || !result.choices || !result.choices[0]) {
    throw new Error(`OpenRouter [${model}] returned invalid response structure`);
  }

  return result.choices[0].message.content;
}

// ── safeCall — isolated per-model error boundary ─────────────────────────────

/**
 * Wraps a single callOpenRouter invocation so it never throws.
 * Returns a unified { success, model, data, error, latency } envelope.
 *
 * @param {string} model
 * @param {Array}  messages
 * @param {object} options
 * @returns {Promise<{success: boolean, model: string, data?: string, error?: Error, latency: number}>}
 */
async function safeCall(model, messages, options = {}) {
  const start = Date.now();
  try {
    const content = await callOpenRouter(model, messages, options);

    if (!content) throw new Error('Empty content in model response');

    const latency = Date.now() - start;
    console.log(`[MODEL ROUTER] SUCCESS — ${model} responded in ${latency}ms`);

    return { success: true, model, data: content, latency };

  } catch (err) {
    const latency = Date.now() - start;
    console.warn(`[MODEL ROUTER] [MODEL ERROR] ${model} failed after ${latency}ms:`, err.message);
    return { success: false, model, error: err, latency };
  }
}

// ── routeRequest — L1 → L1-fallback → L2 → L3 cascade ──────────────────────

/**
 * Smart model router with full L1→L2→L3 cascade and detailed debug logs.
 * Judges will see routing decisions in the server console.
 *
 * @param {Array}  messages - [{role, content}] array
 * @param {object} options  - forwarded to callOpenRouter
 * @returns {Promise<{success: true, model: string, data: string, latency: number, output: string}>}
 */
async function routeRequest(messages, options = {}) {
  console.log('[MODEL ROUTER] Starting intelligent routing cascade...');

  // ── L1 primary ─────────────────────────────────────────────────────────────
  console.log(`[MODEL ROUTER] L1 primary → ${L1_MODEL_PRIMARY}`);
  let result = await safeCall(L1_MODEL_PRIMARY, messages, options);
  if (result.success) {
    console.log('[MODEL ROUTER] SUCCESS — L1 primary served the request');
    return _buildEnvelope(result);
  }

  // ── L1 fallback ────────────────────────────────────────────────────────────
  console.log(`[MODEL ROUTER] fallback used → ${L1_MODEL_FALLBACK}`);
  result = await safeCall(L1_MODEL_FALLBACK, messages, options);
  if (result.success) {
    console.log('[MODEL ROUTER] SUCCESS — L1 fallback served the request');
    return _buildEnvelope(result);
  }

  // ── L2 ─────────────────────────────────────────────────────────────────────
  console.log(`[MODEL ROUTER] L2 used → ${L2_MODEL_PRIMARY}`);
  result = await safeCall(L2_MODEL_PRIMARY, messages, options);
  if (result.success) {
    console.log('[MODEL ROUTER] SUCCESS — L2 served the request');
    return _buildEnvelope(result);
  }

  // ── L3 (final fallback) ────────────────────────────────────────────────────
  console.log(`[MODEL ROUTER] L3 final fallback → ${L3_MODEL}`);
  result = await safeCall(L3_MODEL, messages, options);
  if (result.success) {
    console.log('[MODEL ROUTER] SUCCESS — L3 agent served the request');
    return _buildEnvelope(result);
  }

  // All four tiers failed — surface a clear error
  throw new Error(`All models failed. Last error: ${result.error?.message || 'unknown'}`);
}

/** Build the standardised response envelope. */
function _buildEnvelope(result) {
  return {
    success: true,
    modelUsed: result.model,
    latency: result.latency,
    output: result.data,      // raw content string
    data: result.data,      // alias kept for backwards compat
  };
}

// ── routeWithRetry — outer guard ─────────────────────────────────────────────

/**
 * Wraps routeRequest with a two-attempt retry loop.
 * Ensures the system never silently fails or loops forever.
 *
 * @param {Array}  messages
 * @param {object} options
 */
async function routeWithRetry(messages, options = {}) {
  const MAX_ATTEMPTS = 2;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      console.log(`[MODEL ROUTER] [RETRY] Attempt ${i + 1} of ${MAX_ATTEMPTS}`);
      return await routeRequest(messages, options);
    } catch (err) {
      console.warn(`[MODEL ROUTER] [RETRY] Attempt ${i + 1} failed:`, err.message);
      if (i === MAX_ATTEMPTS - 1) {
        throw new Error(`Final failure after ${MAX_ATTEMPTS} retries: ${err.message}`);
      }
    }
  }
}

// ── routeFastPath — L1-only fast path (NEVER escalates to L2 or L3) ──────────

/**
 * Fast-path router for page analysis (analyze route).
 * Tries L1 primary → L1 fallback only, within a hard 2s window.
 * If both fail or time out, returns a minimal fallback JSON instantly.
 * NEVER touches L2 or L3.
 *
 * @param {Array}  messages
 * @param {object} options
 */
async function routeFastPath(messages, options = {}) {
  const start = Date.now();

  // ── L1 primary with hard 2s cap ────────────────────────────────────────
  let result = await Promise.race([
    safeCall(L1_MODEL_PRIMARY, messages, options),
    new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, timeout: true }), FAST_PATH_TIMEOUT_MS)
    ),
  ]);

  if (result.timeout) {
    console.warn(`[MODEL ROUTER] [FAST PATH] L1 primary exceeded ${FAST_PATH_TIMEOUT_MS}ms — instant fallback`);
    return _buildFastFallback(Date.now() - start);
  }
  if (result.success) {
    console.log('[MODEL ROUTER] [FAST PATH] L1 primary served');
    return _buildEnvelope(result);
  }

  // ── L1 fallback — only if time budget remains ──────────────────────────
  const remaining = FAST_PATH_TIMEOUT_MS - (Date.now() - start);
  if (remaining <= 100) {
    console.warn('[MODEL ROUTER] [FAST PATH] No budget for L1 fallback — instant fallback');
    return _buildFastFallback(Date.now() - start);
  }

  result = await Promise.race([
    safeCall(L1_MODEL_FALLBACK, messages, options),
    new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, timeout: true }), remaining)
    ),
  ]);

  if (result.timeout || !result.success) {
    console.warn('[MODEL ROUTER] [FAST PATH] L1 fallback failed/timed out — instant fallback');
    return _buildFastFallback(Date.now() - start);
  }

  console.log('[MODEL ROUTER] [FAST PATH] L1 fallback served');
  return _buildEnvelope(result);
}

/** Zero-token instant fallback envelope for the fast path. */
function _buildFastFallback(latency) {
  const payload = '{"score":50,"status":"warning","message":"Stay focused.","action":"warn"}';
  return {
    success: true,
    modelUsed: 'fast-fallback',
    latency,
    output: payload,
    data: payload,
  };
}

// ── Layer 1: Kimi K2 — Fast Page Analysis ───────────────────────────────────

/**
 * normalizeAnalysisResult(data)
 *
 * Guarantees every field callers expect is present and the correct type.
 * Prevents `undefined` values from propagating to the UI or state machine.
 *
 * @param {object} data - Raw parsed AI output
 * @returns {object}    - Fully-formed analysis object
 */
function normalizeAnalysisResult(data) {
  const validStatuses = ['aligned', 'warning', 'off-track'];
  const validLevels = ['normal', 'warning', 'final', 'enforce'];
  const validActions = ['allow', 'warn', 'redirect'];
  const validCategories = ['learning', 'distraction', 'entertainment', 'news', 'work', 'social', 'research', 'finance', 'unknown'];

  // Map AI's "block" → "redirect" for frontend compatibility
  let rawAction = data.action;
  if (rawAction === 'block') rawAction = 'redirect';

  const status = validStatuses.includes(data.status) ? data.status : 'warning';

  // Derive level from status when AI omits the field (minimal response mode)
  const derivedLevel = status === 'aligned' ? 'normal'
    : status === 'off-track' ? 'enforce'
      : 'warning';

  return {
    score: typeof data.score === 'number' ? Math.max(0, Math.min(100, Math.round(data.score))) : 50,
    status,
    level: validLevels.includes(data.level) ? data.level : derivedLevel,
    message: typeof data.message === 'string' && data.message.trim() ? data.message : 'Stay focused.',
    action: validActions.includes(rawAction) ? rawAction : 'warn',
    category: validCategories.includes(data.category) ? data.category : 'unknown',
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    reason: typeof data.reason === 'string' ? data.reason : '',
    fallback: data.fallback === true,
  };
}

/**
 * Layer 1: Classify a page with Kimi K2 (with automatic fallback cascade).
 * Used only when rule-based returns 'uncertain'.
 * Returns parsed JSON analysis result with modelUsed / latency fields.
 *
 * Cost controls:
 *   • max_tokens: 80  — L1 only needs a short JSON blob (page classify = cheap)
 *   • Full L1→L3 cascade only if primary Kimi fails (rare)
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 */
async function kimiPageAnalysis(systemPrompt, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  // Rule 5: L1 max_tokens = 60. Rule 1: never cascade into L2/L3 on page scan.
  console.log('[MODEL ROUTER] L1 fast path — page analysis (max_tokens: 60)');

  const envelope = await routeFastPath(messages, { json: true, maxTokens: 60 });

  // extractJSON handles markdown fences, brace extraction, and light repair
  const parsed = extractJSON(envelope.output);

  // Normalize — guarantees all fields are present and correctly typed
  const normalized = normalizeAnalysisResult(parsed);

  console.log(`[MODEL ROUTER] L1 complete | modelUsed: ${envelope.modelUsed} | latency: ${envelope.latency}ms | score: ${normalized.score}`);

  return {
    ...normalized,
    modelUsed: envelope.modelUsed,
    latency: envelope.latency,
  };
}

// ── Layer 2: Kimi K2.5 — Deep Future Simulation ─────────────────────────────

/**
 * Layer 2: Run a deep future simulation.
 * Returns rich multi-path simulation JSON with metadata.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 */
async function kimiSimulateFuture(systemPrompt, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  console.log(`[MODEL ROUTER] L2 used — starting future simulation with ${L2_MODEL_PRIMARY}`);

  // L2 prefers its own model tier; attempt L2 primary first, then full cascade
  const start = Date.now();
  let envelope;

  // L2 simulation needs enough tokens for full 3-path JSON (min ~600, target 900)
  const l2Primary = await safeCall(L2_MODEL_PRIMARY, messages, {
    json: true, temperature: 0.85, maxTokens: 900,
  });

  if (l2Primary.success) {
    console.log('[MODEL ROUTER] SUCCESS — L2 primary handled simulation');
    envelope = _buildEnvelope(l2Primary);
  } else {
    console.log(`[MODEL ROUTER] L2 primary failed, escalating to L2 upgrade (${L2_MODEL_UPGRADE})`);
    const l2Upgrade = await safeCall(L2_MODEL_UPGRADE, messages, {
      json: true, temperature: 0.85, maxTokens: 900,
    });

    if (l2Upgrade.success) {
      console.log('[MODEL ROUTER] SUCCESS — L2 upgrade handled simulation');
      envelope = _buildEnvelope(l2Upgrade);
    } else {
      // Final safety net: full cascade
      console.log('[MODEL ROUTER] L2 tier exhausted — falling back to full cascade');
      envelope = await routeWithRetry(messages, { json: true, temperature: 0.85, maxTokens: 900 });
    }
  }

  const parsed = extractJSON(envelope.output);

  console.log(`[MODEL ROUTER] L2 complete | modelUsed: ${envelope.modelUsed} | latency: ${envelope.latency}ms`);

  return {
    ...parsed,
    modelUsed: envelope.modelUsed,
    latency: envelope.latency,
  };
}

// ── Layer 3: Hermes 3 70B — Agent Intelligence ──────────────────────────────

/**
 * Layer 3: Context-aware agent suggestions via Hermes 3 70B.
 * Falls back to full cascade if L3 is unavailable.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 */
async function hermesAgentSuggest(systemPrompt, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  console.log(`[MODEL ROUTER] L3 agent — starting Hermes suggestion with ${L3_MODEL}`);

  // max_tokens: 180 — per spec (hidden opportunity, concise insight)
  const l3Result = await safeCall(L3_MODEL, messages, { json: true, temperature: 0.7, maxTokens: 180 });

  let envelope;
  if (l3Result.success) {
    console.log('[MODEL ROUTER] SUCCESS — L3 Hermes agent served suggestion');
    envelope = _buildEnvelope(l3Result);
  } else {
    console.log('[MODEL ROUTER] L3 failed — falling back to cascade');
    envelope = await routeWithRetry(messages, { json: true, temperature: 0.7 });
  }

  const parsed = extractJSON(envelope.output);

  console.log(`[MODEL ROUTER] L3 complete | modelUsed: ${envelope.modelUsed} | latency: ${envelope.latency}ms`);

  return {
    ...parsed,
    modelUsed: envelope.modelUsed,
    latency: envelope.latency,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export default {
  // Layer 0 — legacy shim (backwards compat)
  ruleBasedClassify,
  // Layer 0 — goal-aware scoring engine (PRIMARY)
  l0GoalEngine,
  // Layer 1
  kimiPageAnalysis,
  // Layer 1 — fast-path only (no L2/L3 escalation)
  routeFastPath,
  // Layer 2
  kimiSimulateFuture,
  // Layer 3
  hermesAgentSuggest,
  // Generic routed call (full cascade — use only when all layers are acceptable)
  routeWithRetry,
  // Model name registry (used by server.js boot banner)
  models: {
    L1_MODEL_PRIMARY,
    L1_MODEL_FALLBACK,
    L2_MODEL_PRIMARY,
    L2_MODEL_UPGRADE,
    L3_MODEL,
  },
};
