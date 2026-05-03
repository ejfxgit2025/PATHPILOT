import express from 'express';
import modelRouter from './modelRouter.js';
import { sanitizeInput } from '../utils/sanitize.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { goal, currentUrl, focusTime, wastedTime, completedTasks } = req.body;

    if (!goal) {
      return res.status(400).json({ error: 'Missing life directive' });
    }

    // Sanitize user inputs — prevents ByteString conversion errors
    const safeGoal       = sanitizeInput(goal);
    const safeCurrentUrl = sanitizeInput(currentUrl || 'None');

    const suggestStart = Date.now();
    console.log(`[PATHPILOT] L3 Hermes Agent calculating next path move for: ${safeGoal}`);

    // Layer 3: Hermes 3 70B — Agent brain for context-aware suggestions
    const systemPrompt = `You are PathPilot's Hermes Agent — an autonomous, context-aware intelligence engine powering the PathPilot Founder Navigation System.
You have deep knowledge of startup paths, founder psychology, and leverage points that separate winners from drifters.
Based on the user's life directive and current session data, identify their single highest-leverage next move.
Think like a top YC partner + life coach combined — direct, specific, and founder-grade.
Return ONLY valid JSON matching this exact structure:
{
  "nextStep": "<Single most important action to take right now — specific and founder-grade>",
  "resources": [
    { "title": "<Resource title>", "url": "<Resource URL>" }
  ],
  "motivation": "<One cinematic, high-impact phrase that a top founder mentor would say>"
}`;

    const userMessage = `Life Directive: ${safeGoal}
Current URL: ${safeCurrentUrl}
On-Path Time This Session: ${Math.round((focusTime || 0) / 60000)} mins
Path Cost (Distraction Time): ${Math.round((wastedTime || 0) / 60000)} mins
Completed Critical Moves: ${JSON.stringify(completedTasks || [])}`;

    const parsedResult = await modelRouter.hermesAgentSuggest(systemPrompt, userMessage);

    const totalLatency = Date.now() - suggestStart;
    parsedResult.latency = parsedResult.latency || totalLatency;

    console.log(`[PATHPILOT] Hermes suggestion complete | model: ${parsedResult.modelUsed} | latency: ${totalLatency}ms`);
    console.log('[MODEL ROUTER] SUCCESS — Hermes agent served');
    res.json(parsedResult);

  } catch (error) {
    console.error('[PATHPILOT] Suggest route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
