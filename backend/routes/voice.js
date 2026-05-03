import express from 'express';

const router = express.Router();

/**
 * POST /api/voice
 * ─────────────────────────────────────────────────────────────────────────────
 * PathPilot — ElevenLabs Cinematic Voice Layer (Layer 4)
 *
 * voiceContext params:
 *   "simulation" — dramatic settings for future simulation narration
 *                  (higher stability, lower similarity for gravitas)
 *   "warning"    — standard alert voice for page warnings
 *   default      — standard PathPilot coaching voice
 * ─────────────────────────────────────────────────────────────────────────────
 */
router.post('/', async (req, res) => {
  try {
    const {
      text,
      voiceId      = 'EXAVITQu4vr4xnSDxMaL', // Default Voice ID
      voiceContext = 'default',                  // 'simulation' | 'warning' | 'default'
    } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Missing text for TTS' });
    }

    // Voice settings tuned per context
    let voiceSettings;
    if (voiceContext === 'simulation') {
      // Cinematic, gravitas — used for Kimi future simulation narration
      voiceSettings = {
        stability:         0.75,  // higher = more controlled, dramatic delivery
        similarity_boost:  0.55,  // lower = slightly more expressive variance
        style:             0.4,   // slight style injection for cinematic feel
        use_speaker_boost: true,
      };
      console.log(`[PATHPILOT] 🎙 CINEMATIC Voice (simulation) generating: "${text.substring(0, 50)}..."`);
    } else if (voiceContext === 'warning') {
      // Alert, urgent — used for off-track page warnings
      voiceSettings = {
        stability:         0.6,
        similarity_boost:  0.7,
        style:             0.2,
        use_speaker_boost: true,
      };
      console.log(`[PATHPILOT] ⚠️ WARNING Voice generating: "${text.substring(0, 50)}..."`);
    } else {
      // Standard PathPilot coaching voice
      voiceSettings = {
        stability:        0.5,
        similarity_boost: 0.75,
      };
      console.log(`[PATHPILOT] 🔊 Future Voice generating: "${text.substring(0, 40)}..."`);
    }

    const elevenLabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept':       'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key':   process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id:       'eleven_turbo_v2_5',
        voice_settings: voiceSettings,
      }),
    });

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error('[PATHPILOT] ElevenLabs error:', errorText);
      // Structured error — frontend uses this to trigger browser TTS fallback
      return res.status(502).json({
        error:   'elevenlabs_failed',
        message: 'ElevenLabs TTS unavailable — use browser fallback',
        status:  elevenLabsResponse.status,
      });
    }

    res.set({
      'Content-Type':      'audio/mpeg',
      'Transfer-Encoding': 'chunked',
    });

    const arrayBuffer = await elevenLabsResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);

  } catch (error) {
    console.error('[PATHPILOT] Voice route error:', error);
    // Structured error — frontend uses this to trigger browser TTS fallback
    res.status(500).json({
      error:   'voice_error',
      message: 'Voice service unavailable — use browser fallback',
    });
  }
});

/**
 * GET /api/voice/status
 * ─────────────────────────────────────────────────────────────────────────────
 * Quick ElevenLabs availability check. Called on sidepanel load.
 * Frontend uses this to decide: ElevenLabs (primary) vs Browser TTS (fallback).
 * Does NOT consume any credits — only pings the /v1/user endpoint.
 * ─────────────────────────────────────────────────────────────────────────────
 */
router.get('/status', async (req, res) => {
  try {
    const hasKey = Boolean(process.env.ELEVENLABS_API_KEY);
    if (!hasKey) {
      return res.json({ available: false, reason: 'no_api_key' });
    }

    // /v1/voices works with any valid key (no special permissions needed)
    const ping = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    });

    if (ping.ok) {
      console.log(`[PATHPILOT] ElevenLabs status: ✅ Available`);
      res.json({ available: true, charRemaining: null });
    } else {
      console.warn(`[PATHPILOT] ElevenLabs status: HTTP ${ping.status}`);
      res.json({ available: false, reason: `http_${ping.status}` });
    }
  } catch (e) {
    console.warn('[PATHPILOT] ElevenLabs status check failed:', e.message);
    res.json({ available: false, reason: 'network_error' });
  }
});

export default router;
