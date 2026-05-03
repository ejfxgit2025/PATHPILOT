import express from 'express';
import modelRouter from './modelRouter.js';
import { sanitizeInput, cleanPageText } from '../utils/sanitize.js';

const router = express.Router();

// PathPilot — cinematic warning messages for each risk level
const DEVIATION_MESSAGES = {
  'off-track': [
    "This action delays your startup path by months.",
    "This distraction moves you further from your first million.",
    "This behavior increases your failure risk. Redirect now.",
    "Every minute here costs you future equity. Stop.",
    "This browsing pattern reduces your founder success probability.",
    "Founders who win don't browse here. Get back on path.",
    "This page has zero ROI on your life directive.",
  ],
  'warning': [
    "Low-signal activity detected. Stay disciplined.",
    "This is not your highest-leverage move right now.",
    "Marginal alignment with your life directive.",
    "Weak signal. Refocus on what moves the needle.",
    "This browsing pattern is reducing your momentum.",
    "Not aligned with your founder path. Recalibrate.",
  ]
};

function getDeviationMessage(status) {
  const pool = DEVIATION_MESSAGES[status] || DEVIATION_MESSAGES['warning'];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Map L0 status → full PathPilot status schema ─────────────────────────────
// l0GoalEngine returns: 'aligned' | 'off-track' | 'warning'
// PathPilot UI understands: 'aligned' | 'warning' | 'off-track'
// These map 1:1 — no conversion needed.

router.post('/', async (req, res) => {
  try {
    const { url, pageTitle, pageText } = req.body;
    const userGoal   = sanitizeInput(req.body.userGoal  || 'become a successful founder');
    const strictMode = req.body.strictMode === true || req.body.strictMode === 'true';

    // Sanitize all user-controlled strings
    const safeUrl       = sanitizeInput(url || '');
    const safePageTitle = sanitizeInput(pageTitle || 'Unknown Page');
    // cleanPageText kept for compatibility — not sent to L0 (URL + title only)
    const safePageText  = cleanPageText(pageText || 'No content available.');

    if (!url) {
      return res.status(400).json({ error: 'Missing url' });
    }

    const analysisStart = Date.now();

    console.log(`[PATHPILOT] SCAN — URL: ${safeUrl} | Goal: ${userGoal} | Discipline: ${strictMode}`);

    // ── Intent signals from content.js (new) ─────────────────────────────────
    const pageType     = typeof req.body.pageType === 'string' ? req.body.pageType : 'unknown';
    const inputKws     = Array.isArray(req.body.inputKeywords)  ? req.body.inputKeywords  : [];
    const timeOnPage   = typeof req.body.timeOnPage === 'number' ? req.body.timeOnPage : 0;

    // ── Layer 0: Goal-Aware Rule Engine (zero tokens, <50ms) ─────────────────
    // INPUT: URL + title + goal + intent signals (NO page content)
    // OUTPUT: { score, status, reason, l0, pageType, needsL1 }
    const l0 = modelRouter.l0GoalEngine(safeUrl, safePageTitle, userGoal, {
      pageType,
      inputKeywords: inputKws,
      timeOnPage,
    });
    console.log(`[PATHPILOT] L0 result: score=${l0.score} status=${l0.status} pageType=${l0.pageType} needsL1=${l0.needsL1}`);

    // ── FAST EXIT: clear-cut cases — never pay for AI ─────────────────────────
    // score > 70  → definitively aligned (GOOD domain)
    // score < 40  → definitively off-track (distraction or unknown/no-match)
    if (!l0.needsL1) {
      const level  = l0.status === 'off-track'
        ? (strictMode ? 'enforce' : 'warning')
        : 'normal';
      const action = l0.status === 'off-track'
        ? (strictMode ? 'redirect' : 'warn')
        : 'allow';
      const message = l0.status === 'off-track'
        ? getDeviationMessage('off-track')
        : l0.status === 'warning'
        ? getDeviationMessage('warning')
        : 'High-signal activity. You are on path.';

      const result = {
        score:     l0.score,
        status:    l0.status,
        level,
        message,
        action,
        category:  l0.l0 === 'distraction' ? 'distraction'
                 : l0.l0 === 'good'        ? 'work'
                 : 'unknown',
        suggestions: [],
        reason:    l0.reason,
        modelUsed: 'rule-based-l0',
        latency:   Date.now() - analysisStart,
      };
      console.log(`[PATHPILOT] L0 fast exit: score=${result.score} status=${result.status}`);
      return res.json(result);
    }

    // ── Layer 1: Kimi — ONLY for uncertain pages (score 40–70) ───────────────
    // Uses L0's score as the anchor. Kimi refines, never fully overrides.
    // max_tokens: 60 — spec requirement (cheap, fast)
    const disciplineInstruction = strictMode
      ? `Strict mode ON: any non-essential page is off-track.`
      : `Standard mode: loosely related = warning.`;

    const systemPrompt = `You are PathPilot. Rate if the URL and title align with the user goal.
${disciplineInstruction}
Return ONLY JSON (no markdown): {"score":0-100,"status":"aligned"|"warning"|"off-track","message":"max 5 words","action":"allow"|"warn"|"block"}
Directly useful=aligned/allow. Slight distraction=warning/warn. Unrelated=off-track/block.
Baseline score hint: ${l0.score}. Adjust by no more than 20 points from this baseline.
If uncertain: {"score":${l0.score},"status":"warning","message":"unclear focus","action":"warn"}`;

    const userMessage = `Goal: ${userGoal}\nURL: ${safeUrl}\nTitle: ${safePageTitle}`;

    console.log(`[PATHPILOT] L0 uncertain (score=${l0.score}) → calling L1 Kimi`);
    const parsedResult = await modelRouter.kimiPageAnalysis(systemPrompt, userMessage);
    console.log(`[MODEL ROUTER] L1 Kimi used: ${parsedResult.modelUsed}`);

    // ── Score anchor: never let Kimi stray more than 20pts from L0 baseline ──
    // Prevents AI hallucination from producing wildly wrong scores.
    const anchoredScore = Math.max(
      l0.score - 20,
      Math.min(l0.score + 20, parsedResult.score)
    );
    parsedResult.score = Math.max(0, Math.min(100, anchoredScore));

    // ── Strict mode server-side override (deterministic, never hallucinated) ──
    if (strictMode) {
      if (parsedResult.status === 'off-track') {
        parsedResult.level  = 'enforce';
        parsedResult.action = 'redirect';
        parsedResult.message = getDeviationMessage('off-track');
        if (parsedResult.score > 30) parsedResult.score = 30;
      } else if (parsedResult.status === 'warning') {
        parsedResult.level  = 'final';
        parsedResult.action = 'warn';
        parsedResult.message = getDeviationMessage('warning');
        if (parsedResult.score > 60) parsedResult.score = 60;
      }
    } else {
      if (parsedResult.action === 'redirect') parsedResult.action = 'warn';
      if (parsedResult.level === 'enforce')   parsedResult.level  = 'warning';
      if (parsedResult.status === 'off-track') {
        parsedResult.message = getDeviationMessage('off-track');
      } else if (parsedResult.status === 'warning') {
        parsedResult.message = getDeviationMessage('warning');
      }
    }

    // Attach L0 reason as extra context
    parsedResult.reason  = parsedResult.reason || l0.reason;
    parsedResult.latency = parsedResult.latency || (Date.now() - analysisStart);

    console.log(`[PATHPILOT] L1 complete: score=${parsedResult.score} status=${parsedResult.status} model=${parsedResult.modelUsed} latency=${parsedResult.latency}ms`);

    res.json(parsedResult);

  } catch (error) {
    console.error('[PATHPILOT] Analyze route error — returning safe fallback:', error);

    // ── HARD FALLBACK: always return HTTP 200 with a complete result object ──
    res.status(200).json({
      score:     50,
      status:    'warning',
      level:     'warning',
      message:   'System recovering — baseline analysis active.',
      action:    'warn',
      category:  'unknown',
      suggestions: [],
      reason:    'Backend encountered an error. Safe fallback response returned.',
      modelUsed: 'fallback',
      latency:   0,
      fallback:  true,
    });
  }
});

export default router;
