/**
 * PathPilot — Protection Mode Route
 * ─────────────────────────────────────────────────────────────────────────────
 * Scam / wallet-drain detection with strict cost controls.
 *
 * FLOW:
 *   L0 (FREE)       → rule-based keyword + URL + page-signal scan
 *   L1 (Kimi)       → ONLY when L0 returns "suspicious" (NOT high_risk)
 *                     Hard timeout: 1200ms — fallback if exceeded
 *   L3 (Hermes)     → ONLY when user explicitly clicks "Why is this dangerous?"
 *                     Never auto-triggered.
 *
 * RISK PRIORITY (CRITICAL — never downgrade):
 *   high_risk > scam > suspicious > safe
 *   finalRisk = highest(L0, L1)
 *
 * FAILSAFE:
 *   Any error → { score: 50, status: "fallback", message: "Analyzing..." }
 */

import express from 'express';
import modelRouter from './modelRouter.js';
import { sanitizeInput } from '../utils/sanitize.js';

const router = express.Router();

// ── L0: Scam Pattern Databases (FREE — zero tokens) ──────────────────────────

const SCAM_KEYWORDS = [
  'airdrop',
  'claim reward',
  'free usdt',
  'connect wallet',
  'verify wallet',
  'seed phrase',
  'free crypto',
  'claim now',
  'wallet drain',
  'limited airdrop',
  'metamask required',
  'trust wallet',
];

const SUSPICIOUS_TLDS = ['.xyz', '.top', '.click', '.buzz', '.tk', '.ml', '.ga', '.cf'];

const SUSPICIOUS_SUBDOMAIN_RE = /^https?:\/\/[a-z0-9]{10,}-[a-z0-9]{4,}\./i;

const URGENCY_PHRASES = [
  'limited time',
  'act now',
  'expires in',
  'last chance',
  'hurry',
  'don\'t miss out',
  'only today',
];

/**
 * L0 Scam Check — pure rule-based, zero API cost.
 *
 * @param {string} url        - Page URL
 * @param {string} title      - Page title
 * @param {string} [bodyText] - Optional page body (first 400 chars max)
 * @returns {'safe'|'suspicious'|'high_risk'}
 */
function l0ScamCheck(url, title, bodyText = '') {
  const haystack = `${url} ${title} ${bodyText}`.toLowerCase();
  let riskScore = 0;

  // ── Keyword scan ──────────────────────────────────────────────────────────
  for (const kw of SCAM_KEYWORDS) {
    if (haystack.includes(kw)) {
      riskScore += 2;
      console.log(`[PROTECT L0] keyword hit: "${kw}"`);
    }
  }

  // ── Suspicious TLD ────────────────────────────────────────────────────────
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const tld of SUSPICIOUS_TLDS) {
      if (hostname.endsWith(tld)) {
        riskScore += 3;
        console.log(`[PROTECT L0] suspicious TLD: ${tld}`);
        break;
      }
    }

    // ── Long random subdomain ────────────────────────────────────────────────
    if (SUSPICIOUS_SUBDOMAIN_RE.test(url)) {
      riskScore += 2;
      console.log('[PROTECT L0] suspicious random subdomain pattern');
    }
  } catch (_) { /* invalid URL — ignore */ }

  // ── Urgency phrases ───────────────────────────────────────────────────────
  for (const phrase of URGENCY_PHRASES) {
    if (haystack.includes(phrase)) {
      riskScore += 1;
    }
  }

  console.log(`[PROTECT L0] total risk score: ${riskScore}`);

  if (riskScore >= 4) return 'high_risk';
  if (riskScore >= 2) return 'suspicious';
  return 'safe';
}

// ── L1 Scam Classifier (Kimi) — called ONLY when L0 returns "suspicious" ─────
// NEVER called when L0 = high_risk (skip AI entirely for max cost savings)

/** Hard timeout for L1 — matches spec: MAX WAIT = 1200ms */
const L1_TIMEOUT_MS = 1200;

/**
 * L1 Scam Classifier — uses Kimi via fast-path (max 60 tokens).
 * Input: URL + title only (never full page content).
 * Hard timeout: 1200ms — returns fallback immediately if exceeded.
 *
 * Returns: { risk: 'safe'|'suspicious'|'scam', reason: string }
 */
async function l1ScamClassify(url, title) {
  // Prompt forces decisive, non-vague output (max 8 words, never "unknown")
  const systemPrompt = `You are a scam detector. Classify the URL and title.
Return ONLY valid JSON, no markdown, no explanation:
{"risk":"safe"|"suspicious"|"scam","reason":"<max 8 words, concrete, specific>"}
Rules:
- risk=safe: legitimate known site
- risk=suspicious: unusual patterns but not confirmed
- risk=scam: confirmed wallet drain, phishing, fake airdrop
- NEVER output "unknown" as reason
- reason MUST be specific (e.g. "fake airdrop wallet drain pattern")
- reason MAX 8 words
- Be decisive — never hedge`;

  const userMessage = `URL: ${url}\nTitle: ${title}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage  },
  ];

  // Race L1 against hard 1200ms timeout
  let envelope;
  try {
    const result = await Promise.race([
      modelRouter.routeFastPath(messages, { json: true, maxTokens: 60 }),
      new Promise((resolve) =>
        setTimeout(() => resolve({ _timeout: true }), L1_TIMEOUT_MS)
      ),
    ]);

    if (result._timeout) {
      console.warn('[PROTECT L1] Timeout exceeded 1200ms — returning fallback immediately');
      return { risk: 'suspicious', reason: 'Classifier timeout — treat with caution.' };
    }
    envelope = result;
  } catch (_) {
    return { risk: 'suspicious', reason: 'Classification unavailable — treat with caution.' };
  }

  try {
    // Strip markdown fences if present
    const raw = (envelope.output || '').replace(/```json?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(raw);
    const risk   = ['safe', 'suspicious', 'scam'].includes(parsed.risk) ? parsed.risk : 'suspicious';
    // Never allow vague "unknown" reason through
    const reason = (typeof parsed.reason === 'string' && parsed.reason.trim() && parsed.reason.toLowerCase() !== 'unknown')
      ? parsed.reason.trim()
      : 'Unusual site patterns detected.';
    return { risk, reason };
  } catch (_) {
    return { risk: 'suspicious', reason: 'Could not parse classifier output.' };
  }
}

// ── Risk Priority Enforcer (CRITICAL — never allow downgrade) ─────────────────
// Priority order: high_risk > scam > suspicious > safe
// finalRisk = highest(L0, L1)

const RISK_RANK = { safe: 0, suspicious: 1, scam: 2, high_risk: 3 };

/**
 * Returns the higher-severity risk between L0 and L1 results.
 * Prevents any AI output from downgrading a rule-based detection.
 *
 * @param {'safe'|'suspicious'|'high_risk'} l0
 * @param {'safe'|'suspicious'|'scam'}      l1
 * @returns {'safe'|'suspicious'|'scam'|'high_risk'}
 */
function resolveRisk(l0, l1) {
  const r0 = RISK_RANK[l0]  ?? 0;
  const r1 = RISK_RANK[l1]  ?? 0;
  const winner = r0 >= r1 ? l0 : l1;
  console.log(`[PROTECT] Risk resolution: L0=${l0}(${r0}) L1=${l1}(${r1}) → FINAL=${winner}`);
  return winner;
}

// ── FAILSAFE ──────────────────────────────────────────────────────────────────

function protectFallback() {
  return {
    score:   50,
    status:  'fallback',
    message: 'Analyzing...',
  };
}

// ── POST /api/protect — main scam detection endpoint ─────────────────────────

router.post('/', async (req, res) => {
  try {
    const safeUrl   = sanitizeInput(req.body.url   || '');
    const safeTitle = sanitizeInput(req.body.title || '');
    // Accept limited body text — truncated to 400 chars to avoid token creep
    const safeBody  = sanitizeInput((req.body.bodyText || '').slice(0, 400));

    if (!safeUrl) {
      return res.json(protectFallback());
    }

    console.log(`[PROTECT] Scan — URL: ${safeUrl}`);

    // ── L0: Free rule check (zero tokens) ───────────────────────────────────
    const l0Result = l0ScamCheck(safeUrl, safeTitle, safeBody);
    console.log(`[PROTECT] L0 result: ${l0Result}`);

    // ── FAST EXIT: safe → respond immediately, no AI cost ───────────────────
    if (l0Result === 'safe') {
      return res.json({
        score:     100,
        status:    'safe',
        risk:      'safe',
        l0:        'safe',
        message:   'No scam signals detected.',
        modelUsed: 'rule-based',
      });
    }

    // ── FAST EXIT: high_risk → skip L1 entirely (no AI spend) ───────────────
    // L0 rule-based high_risk is definitive — AI cannot improve or reduce it.
    if (l0Result === 'high_risk') {
      console.log('[PROTECT] L0 high_risk — SKIPPING L1 (no AI cost)');
      return res.json({
        score:     5,
        status:    'high_risk',
        risk:      'high_risk',
        l0:        'high_risk',
        reason:    'Multiple scam indicators detected.',
        message:   '🚨 High Risk Detected: Possible wallet drain or scam attempt',
        modelUsed: 'rule-based',
      });
    }

    // ── L1: Kimi scam classifier — ONLY for "suspicious" (max 60 tokens) ────
    // Hard timeout enforced inside l1ScamClassify (1200ms).
    console.log('[PROTECT] L0 suspicious → calling L1 Kimi (1200ms timeout)');
    const l1Result = await l1ScamClassify(safeUrl, safeTitle);
    console.log(`[PROTECT] L1 result: ${JSON.stringify(l1Result)}`);

    // ── Risk Priority: NEVER allow downgrade ────────────────────────────────
    const finalRisk = resolveRisk(l0Result, l1Result.risk);

    // Map finalRisk → response fields
    const score   = finalRisk === 'high_risk' ? 5
                  : finalRisk === 'scam'      ? 10
                  : finalRisk === 'suspicious'? 35
                  : 70;

    const message = (finalRisk === 'high_risk' || finalRisk === 'scam')
      ? '🚨 High Risk Detected: Possible wallet drain or scam attempt'
      : finalRisk === 'suspicious'
      ? '⚠️ Suspicious Signals: This page shows unusual patterns'
      : '✅ Safe Site: No scam patterns detected';

    return res.json({
      score,
      status:    finalRisk,
      risk:      finalRisk,
      l0:        l0Result,
      l1:        l1Result.risk,
      reason:    l1Result.reason,
      message,
      modelUsed: 'kimi-l1',
    });

  } catch (error) {
    console.error('[PROTECT] Error — returning fallback:', error.message);
    return res.json(protectFallback());
  }
});

// ── POST /api/protect/explain — L3 Hermes deep explanation (user-triggered only)

router.post('/explain', async (req, res) => {
  try {
    const safeUrl   = sanitizeInput(req.body.url   || '');
    const safeTitle = sanitizeInput(req.body.title || '');

    if (!safeUrl) {
      return res.json({ explanation: 'No URL provided for analysis.' });
    }

    console.log(`[PROTECT L3] User requested explanation for: ${safeUrl}`);

    // L3 Hermes — max 120 tokens per spec, user-initiated only
    const systemPrompt = `You are a cybersecurity expert. Explain why this site is dangerous.
Return ONLY valid JSON, no markdown:
{"explanation":"2-3 sentences, specific and concrete","threatType":"phishing|wallet_drain|fake_airdrop|social_engineering","severity":"low|medium|high"}
Rules: be specific, name actual threat patterns, never say "unknown", always commit to a severity.`;
    const userMessage  = `URL: ${safeUrl}\nTitle: ${safeTitle}`;

    const result = await modelRouter.hermesAgentSuggest(systemPrompt, userMessage);

    return res.json({
      explanation: result.explanation || 'Suspicious patterns detected. Avoid connecting wallets.',
      threatType:  result.threatType  || 'unknown',
      severity:    result.severity    || 'high',
      modelUsed:   result.modelUsed,
      latency:     result.latency,
    });

  } catch (error) {
    console.error('[PROTECT L3] Explain error:', error.message);
    return res.json({
      explanation: 'This site exhibits suspicious patterns typical of scam operations. Do not connect any wallets.',
      threatType:  'unknown',
      severity:    'high',
    });
  }
});

export default router;
