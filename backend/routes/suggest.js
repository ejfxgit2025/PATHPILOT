import express from 'express';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { goal, currentUrl, focusTime, wastedTime, completedTasks } = req.body;

    if (!goal) {
      return res.status(400).json({ error: 'Missing goal' });
    }

    console.log(`[SENTINEL] Generating suggestion for goal: ${goal}`);

    const systemPrompt = `You are SENTINEL, a focus enforcement AI.
Based on the user's goal and current session stats, suggest the next best action.
Return ONLY valid JSON matching this exact structure:
{
  "nextStep": "<Short actionable step>",
  "resources": [
    { "title": "<Resource title>", "url": "<Resource URL>" }
  ],
  "motivation": "<Short motivational quote or phrase>"
}`;

    const userMessage = `Goal: ${goal}
Current URL: ${currentUrl || 'None'}
Focus Time: ${Math.round(focusTime / 60000)} mins
Wasted Time: ${Math.round(wastedTime / 60000)} mins
Completed Tasks: ${JSON.stringify(completedTasks || [])}`;

    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://sentinel.local',
        'X-Title': 'SENTINEL'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error('[SENTINEL] OpenRouter error in suggest:', errorText);
      return res.status(500).json({ error: 'Failed to generate suggestion' });
    }

    const orResult = await openRouterResponse.json();
    let aiContent = orResult.choices[0].message.content;
    aiContent = aiContent.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsedResult = JSON.parse(aiContent);
    res.json(parsedResult);

  } catch (error) {
    console.error('[SENTINEL] Suggest route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
