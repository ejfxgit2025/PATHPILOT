/**
 * PathPilot — Universal Path Generator  (utils/pathGenerator.js)
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates 3 structured future paths for ANY life directive without any AI call.
 * Used as an instant fallback when the simulation AI times out or errors.
 *
 * v2: Domain extraction + path differentiation + anti-template sentence variety.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Domain context map ────────────────────────────────────────────────────────

const DIRECTIVE_CONTEXTS = [
  {
    keywords: ['python', 'javascript', 'typescript', 'rust', 'golang', 'react', 'node'],
    domain: 'programming',
    tone: 'technical',
    vocabulary: ['projects', 'portfolio', 'stack', 'deploy', 'iterate', 'debug', 'ship'],
    sacrifice: 'weekends spent debugging instead of unwinding',
    struggle: 'staring at error messages at 1am wondering if this is worth it',
    breakthru: 'your first working project goes live and someone uses it',
    incomeHigh: '$80K–$150K/yr as a developer or freelancer',
    incomeAlt: '$3K–$8K/mo freelancing within 14 months',
    safeTimeline: '14–20 months',
    aggressiveTimeline: '5–9 months',
    altTimeline: '9–14 months',
  },
  {
    keywords: ['learn', 'code', 'coding', 'program', 'develop', 'software', 'engineer', 'web dev', 'app'],
    domain: 'software development',
    tone: 'technical',
    vocabulary: ['projects', 'portfolio', 'clients', 'iterations', 'skills'],
    sacrifice: 'social plans cancelled for practice sessions',
    struggle: 'the gap between tutorials and real-world projects feels enormous',
    breakthru: 'landing your first paying client or job offer',
    incomeHigh: '$70K–$130K/yr',
    incomeAlt: '$2K–$6K/mo freelancing',
    safeTimeline: '15–20 months',
    aggressiveTimeline: '6–10 months',
    altTimeline: '10–15 months',
  },
  {
    keywords: ['doctor', 'medicine', 'medical', 'surgeon', 'physician', 'mbbs', 'residency', 'clinical'],
    domain: 'medicine',
    tone: 'institutional',
    vocabulary: ['years of study', 'clinical training', 'patients', 'pressure', 'responsibility', 'boards', 'residency'],
    sacrifice: 'your 20s consumed by textbooks, boards, and hospital floors',
    struggle: 'exhaustion so deep you question whether you chose the right path',
    breakthru: 'the first time a patient\'s outcome changes because of your decision',
    incomeHigh: '$200K–$400K/yr as an attending physician',
    incomeAlt: 'Stable $80K–$120K/yr in clinical roles by year 8',
    safeTimeline: '8–12 years',
    aggressiveTimeline: '6–8 years (accelerated programs)',
    altTimeline: '4–6 years (PA/NP alternative routes)',
  },
  {
    keywords: ['lawyer', 'law', 'attorney', 'legal', 'bar exam', 'law school', 'litigation'],
    domain: 'law',
    tone: 'institutional',
    vocabulary: ['cases', 'bar', 'litigation', 'clients', 'court', 'briefs', 'precedent'],
    sacrifice: 'three years of law school debt before your first paycheck',
    struggle: 'bar exam failure rates and the brutal associate grind',
    breakthru: 'winning your first case or closing your first deal',
    incomeHigh: '$160K–$300K/yr at a firm',
    incomeAlt: '$70K–$100K/yr in-house or public interest',
    safeTimeline: '5–8 years',
    aggressiveTimeline: '4–6 years',
    altTimeline: '3–4 years (paralegal → JD hybrid path)',
  },
  {
    keywords: ['trade', 'trading', 'trader', 'forex', 'stock', 'option', 'futures', 'crypto trading'],
    domain: 'active trading',
    tone: 'financial',
    vocabulary: ['edge', 'setups', 'risk management', 'drawdown', 'consistency', 'prop firm', 'capital'],
    sacrifice: 'months of losses that test your conviction before consistency arrives',
    struggle: 'watching a trade go perfectly wrong after you sized up',
    breakthru: 'your first month of consistent profitability — everything clicks',
    incomeHigh: '$10K–$40K/mo at consistency with scaled capital',
    incomeAlt: '$2K–$6K/mo via prop firm funding',
    safeTimeline: '18–30 months',
    aggressiveTimeline: '8–14 months',
    altTimeline: '12–18 months',
  },
  {
    keywords: ['invest', 'investing', 'portfolio', 'wealth', 'dividend', 'etf', 'index fund'],
    domain: 'investing',
    tone: 'financial',
    vocabulary: ['positions', 'allocation', 'compounding', 'yield', 'DCA', 'horizon'],
    sacrifice: 'delayed gratification while others spend what you save',
    struggle: 'holding through red months when every instinct says sell',
    breakthru: 'compound growth becomes undeniable — the math starts working for you',
    incomeHigh: 'Financial independence in 10–15 years at strong savings rate',
    incomeAlt: 'Passive dividend income covering $2K–$4K/mo in 8–12 years',
    safeTimeline: '10–15 years',
    aggressiveTimeline: '7–10 years',
    altTimeline: '5–8 years (income + investing hybrid)',
  },
  {
    keywords: ['crypto', 'bitcoin', 'ethereum', 'defi', 'nft', 'web3', 'blockchain'],
    domain: 'crypto',
    tone: 'financial',
    vocabulary: ['protocols', 'on-chain', 'conviction plays', 'cycle', 'liquidity', 'yield'],
    sacrifice: 'volatility that wipes gains and tests your risk tolerance constantly',
    struggle: 'holding through 70% drawdowns without panic selling',
    breakthru: 'a strategic position hits and your portfolio transforms in weeks',
    incomeHigh: '5–20x on strategic positions in a bull cycle',
    incomeAlt: 'DeFi yield covering $1K–$3K/mo living expenses',
    safeTimeline: '2–4 year cycle',
    aggressiveTimeline: '6–18 months active trading',
    altTimeline: '12–24 months DeFi + yield',
  },
  {
    keywords: ['business', 'startup', 'entrepreneur', 'company', 'saas', 'product', 'found'],
    domain: 'entrepreneurship',
    tone: 'execution',
    vocabulary: ['revenue', 'MRR', 'market', 'execution', 'traction', 'churn', 'PMF', 'users'],
    sacrifice: 'salary stability traded for months of zero income and uncertainty',
    struggle: 'building for users who never show up — questioning every assumption',
    breakthru: 'first dollar of revenue or first 100 users who actually love the product',
    incomeHigh: '$10K MRR in 12 months → $100K MRR in 36 months',
    incomeAlt: 'Profitable solo business at $3K–$8K MRR in 18 months',
    safeTimeline: '18–36 months',
    aggressiveTimeline: '8–14 months',
    altTimeline: '12–20 months',
  },
  {
    keywords: ['freelance', 'agency', 'consult', 'client', 'service', 'retainer'],
    domain: 'freelancing',
    tone: 'execution',
    vocabulary: ['clients', 'retainers', 'pitches', 'rates', 'deliverables', 'referrals'],
    sacrifice: 'rejection calls, unpaid proposals, and clients who ghost you',
    struggle: 'the feast-or-famine cycle before retainers stabilize your income',
    breakthru: 'a client renews without you having to ask — recurring revenue is born',
    incomeHigh: '$12K–$25K/mo with premium clients and a niche',
    incomeAlt: '$3K–$6K/mo stable retainers within 10 months',
    safeTimeline: '10–16 months',
    aggressiveTimeline: '4–8 months',
    altTimeline: '7–12 months',
  },
  {
    keywords: ['gym', 'fitness', 'workout', 'lift', 'muscle', 'bodybuilding', 'physique', 'cut', 'bulk'],
    domain: 'fitness',
    tone: 'physical',
    vocabulary: ['progressive overload', 'training sessions', 'nutrition', 'recovery', 'form', 'consistency'],
    sacrifice: 'social meals skipped and early alarms that feel impossible at first',
    struggle: 'the 3-month plateau where nothing seems to change and quitting feels rational',
    breakthru: 'the moment your body composition visibly shifts and you can\'t unsee it',
    incomeHigh: 'Elite physique + coaching income at $4K–$10K/mo',
    incomeAlt: 'Top 15% physique + part-time coaching at $1K–$3K/mo',
    safeTimeline: '18–24 months',
    aggressiveTimeline: '8–12 months',
    altTimeline: '12–18 months',
  },
  {
    keywords: ['write', 'writing', 'author', 'blog', 'newsletter', 'book', 'content'],
    domain: 'writing',
    tone: 'creative',
    vocabulary: ['pieces', 'audience', 'publishing', 'voice', 'consistency', 'readership'],
    sacrifice: 'hours of writing with no audience in sight — publishing into the void',
    struggle: 'your first 100 pieces feel invisible — distribution is as hard as creation',
    breakthru: 'a piece goes viral or a client pays you to write for them',
    incomeHigh: '$5K–$15K/mo via ghostwriting, courses, or newsletter monetization',
    incomeAlt: '$1K–$3K/mo from content clients or sponsorships',
    safeTimeline: '12–20 months',
    aggressiveTimeline: '5–9 months',
    altTimeline: '8–14 months',
  },
  {
    keywords: ['quit', 'resign', 'leave job', 'escape', 'fire my boss', '9-5'],
    domain: 'career transition',
    tone: 'personal',
    vocabulary: ['runway', 'bridge income', 'exit', 'freedom', 'backup plan', 'leap'],
    sacrifice: 'financial insecurity between your last paycheck and your first win',
    struggle: 'the terror of watching your savings drop before income replaces it',
    breakthru: 'the month your new income finally clears what your job was paying',
    incomeHigh: 'Full income replacement within 10–14 months of leaving',
    incomeAlt: '$3K–$5K/mo bridge income from a side track within 8 months',
    safeTimeline: '12–20 months',
    aggressiveTimeline: '6–10 months',
    altTimeline: '9–15 months',
  },
];

// ── Context detector ─────────────────────────────────────────────────────────

function detectContext(directive) {
  const lower = (directive || '').toLowerCase();

  for (const ctx of DIRECTIVE_CONTEXTS) {
    if (ctx.keywords.some((kw) => lower.includes(kw))) {
      return ctx;
    }
  }

  // Generic catch-all — still personalised to directive text
  return {
    domain: 'your goal',
    tone: 'general',
    vocabulary: ['milestones', 'progress', 'consistency', 'output', 'work'],
    sacrifice: 'time and comfort you won\'t get back',
    struggle: 'the gap between where you are and where you want to be',
    breakthru: 'the moment results match your effort',
    incomeHigh: 'Top-tier outcome if you maintain the discipline',
    incomeAlt: 'Sustainable progress within 12–18 months of real effort',
    safeTimeline: '14–20 months',
    aggressiveTimeline: '6–10 months',
    altTimeline: '9–14 months',
  };
}

// ── Sentence variety pool ─────────────────────────────────────────────────────

/**
 * Returns a sentence-varied opening for each path type.
 * Avoids "In X months, you will..." repeated openers.
 */
function safeOpeners(ctx, directive) {
  return [
    `Most people pursuing ${ctx.domain} take this route — and it works.`,
    `The slow lane in ${ctx.domain} is underrated. Steady input compounds quietly.`,
    `${directive ? `"${directive}"` : 'This path'} at a sustainable pace means ${ctx.sacrifice} — on your terms.`,
  ];
}

function aggressiveOpeners(ctx, directive) {
  return [
    `This version of you doesn't wait. You compress 2 years of ${ctx.domain} into one brutal sprint.`,
    `Six months. Full immersion. The aggressive path in ${ctx.domain} isn't for everyone.`,
    `You experience ${ctx.struggle} — and you push through it anyway.`,
  ];
}

function altOpeners(ctx, directive) {
  return [
    `There's a side door into ${ctx.domain} most people don't see.`,
    `The unconventional route: instead of the standard path, you leverage systems and shortcuts.`,
    `AI tools, early leverage, and asymmetric bets — the alternative to grinding ${ctx.domain} linearly.`,
  ];
}

function pick(arr) {
  // Deterministic variety: rotate based on current minute-of-day bucket
  const bucket = Math.floor(Date.now() / 60_000) % arr.length;
  return arr[bucket];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * generatePaths(directive)
 *
 * Returns 3 directive-specific future paths without any AI call.
 * v2: domain vocabulary, path-differentiated tone, anti-template structure.
 *
 * @param  {string} directive  — raw user life directive (e.g. "learn python")
 * @returns {Array}            — [SafePath, AggressivePath, AlternativePath]
 */
export function generatePaths(directive) {
  const ctx = detectContext(directive);
  const label = directive || 'your goal';

  const safeOpen = pick(safeOpeners(ctx, directive));
  const aggrOpen = pick(aggressiveOpeners(ctx, directive));
  const altOpen = pick(altOpeners(ctx, directive));

  return [
    {
      name: 'Safe Path',
      strategy: `${safeOpen} Dedicate 60–90 minutes daily to ${ctx.vocabulary[0]} and deliberate practice. Build one ${ctx.vocabulary[1] || 'skill'} at a time. Track weekly output — not feelings.`,
      outcome: `After ${ctx.safeTimeline} of consistent work, you have undeniable competence in ${ctx.domain}. You didn't sprint — you marched. That matters more than speed. The people who started alongside you and quit are invisible; you're not.`,
      income: ctx.incomeAlt,
      risk: 'Low',
      timeToSuccess: ctx.safeTimeline,
      failureChance: '14%',
      burnoutRisk: 'Low',
      description: `You accumulate ${ctx.vocabulary[0]} and ${ctx.vocabulary[2] || 'experience'} at a pace your life can sustain. The sacrifice is ${ctx.sacrifice}. The reward is compounding progress nobody can take from you.`,
    },
    {
      name: 'Aggressive Path',
      strategy: `${aggrOpen} 6–8 hours daily, skipping theory for ${ctx.vocabulary[0]} shipped. Use ${ctx.vocabulary[3] || 'every resource'} as leverage. Fail fast, cut what doesn't work, iterate mercilessly.`,
      outcome: `In ${ctx.aggressiveTimeline} you either break through or burn out — those are the only two exits from this path. The ones who survive are transformed. High failure rate. The upside is career-defining and rare.`,
      income: ctx.incomeHigh,
      risk: 'High',
      timeToSuccess: ctx.aggressiveTimeline,
      failureChance: '44%',
      burnoutRisk: 'High',
      description: `You live through ${ctx.struggle}. Then — if you hold — you hit ${ctx.breakthru}. Nothing about this path is comfortable. Everything about it is fast.`,
    },
    {
      name: 'Alternative Path',
      strategy: `${altOpen} Work 3–4 peak cognitive hours instead of grinding 8. Use AI and systems to 10× your ${ctx.vocabulary[0]} output. Build in public. Find the asymmetric shortcut others overlook.`,
      outcome: `By month ${ctx.altTimeline.split('–')[0]}, your output-per-hour exceeds peers grinding 3× harder. You're not the loudest — you're the most efficient. That compounds differently, but it compounds hard.`,
      income: `Modest in months 1–6, then accelerating — targeting ${ctx.incomeAlt} by month 12–15`,
      risk: 'Medium',
      timeToSuccess: ctx.altTimeline,
      failureChance: '26%',
      burnoutRisk: 'Medium',
      description: `While others take the standard route through ${ctx.domain}, you find the edge: smarter systems, better leverage, less wasted motion. The alternative path doesn't look right on paper — but it fits who you actually are.`,
    },
  ];
}
