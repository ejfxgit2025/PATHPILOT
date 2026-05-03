/**
 * PathPilot — Simulation Route  (routes/simulate.js)
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/simulate
 *
 * Adaptive AI life navigation engine.
 * Constructs user identity, analyses behavior, simulates 3 diverging futures
 * (SAFE / GROWTH / RISK), and outputs Critical Intelligence.
 *
 * Body params
 * ─────────────────────────────────────────────────────────────────────────────
 *  directive / goal  — user's life directive (required)
 *  currentUrl        — current page being browsed
 *  focusTime         — ms on aligned sites this session
 *  wastedTime        — ms on distraction sites this session
 *  sessionDays       — how many days the user has been on PathPilot
 *  keyDecision       — optional specific decision to simulate
 */

import express from 'express';
import modelRouter from './modelRouter.js';
import { sanitizeInput } from '../utils/sanitize.js';
import { generatePaths } from '../utils/pathGenerator.js';

const router = express.Router();

const SIMULATION_TIMEOUT_MS = 30_000; // 30s — allows Kimi/Hermes to respond


// ── Adaptive Identity System Prompt ──────────────────────────────────────────

function buildCinematicPrompt(directive, behaviorCtx) {
  const behaviorSection = behaviorCtx
    ? `Current Behavior Context:
- Focus minutes today: ${behaviorCtx.focusMinutes}
- Distraction minutes today: ${behaviorCtx.wastedMinutes}
- Current URL: ${behaviorCtx.currentUrl}
- Days active: ${behaviorCtx.sessionDays}
- Key decision: ${behaviorCtx.keyDecision || 'none'}`
    : '';

  return `You are PathPilot — an advanced adaptive AI life navigation system embedded inside a real-time environment.

Your job is to interpret the user's CURRENT situation — NOT a fixed persona. You NEVER assume roles like founder, student, trader, etc. You dynamically construct identity from real context.

A user has declared this life directive: "${directive}"

${behaviorSection}

════════════════════════════════════════════
STEP 1 — BUILD REAL IDENTITY
════════════════════════════════════════════

Generate ONE precise identity sentence. Rules:
- Must reflect struggle, friction, or intent — NOT just the goal
- Must include their actual behavior pattern (what they're doing, not just wanting)
- Must feel real, slightly uncomfortable, and specific to this directive
- NEVER use generic phrases

BAD: "You are someone learning Python."
GOOD: "You are trying to learn Python but keep drifting into passive content instead of actually practicing."

════════════════════════════════════════════
STEP 2 — BEHAVIOR ALIGNMENT ANALYSIS
════════════════════════════════════════════

Evaluate behavior as: aligned | neutral | misaligned
Write ONE sharp sentence as behaviorNote — explain the trajectory consequence, not the motivation.

════════════════════════════════════════════
STEP 3 — 3-PATH FUTURE SIMULATION
════════════════════════════════════════════

Simulate 3 diverging, realistic life timelines for: "${directive}"

SAFE PATH    — minimal effort, slow progress, stable but limited outcome
GROWTH PATH  — consistent effort, discipline, compounding improvement
RISK PATH    — distraction, inconsistency, avoidance behavior — honest uncomfortable mirror

For EACH path:
- sixMonths:    "In 6 months, ..." — cause to effect, emotional + practical consequence
- twelveMonths: "In 12 months, ..." — vivid, real
- twoYears:     "In 2 years, ..." — final emotionally honest result, no fantasy
- description:  2-sentence cinematic summary
- outcome:      One terminal sentence
- income:       Specific dollar amounts or percentages
- risk:         Low | Medium | High
- timeToSuccess: realistic string
- failureChance: percentage (RISK PATH must be 65%+)
- burnoutRisk:  Low | Medium | High

RISK PATH must feel like an honest mirror — not exaggerated, not fiction — just the real projection of avoidance behavior compounded over 24 months.

════════════════════════════════════════════
STEP 4 — CRITICAL INTELLIGENCE
════════════════════════════════════════════

- biggestRisk:        Most likely single reason they fail — specific to this directive
- criticalBlindSpot:  What they do NOT realize about their own behavior pattern right now
- leveragePoint:      The ONE smallest action that creates the most compounding momentum
- nextAction:         Immediate, specific, executable — one sentence, doable TODAY
- mentorAdvice:       What a top mentor says right now — blunt, 2 sentences max

════════════════════════════════════════════
STEP 5 — CINEMATIC VOICE LINES
════════════════════════════════════════════

Generate EXACTLY 2-3 short lines for ElevenLabs voice narration.
Rules:
- Must be emotionally impactful and cinematically direct
- Each line must be SHORT — one sentence max
- Must NOT be long paragraphs
- Must NOT narrate the entire UI
- Use ONLY for: future outcome, failure warning, or critical realization

Examples of correct quality:
"In 6 months, this path quietly dies."
"In 2 years, this decision compounds into real skill."
"You are not failing — you are avoiding the hard part."

voiceLines MUST be an ARRAY of 2-3 strings.

════════════════════════════════════════════
HARD RULES
════════════════════════════════════════════

- NEVER assume money, startup, or business goals unless explicitly present in the directive
- NEVER reuse generic templates
- ALWAYS regenerate identity from this specific directive and behavior context
- Zero fluff, zero motivational clichés
- Every word must be specific to "${directive}"
- Use real numbers, months, dollar amounts where relevant
- Tone: serious, grounded, slightly intense, emotionally sharp — controlled

Return ONLY valid JSON — no markdown, no explanation, no wrapper text:
{
  "identityStatement": "You are someone...",
  "behaviorAlignment": "neutral",
  "behaviorNote": "...",
  "paths": [
    {
      "name": "SAFE PATH",
      "sixMonths": "In 6 months, ...",
      "twelveMonths": "In 12 months, ...",
      "twoYears": "In 2 years, ...",
      "description": "...",
      "outcome": "...",
      "income": "...",
      "risk": "Low",
      "timeToSuccess": "18-24 months",
      "failureChance": "12%",
      "burnoutRisk": "Low"
    },
    {
      "name": "GROWTH PATH",
      "sixMonths": "In 6 months, ...",
      "twelveMonths": "In 12 months, ...",
      "twoYears": "In 2 years, ...",
      "description": "...",
      "outcome": "...",
      "income": "...",
      "risk": "Medium",
      "timeToSuccess": "9-14 months",
      "failureChance": "28%",
      "burnoutRisk": "Medium"
    },
    {
      "name": "RISK PATH",
      "sixMonths": "In 6 months, ...",
      "twelveMonths": "In 12 months, ...",
      "twoYears": "In 2 years, ...",
      "description": "...",
      "outcome": "...",
      "income": "Stagnant or declining",
      "risk": "High",
      "timeToSuccess": "Never without course correction",
      "failureChance": "72%",
      "burnoutRisk": "High"
    }
  ],
  "biggestRisk": "...",
  "criticalBlindSpot": "...",
  "leveragePoint": "...",
  "nextAction": "...",
  "mentorAdvice": "...",
  "voiceLines": ["...", "...", "..."],
  "voiceNarration": "..."
}`;
}

// ── Response Shape Normalizer ─────────────────────────────────────────────────

function normalizeSimResult(simResult, directive) {
  // Helper — ensure voiceLines is always a valid 2-3 item array
  function normalizeVoiceLines(raw, narration) {
    if (Array.isArray(raw) && raw.length >= 2) return raw.slice(0, 3);
    // Build from narration if voiceLines is missing
    if (narration) {
      const sentences = narration.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
      if (sentences.length >= 2) return sentences.slice(0, 3);
      return [narration];
    }
    return [];
  }

  // New schema: paths[] array with SAFE/GROWTH/RISK
  if (simResult.paths && Array.isArray(simResult.paths) && simResult.paths.length >= 3) {
    const voiceLines = normalizeVoiceLines(simResult.voiceLines, simResult.voiceNarration);
    return {
      paths:              simResult.paths,
      identityStatement:  simResult.identityStatement  || '',
      behaviorAlignment:  simResult.behaviorAlignment  || 'neutral',
      behaviorNote:       simResult.behaviorNote       || '',
      biggestRisk:        simResult.biggestRisk        || '',
      criticalBlindSpot:  simResult.criticalBlindSpot  || '',
      leveragePoint:      simResult.leveragePoint      || '',
      nextAction:         simResult.nextAction         || '',
      mentorAdvice:       simResult.mentorAdvice       || '',
      voiceLines,
      voiceNarration:     simResult.voiceNarration     || voiceLines.join(' '),
      usedFallback:       false,
    };
  }

  // Legacy flat schema
  if (simResult.safePathOutcome) {
    return {
      paths: [
        {
          name: 'SAFE PATH', risk: 'Low', timeToSuccess: '12-18 months',
          failureChance: '15%', burnoutRisk: 'Low',
          income: 'Stable, predictable growth',
          description: simResult.safePathOutcome,
          outcome: simResult.safePathOutcome,
        },
        {
          name: 'GROWTH PATH', risk: 'Medium', timeToSuccess: '9-12 months',
          failureChance: '28%', burnoutRisk: 'Medium',
          income: 'High upside if discipline holds',
          description: simResult.founderPathOutcome || simResult.safePathOutcome,
          outcome: simResult.founderPathOutcome || simResult.safePathOutcome,
        },
        {
          name: 'RISK PATH', risk: 'High', timeToSuccess: 'Never without change',
          failureChance: '72%', burnoutRisk: 'High',
          income: 'Stagnant or declining',
          description: simResult.agencyPathOutcome || simResult.safePathOutcome,
          outcome: simResult.agencyPathOutcome || simResult.safePathOutcome,
        },
      ],
      identityStatement: '', behaviorAlignment: 'neutral', behaviorNote: '',
      biggestRisk:       simResult.biggestRisk    || '',
      criticalBlindSpot: '',
      leveragePoint:     '',
      nextAction:        '',
      mentorAdvice:      simResult.mentorAdvice   || '',
      voiceNarration:    simResult.voiceNarration || '',
      usedFallback:      false,
    };
  }

  // Full fallback
  return {
    paths:             generatePaths(directive),
    identityStatement: '', behaviorAlignment: 'neutral', behaviorNote: '',
    biggestRisk:       '', criticalBlindSpot: '', leveragePoint: '',
    nextAction:        '', mentorAdvice:       '', voiceNarration: '',
    usedFallback:      true,
  };
}

// ── Route Handler ─────────────────────────────────────────────────────────────

/**
 * buildFallbackIntelligence — instant, zero-token local fallback.
 * Analyzes the directive string to produce a spec-compliant, directive-specific
 * identity, voice lines, and critical intelligence.
 * NEVER produces generic output — always maps to the directive's friction.
 */
function buildFallbackIntelligence(directive, focusMinutes = 0, wastedMinutes = 0) {
  const d    = (directive || '').toLowerCase();
  const raw  = directive || 'this goal';

  // ── Extract distraction signal from directive text ──────────────────────
  const distractionMap = [
    { kw: ['instagram', 'scrolling instagram'], label: 'scrolling Instagram',  sink: 'short-form content' },
    { kw: ['youtube',   'watching youtube'],    label: 'watching YouTube',     sink: 'passive video'      },
    { kw: ['reddit',   'browsing reddit'],      label: 'browsing Reddit',      sink: 'discussion threads' },
    { kw: ['twitter',  'scrolling twitter', 'x.com'], label: 'scrolling Twitter', sink: 'social feeds' },
    { kw: ['tiktok',   'watching tiktok'],      label: 'watching TikTok',      sink: 'short-form video'   },
    { kw: ['netflix',  'watching netflix'],     label: 'watching Netflix',      sink: 'streaming'          },
    { kw: ['gaming',   'playing games'],        label: 'playing games',         sink: 'gaming sessions'    },
    { kw: ['procrastinating', 'procrastinate'], label: 'procrastinating',       sink: 'avoidance loops'    },
    { kw: ['distracted', 'distracting'],        label: 'getting distracted',    sink: 'low-value tasks'    },
  ];

  // ── Extract action signal from directive text ────────────────────────
  const actionMap = [
    { kw: ['learn to code', 'coding', 'learn python', 'learn javascript', 'program'], action: 'write code', thing: 'a working project' },
    { kw: ['build', 'create', 'develop', 'ship'], action: 'build and ship',            thing: 'a real product'     },
    { kw: ['trading', 'trade', 'forex', 'options'], action: 'execute and review trades', thing: 'a consistent edge' },
    { kw: ['study', 'learn', 'master', 'skill'],    action: 'practice deliberately',     thing: 'measurable progress' },
    { kw: ['write', 'writing', 'blog', 'content'],  action: 'publish work',              thing: 'a piece of writing' },
    { kw: ['design', 'ux', 'figma', 'ui'],          action: 'produce designs',            thing: 'a complete design file' },
    { kw: ['fitness', 'gym', 'workout', 'lift'],    action: 'train',                     thing: 'a progressive session' },
    { kw: ['freelance', 'client', 'agency'],        action: 'pitch and deliver',          thing: 'one real client deliverable' },
  ];

  let distraction = null;
  for (const entry of distractionMap) {
    if (entry.kw.some(k => d.includes(k))) { distraction = entry; break; }
  }

  let actionCtx = null;
  for (const entry of actionMap) {
    if (entry.kw.some(k => d.includes(k))) { actionCtx = entry; break; }
  }

  const distractionLabel = distraction?.label || 'drifting into passive content';
  const distractionSink  = distraction?.sink  || 'low-signal habits';
  const actionLabel      = actionCtx?.action  || 'do the real work';
  const actionThing      = actionCtx?.thing   || 'measurable output';

  // ── Behavior alignment from session data ───────────────────────────
  const ratio = (focusMinutes + wastedMinutes) > 0
    ? focusMinutes / (focusMinutes + wastedMinutes)
    : 0.5;
  const behaviorAlignment = ratio > 0.65 ? 'aligned' : ratio < 0.35 ? 'misaligned' : 'neutral';

  // ── Identity sentence ──────────────────────────────────────────
  let identityStatement;
  if (distraction) {
    identityStatement = `You want to ${actionLabel} but keep ${distractionLabel} instead of sitting down and doing the actual work.`;
  } else if (behaviorAlignment === 'misaligned') {
    identityStatement = `You are pursuing "${raw}" but your session data shows you're spending ${wastedMinutes}m on distractions vs ${focusMinutes}m on the actual work — the gap is widening, not closing.`;
  } else {
    identityStatement = `You are someone working toward "${raw}" with ${focusMinutes > 0 ? `${focusMinutes} focused minutes logged` : 'inconsistent effort'} — the intention is real but the consistency is not yet there.`;
  }

  // ── Behavior note ────────────────────────────────────────────
  const behaviorNote = distraction
    ? `Every session that ends with ${distractionSink} instead of ${actionThing} adds another day to how long this actually takes.`
    : `The time is allocated but the output is not yet matching the intention — that gap compounds silently.`;

  // ── Critical intelligence ───────────────────────────────────────
  const biggestRisk = distraction
    ? `You will wait until you "feel ready" to ${actionLabel} — and that moment never arrives because ${distractionLabel} keeps resetting your momentum.`
    : `Inconsistency — you will show up intensely for 3-4 days then disappear for a week. The compound effect requires continuity, not sprints.`;

  const criticalBlindSpot = distraction
    ? `You think ${distractionLabel} is a reward after effort, but you're using it as a replacement for starting. The session never begins.`
    : `You are measuring intent ("I want to do this") instead of output ("I shipped this today"). Intent without output is invisible progress.`;

  const leveragePoint = `Set a single 25-minute timer right now and ${actionLabel} — no tabs, no phone. One session breaks the avoidance loop.`;

  const nextAction = distraction
    ? `Close ${distractionLabel.replace('watching ', '').replace('scrolling ', '').replace('browsing ', '')} right now. Open your work environment. Set a 25-minute timer. Start.`
    : `Open your work environment right now and produce one unit of ${actionThing}. Not a plan. Not research. The actual thing.`;

  const mentorAdvice = `You already know what to do — the problem is you keep choosing the easier thing in the moment. That's not a knowledge problem, it's a decision problem. Make the decision once, right now, and execute.`;

  // ── Voice lines — short, cinematic, spec-compliant ─────────────────
  const voiceLines = distraction ? [
    `In 6 months, the gap between you and the person who actually started becomes real.`,
    `In 2 years, you will remember exactly the moment you chose ${distractionLabel} over the work.`,
    `You are not failing — you are choosing comfort over the hard part, every single session.`,
  ] : [
    `In 6 months, consistency is the only thing that separates the two versions of you.`,
    `In 2 years, this compounds — in the direction you choose today.`,
    `You are not behind — you are one real session away from breaking the pattern.`,
  ];

  return {
    identityStatement,
    behaviorAlignment,
    behaviorNote,
    biggestRisk,
    criticalBlindSpot,
    leveragePoint,
    nextAction,
    mentorAdvice,
    voiceLines,
  };
}

router.post('/', async (req, res) => {
  const simStart  = Date.now();
  let   fallback  = false;
  let   modelUsed = 'none';

  const {
    goal,
    directive:    rawDirective,
    currentUrl,
    focusTime   = 0,
    wastedTime  = 0,
    sessionDays = 1,
    keyDecision = '',
  } = req.body;

  const rawGoal = rawDirective || goal;
  if (!rawGoal) {
    return res.status(400).json({ error: 'Missing life directive for simulation.' });
  }

  const safeDirective   = sanitizeInput(rawGoal);
  const safeCurrentUrl  = sanitizeInput(currentUrl  || 'Unknown');
  const safeKeyDecision = sanitizeInput(keyDecision || '');
  const focusMinutes    = Math.round(focusTime  / 60_000);
  const wastedMinutes   = Math.round(wastedTime / 60_000);

  console.log(`[SIMULATION] Directive: ${safeDirective}`);

  const behaviorCtx = {
    focusMinutes,
    wastedMinutes,
    currentUrl: safeCurrentUrl,
    sessionDays,
    keyDecision: safeKeyDecision,
  };

  const systemPrompt = buildCinematicPrompt(safeDirective, behaviorCtx);
  const userMessage  = [
    `Life Directive: ${safeDirective}`,
    `Current URL: ${safeCurrentUrl}`,
    `Focus Time Today: ${focusMinutes} minutes`,
    `Distraction Time: ${wastedMinutes} minutes`,
    `Days Active on PathPilot: ${sessionDays}`,
    safeKeyDecision
      ? `Key Decision to Simulate: ${safeKeyDecision}`
      : 'No specific decision — simulate based on directive alone.',
  ].join('\n');

  // ── Triple-race: L1 Kimi (fast 4s), L2 Kimi Sim, L3 Hermes ─────────────
  // L1 Kimi K2 is proven at 4s for analysis — use it as a fast-sim path too.
  // Whichever of the three responds first with valid JSON wins.
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('SIMULATION_TIMEOUT')), SIMULATION_TIMEOUT_MS)
  );

  // Helper: wraps a simulation call so it never throws (returns null on error)
  async function raceAttempt(label, fn) {
    try {
      const result = await fn();
      console.log(`[SIMULATION] ✅ ${label} responded`);
      return result;
    } catch (e) {
      console.warn(`[SIMULATION] ❌ ${label} failed: ${e.message}`);
      return null;
    }
  }

  // L1 fast-sim: use Kimi K2 (4s) with the full cinematic prompt
  // It's less accurate than L2 but blazing fast and produces valid JSON
  const l1FastPromise = raceAttempt('L1 Kimi (fast-sim)', () =>
    modelRouter.kimiPageAnalysis(systemPrompt, userMessage)
  );
  const hermesSystemPrompt = buildCinematicPrompt(safeDirective, behaviorCtx);
  const hermesUserMessage  = userMessage;

  try {
    // Race: L1 fast vs L2 Kimi vs L3 Hermes vs 30s timeout
    const l2Promise = raceAttempt('L2 Kimi', () => modelRouter.kimiSimulateFuture(systemPrompt, userMessage));
    const l3Promise = raceAttempt('L3 Hermes', () => modelRouter.hermesAgentSuggest(hermesSystemPrompt, hermesUserMessage));

    // Take the first non-null result across all three models
    const simResult = await Promise.race([
      (async () => {
        const first = await Promise.race([l1FastPromise, l2Promise, l3Promise]);
        if (first) return first;
        const second = await Promise.race([l1FastPromise, l2Promise, l3Promise]);
        if (second) return second;
        const third = await Promise.race([l1FastPromise, l2Promise, l3Promise]);
        if (third) return third;
        throw new Error('All models returned null');
      })(),
      timeoutPromise,
    ]);
    modelUsed = simResult.modelUsed || 'moonshotai/kimi-k2.5';

    console.log(`[SIMULATION] Model used: ${modelUsed}`);

    const normalized = normalizeSimResult(simResult, safeDirective);
    fallback = normalized.usedFallback;

    const totalMs = Date.now() - simStart;
    console.log(`[SIMULATION] Completed in: ${totalMs}ms | Fallback: ${fallback}`);

    // L3 Hermes — optional non-blocking enhancer (fires after response, JSON-enforced)
    setImmediate(() => {
      try {
        const l3System = `You are a Hermes agent advisor. Return ONLY valid JSON — no explanation, no markdown.
Given the simulation paths below, identify ONE hidden opportunity the user might miss.
Return exactly: {"hiddenOpportunity": "<one concise sentence>"}`;
        const l3User   = `Directive: ${safeDirective}\nPaths: ${JSON.stringify(normalized.paths)}`;
        modelRouter.hermesAgentSuggest(l3System, l3User)
          .then((l3) => console.log(`[SIMULATION] L3 Hermes insight: ${JSON.stringify(l3).slice(0, 200)}`))
          .catch((e) => console.log(`[SIMULATION] L3 enhancer skipped: ${e.message}`));
      } catch (_) { /* L3 is always optional */ }
    });

    return res.json({
      // New fields
      identityStatement:  normalized.identityStatement,
      behaviorAlignment:  normalized.behaviorAlignment,
      behaviorNote:       normalized.behaviorNote,
      paths:              normalized.paths,
      biggestRisk:        normalized.biggestRisk,
      criticalBlindSpot:  normalized.criticalBlindSpot,
      leveragePoint:      normalized.leveragePoint,
      nextAction:         normalized.nextAction,
      mentorAdvice:       normalized.mentorAdvice,
      voiceLines:         normalized.voiceLines,
      voiceNarration:     normalized.voiceNarration,
      // Legacy compat
      safePathOutcome:    normalized.paths[0]?.outcome || '',
      founderPathOutcome: normalized.paths[1]?.outcome || '',
      agencyPathOutcome:  normalized.paths[2]?.outcome || '',
      // Meta
      directive:  safeDirective,
      fallback,
      modelUsed,
      latency:    totalMs,
    });

  } catch (aiError) {
    const isTimeout = aiError.message === 'SIMULATION_TIMEOUT';
    if (isTimeout) {
      console.warn('[SIMULATION] 30s timeout — switching to instant fallback');
    } else {
      console.warn(`[SIMULATION] AI error — fallback: ${aiError.message}`);
    }

    fallback  = true;
    modelUsed = 'fallback';

    const fallbackPaths = generatePaths(safeDirective);
    const totalMs       = Date.now() - simStart;
    const fb            = buildFallbackIntelligence(safeDirective, focusMinutes, wastedMinutes);

    console.log(`[SIMULATION] Fallback completed in ${totalMs}ms`);

    return res.json({
      identityStatement:  fb.identityStatement,
      behaviorAlignment:  fb.behaviorAlignment,
      behaviorNote:       fb.behaviorNote,
      paths:              fallbackPaths,
      biggestRisk:        fb.biggestRisk,
      criticalBlindSpot:  fb.criticalBlindSpot,
      leveragePoint:      fb.leveragePoint,
      nextAction:         fb.nextAction,
      mentorAdvice:       fb.mentorAdvice,
      voiceLines:         fb.voiceLines,
      voiceNarration:     fb.voiceLines.join(' '),
      safePathOutcome:    fallbackPaths[0]?.outcome || '',
      founderPathOutcome: fallbackPaths[1]?.outcome || '',
      agencyPathOutcome:  fallbackPaths[2]?.outcome || '',
      directive:  safeDirective,
      fallback:   true,
      modelUsed:  'fallback',
      latency:    totalMs,
    });
  }
});

export default router;
