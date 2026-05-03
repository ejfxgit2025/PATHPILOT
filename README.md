cd # 🚀 PathPilot — Hermes-Powered Founder Navigation System

> *"Your browser knows where you're going. PathPilot knows where you should be."*

**PathPilot** is a production-grade Chrome extension powered by a 4-layer Kimi-first AI architecture. It monitors browsing behavior in real-time, classifies pages against your life directive, and — most importantly — **simulates your diverging futures** using Kimi K2.5's deep reasoning to show you exactly what your current decisions are costing you.

Built for the **Hermes Agent Creative Hackathon** — qualifying for both **Main Track** (agent intelligence) and **Kimi Track** (Kimi K2 / K2.5 integration).

---

## 🧠 Architecture — 4-Layer Kimi-First AI Stack

```
Browser Event
      │
      ▼
┌─────────────────────────────────────────────┐
│  Layer 0 — Rule-Based Classifier  (FREE)    │
│  Instant decisions: YouTube Shorts, GitHub, │
│  Netflix, Coursera → zero tokens burned     │
└─────────────────┬───────────────────────────┘
                  │ (uncertain pages only)
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 1 — Kimi K2 0905                     │
│  Fast page analysis: score, status, action  │
│  Fallback: Kimi K2 (free tier)              │
└─────────────────┬───────────────────────────┘
                  │ (deep simulation request)
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 2 — Kimi K2.5                        │
│  Future Simulation Engine                   │
│  3 diverging 18-month paths, burnout month, │
│  cash collapse, mentor/investor dialogues   │
└─────────────────┬───────────────────────────┘
                  │ (agent suggestions)
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 3 — Nous Hermes 3 70B                │
│  Autonomous agent brain: context-aware      │
│  founder-grade next-move suggestions        │
└─────────────────┬───────────────────────────┘
                  │ (high-impact moments only)
                  ▼
┌─────────────────────────────────────────────┐
│  Layer 4 — ElevenLabs TTS                   │
│  Cinematic voice narration                  │
│  Simulation: dramatic high-stability voice  │
│  Warnings: urgent alert delivery            │
└─────────────────────────────────────────────┘
```

---

## 🤖 Model Stack

| Layer | Model | Purpose | Cost |
|-------|-------|---------|------|
| L0 | Rule-Based Classifier | Instant distraction/aligned detection | **FREE** |
| L1 | `moonshot/kimi-k2` | Fast page analysis | Low (uncertain only) |
| L1 Fallback | `moonshot/kimi-k2:free` | Free-tier fallback | Free |
| L2 | `moonshot/kimi-k2-5` | Deep future simulation | On-demand only |
| L2 Upgrade | `moonshot/kimi-k2-6` | Premium simulation upgrade | Optional |
| L3 | `nousresearch/hermes-3-70b-instruct` | Agent intelligence / suggestions | On-demand |
| L4 | ElevenLabs `eleven_turbo_v2_5` | Cinematic voice narration | On-demand |

### Cost Control Strategy

- **80-90% of page analyses are handled by Layer 0** (zero tokens)
- Layer 1 (Kimi K2) only activates for genuinely ambiguous pages
- Layers 2, 3, 4 are **user-triggered only** — never auto-run
- This makes PathPilot economically viable for daily use

---

## ⚡ Hackathon Tracks

### 🏆 Main Track — Autonomous Agent Intelligence
PathPilot's Hermes 3 70B agent layer acts as an autonomous "sidecar intelligence" — proactively identifying the single highest-leverage next move for a founder based on their behavioral data, completed tasks, and browsing patterns.

### 🥇 Kimi Track — Kimi K2 + K2.5 Integration
- **Kimi K2** powers real-time page classification (Layer 1)
- **Kimi K2.5** powers the Future Simulation Engine (Layer 2) — the centerpiece Kimi Track feature that generates rich 3-path futures with burnout timelines, investor dialogues, and ElevenLabs cinematic narration

---

## 🔮 Kimi Future Simulation Engine

The standout feature for Kimi Track. Triggered via the **"⚡ SIMULATE MY FUTURE"** button in the sidepanel.

**Input:** current life directive, focus time, distraction time, session data

**Output (Kimi K2.5 generates):**
```json
{
  "safePathOutcome":    "18-month outcome if habits stay the same",
  "founderPathOutcome": "18-month outcome with 90-day full focus discipline",
  "agencyPathOutcome":  "18-month outcome with aggressive AI leverage",
  "biggestRisk":        "Hidden risk most founders miss",
  "burnoutMonth":       8,
  "cashCollapseMonth":  11,
  "keyOpportunities":   ["...", "...", "..."],
  "mentorAdvice":       "What a YC partner would say right now",
  "investorDialogue":   "What an investor sees in your behavior pattern",
  "cofounderWarning":   "What a cofounder notices that you haven't",
  "voiceNarration":     "Cinematic narration passed to ElevenLabs",
  "modelUsed":          "kimi-k2-5"
}
```

---

## 🎤 ElevenLabs Cinematic Voice

Three distinct voice modes, each with tuned settings:

| Context | Stability | Similarity | Effect |
|---------|-----------|------------|--------|
| `simulation` | 0.75 | 0.55 | Dramatic, gravitas — for future narration |
| `warning` | 0.60 | 0.70 | Urgent, alert — for off-track warnings |
| `default` | 0.50 | 0.75 | Coaching voice — standard PathPilot |

---

## ⚙️ Features

| Feature | Description |
|---------|-------------|
| 🔍 Real-time page analysis | Every page scored against life directive |
| ⚡ Future Simulation | 3-path 18-month projection via Kimi K2.5 |
| 🤖 Agent suggestions | Hermes 3 70B next-move recommendations |
| 🔊 Cinematic voice | ElevenLabs voice narration with context-aware settings |
| ⛔ Founder Discipline Mode | Server-side deterministic redirect enforcement |
| ⏱ Path Metrics | On-path time vs distraction time tracking |
| 🚀 Critical Moves | Task system for daily founder priorities |
| 🎤 Voice Input | Speak your life directive |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Extension | Chrome Extension APIs, Manifest V3 |
| Backend | Node.js + Express (ES Modules) |
| AI Router | OpenRouter (multi-model) |
| L1 AI | MoonshotAI Kimi K2 |
| L2 AI | MoonshotAI Kimi K2.5 |
| L3 AI | Nous Hermes 3 70B |
| Voice | ElevenLabs Turbo v2.5 |

---

## 📂 Project Structure

```
sentinel/
├── extension/
│   ├── manifest.json
│   ├── background.js      — monitoring, redirect logic, strict mode
│   ├── content.js         — page content extraction
│   ├── popup.html / .js   — goal setting, session controls
│   ├── sidepanel.html     — mission control dashboard
│   ├── sidepanel.js       — UI logic + Simulate My Future system
│   └── sidepanel.css      — cinematic dark UI design system
│
└── backend/
    ├── server.js          — Express server, route registration, model stack log
    └── routes/
        ├── modelRouter.js — 4-layer AI architecture (L0→L3)
        ├── analyze.js     — /api/analyze  (L0 + L1 Kimi K2)
        ├── suggest.js     — /api/suggest  (L3 Hermes 3 70B)
        ├── simulate.js    — /api/simulate (L2 Kimi K2.5) ← NEW
        └── voice.js       — /api/voice    (L4 ElevenLabs)
```

---

## ⚙️ Installation

### 1. Clone & setup

```bash
git clone <repo>
cd sentinel
```

### 2. Configure backend

```bash
cd backend
cp .env.example .env
# Fill in your API keys
```

```env
OPENROUTER_API_KEY=sk-or-...
ELEVENLABS_API_KEY=sk_...
SENTINEL_SECRET=your-secret

# Kimi model layers (defaults work if omitted)
KIMI_MODEL_L1=moonshot/kimi-k2
KIMI_MODEL_L1_FALLBACK=moonshot/kimi-k2:free
KIMI_MODEL_L2=moonshot/kimi-k2-5
HERMES_MODEL=nousresearch/hermes-3-70b-instruct
```

### 3. Start backend

```bash
npm install
npm start
```

On boot you'll see the full model stack:

```
╔══════════════════════════════════════════════════════════════╗
║   🚀 PATHPILOT — Hermes-Powered Founder Navigation System   ║
║         Kimi Future Simulation Engine + ElevenLabs           ║
╠══════════════════════════════════════════════════════════════╣
║  L0 Router  : Rule-Based Classifier (FREE — zero tokens)
║  L1 Fast    : moonshot/kimi-k2
║  L2 Sim     : moonshot/kimi-k2-5
║  L3 Agent   : nousresearch/hermes-3-70b-instruct
║  L4 Voice   : ElevenLabs eleven_turbo_v2_5
╚══════════════════════════════════════════════════════════════╝
```

### 4. Load extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer Mode**
3. Click **Load Unpacked** → select `extension/` folder

---

## 🎥 Demo Script

1. **Set life directive** → "Raise a $1M seed round in 6 months"
2. **Browse YouTube** → instant rule-based block, `modelUsed: "rule-based"` (zero tokens)
3. **Browse a gray-area site** → Kimi K2 activates, `modelUsed: "kimi-k2"`
4. **Click "⚡ SIMULATE MY FUTURE"** → Kimi K2.5 generates 3-path simulation
5. **Click "🔊 NARRATE MY FUTURE"** → ElevenLabs speaks the cinematic future consequence
6. **Enable Discipline Mode** → off-track sites get server-enforced redirect

---

## 🏆 Why PathPilot Wins

- **Not just tracking → enforcing → simulating futures**
- First Chrome extension to use Kimi K2.5 for real-time life path simulation
- Economical by design: 80%+ of decisions cost zero tokens (Layer 0)
- Full Hermes agent layer for autonomous proactive intelligence
- Cinematic ElevenLabs voice with context-aware emotional settings

---

*Submitted to the Hermes Agent Creative Hackathon — Main Track + Kimi Track*
