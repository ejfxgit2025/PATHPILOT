import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import analyzeRoute  from './routes/analyze.js';
import voiceRoute    from './routes/voice.js';
import suggestRoute  from './routes/suggest.js';
import simulateRoute from './routes/simulate.js';
import protectRoute  from './routes/protect.js';
import modelRouter   from './routes/modelRouter.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-sentinel-key'],
}));
app.options('*', cors());
app.use(express.json());

// HACKATHON MODE — disable auth
app.use((req, res, next) => {
  next();
});

// Mount routes
app.use('/api/analyze',  analyzeRoute);
app.use('/analyze',      analyzeRoute);   // alias
app.use('/api/voice',    voiceRoute);
app.use('/voice',        voiceRoute);     // alias
app.use('/api/suggest',  suggestRoute);
app.use('/suggest',      suggestRoute);   // alias
app.use('/api/simulate', simulateRoute);
app.use('/simulate',     simulateRoute);  // alias
app.use('/api/protect',  protectRoute);
app.use('/protect',      protectRoute);   // alias

app.listen(PORT, () => {
  const m = modelRouter.models;
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🚀 PATHPILOT — Hermes-Powered Founder Navigation System   ║');
  console.log('║         Kimi Future Simulation Engine + ElevenLabs           ║');
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Port       : ${PORT}                                          `);
  console.log(`║  L0 Router  : Rule-Based Classifier (FREE — zero tokens)       `);
  console.log(`║  L1 Fast    : ${m.L1_MODEL_PRIMARY}                            `);
  console.log(`║  L1 Fallback: ${m.L1_MODEL_FALLBACK}                           `);
  console.log(`║  L2 Sim     : ${m.L2_MODEL_PRIMARY}                            `);
  console.log(`║  L2 Upgrade : ${m.L2_MODEL_UPGRADE}                            `);
  console.log(`║  L3 Agent   : ${m.L3_MODEL}            `);
  console.log(`║  L4 Voice   : ElevenLabs eleven_turbo_v2_5                     `);
  console.log(`║  🛡️ Protect : /api/protect (L0 free + L1 Kimi + L3 on-demand)  `);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
});
