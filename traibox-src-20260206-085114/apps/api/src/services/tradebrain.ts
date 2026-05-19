import type { AmbiguityResponse, ParseTradeRequest, TradePlanResponse } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';

const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FOB', 'CFR', 'CIF'] as const;

type ParseOk = Omit<TradePlanResponse, 'trade_id' | 'trace_id'> & { corridor?: string };

export function parseTradeIntent(input: ParseTradeRequest, opts: { profile: Profile }): ParseOk | AmbiguityResponse {
  const text = input.intent_text.trim();
  if (text.length < 5) {
    return {
      error: 'insufficient_context',
      message: 'Add a bit more detail (product and destination) to generate a plan.',
      questions: [{ field: 'intent_text', question: 'Describe the product and destination', options: [] }],
      trace_id: 'n/a'
    };
  }

  const corridor =
    input.hints?.corridor ??
    detectCorridor(text) ??
    opts.profile.tradebrain.default_corridor ??
    'EU-EU';
  const incoterms = detectIncoterms(text);
  if (incoterms.length > 1) {
    return {
      error: 'ambiguous_incoterm',
      message: 'Which delivery term applies?',
      questions: [{ field: 'incoterm', question: 'Confirm delivery term', options: incoterms }],
      trace_id: 'n/a'
    };
  }

  const incoterm = incoterms[0] ?? input.hints?.incoterms_default ?? opts.profile.tradebrain.incoterms_default ?? 'DAP';
  const paymentTerms = detectPaymentTerms(text);

  const items = parseItems(text);
  const mapped = items.map((it, idx) => mapHs(it.name, idx, opts.profile));
  const pending = mapped.flatMap((m) => m.pending_questions ?? []);

  const confidence = Math.min(
    0.95,
    Math.max(
      0.55,
      mapped.reduce((acc, m) => acc + m.confidence, 0) / Math.max(1, mapped.length)
    )
  );

  const checklist = ['Run compliance', 'Request financing', 'Get payment routes'];

  const reasons = [
    `Corridor ${corridor} detected`,
    `Incoterm ${incoterm} selected`,
    paymentTerms ? `Payment terms recognized: ${paymentTerms}` : 'Payment terms not specified'
  ];

  for (const m of mapped) {
    if (m.hs_code) reasons.unshift(`HS ${m.hs_code} detected for ${m.name}`);
  }

  const plan: ParseOk = {
    plan: {
      items: mapped.map((m) => ({
        name: m.name,
        qty: m.qty,
        unit: m.unit,
        hs_code: m.hs_code,
        hs_candidates: m.hs_candidates,
        nace_code: m.nace_code ?? null
      })),
      parties: [{ role: 'seller', country: corridor.split('-')[0] }, { role: 'buyer', country: corridor.split('-')[1] }],
      terms: { incoterm, payment_terms: paymentTerms ?? null, incoterm_candidates: incoterms.length === 1 ? [incoterm] : [] },
      checklist
    },
    confidence: Number(confidence.toFixed(2)),
    glass_box: { reasons: reasons.slice(0, 5) },
    pending_questions: pending,
    status: 'ready',
    corridor
  };

  // If any item is too ambiguous, return 422
  const tooAmbiguous = mapped.find((m) => m.confidence < opts.profile.tradebrain.hs_thresholds.ambiguous);
  if (tooAmbiguous) {
    return {
      error: 'ambiguous_hs',
      message: `Multiple HS codes match '${tooAmbiguous.name}'.`,
      questions: [
        {
          field: `item[0].hs_code`,
          question: 'Pick the best match',
          options: (tooAmbiguous.hs_candidates ?? []).slice(0, 6)
        }
      ],
      trace_id: 'n/a'
    };
  }

  return plan;
}

function detectIncoterms(text: string): string[] {
  const upper = text.toUpperCase();
  const found = INCOTERMS.filter((t) => new RegExp(`\\b${t}\\b`).test(upper));
  return [...new Set(found)];
}

function detectCorridor(text: string): string | null {
  // Prefer explicit corridor tokens: "PT-ES", "DE→FR", "NL -> BE"
  const explicit = text.match(/\b([A-Z]{2})\s*(?:-|→|->)\s*([A-Z]{2})\b/);
  if (explicit) {
    const a = explicit[1]!;
    const b = explicit[2]!;
    if (isEuCountryCode(a) && isEuCountryCode(b)) return `${a}-${b}`;
  }

  const mentions = findCountryMentions(text);
  if (mentions.length >= 2) return `${mentions[0]}-${mentions[1]}`;
  return null;
}

function isEuCountryCode(code: string): boolean {
  return EU_CODES.has(code.toUpperCase());
}

function findCountryMentions(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: Array<{ code: string; idx: number }> = [];

  // 1) ISO2 in ALLCAPS (avoid matching "de" as a word in ES/PT)
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1]!;
    if (EU_CODES.has(code)) hits.push({ code, idx: m.index ?? 0 });
  }

  // 2) Country names / common city hints
  for (const entry of EU_KEYWORDS) {
    for (const kw of entry.keywords) {
      const i = lower.indexOf(kw);
      if (i >= 0) hits.push({ code: entry.code, idx: i });
    }
  }

  hits.sort((a, b) => a.idx - b.idx);
  const out: string[] = [];
  for (const h of hits) {
    if (!out.includes(h.code)) out.push(h.code);
  }
  return out;
}

const EU_CODES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE'
]);

const EU_KEYWORDS: Array<{ code: string; keywords: string[] }> = [
  { code: 'PT', keywords: ['portugal', 'lisbon', 'porto'] },
  { code: 'ES', keywords: ['spain', 'madrid', 'barcelona', 'valencia'] },
  { code: 'FR', keywords: ['france', 'paris', 'lyon', 'marseille'] },
  { code: 'DE', keywords: ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg'] },
  { code: 'IT', keywords: ['italy', 'roma', 'rome', 'milan', 'milano'] },
  { code: 'NL', keywords: ['netherlands', 'holland', 'amsterdam', 'rotterdam'] },
  { code: 'BE', keywords: ['belgium', 'brussels', 'antwerp'] },
  { code: 'IE', keywords: ['ireland', 'dublin'] },
  { code: 'AT', keywords: ['austria', 'vienna', 'wien'] },
  { code: 'DK', keywords: ['denmark', 'copenhagen', 'københavn'] },
  { code: 'SE', keywords: ['sweden', 'stockholm'] },
  { code: 'FI', keywords: ['finland', 'helsinki'] },
  { code: 'PL', keywords: ['poland', 'warsaw', 'warszawa'] },
  { code: 'CZ', keywords: ['czech', 'czech republic', 'prague', 'praha'] },
  { code: 'SK', keywords: ['slovakia', 'bratislava'] },
  { code: 'HU', keywords: ['hungary', 'budapest'] },
  { code: 'RO', keywords: ['romania', 'bucharest', 'bucurești'] },
  { code: 'BG', keywords: ['bulgaria', 'sofia'] },
  { code: 'GR', keywords: ['greece', 'athens', 'athína'] },
  { code: 'HR', keywords: ['croatia', 'zagreb'] },
  { code: 'SI', keywords: ['slovenia', 'ljubljana'] },
  { code: 'LV', keywords: ['latvia', 'riga'] },
  { code: 'LT', keywords: ['lithuania', 'vilnius'] },
  { code: 'EE', keywords: ['estonia', 'tallinn'] },
  { code: 'CY', keywords: ['cyprus', 'nicosia'] },
  { code: 'LU', keywords: ['luxembourg'] },
  { code: 'MT', keywords: ['malta', 'valletta'] }
];

function detectPaymentTerms(text: string): string | null {
  const m = text.match(/(\d{1,3}\s*%[^.;\n]*advance)/i);
  if (m) return m[1]!;
  if (/advance/i.test(text)) return 'advance';
  const net = text.match(/\bnet\s*(\d{1,3})\b/i);
  if (net) return `net ${net[1]} days`;
  return null;
}

function parseItems(text: string): Array<{ name: string; qty: number; unit: string }> {
  const m = text.match(/(\d+)\s+(cases?|units?|kg|kilograms?|tons?|ton|boxes?)\s+of\s+([^.;\n]+)/i);
  if (m) {
    const qty = Number(m[1]);
    const unit = normalizeUnit(m[2]!);
    const name = m[3]!.trim();
    return [{ name, qty, unit }];
  }
  const of = text.match(/\bof\s+([^.;\n]+)/i);
  const name = (of?.[1] ?? text).trim().slice(0, 120);
  return [{ name, qty: 1, unit: 'unit' }];
}

function normalizeUnit(u: string): string {
  const lower = u.toLowerCase();
  if (lower.startsWith('case')) return 'case';
  if (lower.startsWith('unit')) return 'unit';
  if (lower.startsWith('kg') || lower.startsWith('kilo')) return 'kg';
  if (lower.startsWith('ton')) return 'ton';
  if (lower.startsWith('box')) return 'box';
  return 'unit';
}

function mapHs(name: string, idx: number, profile: Profile): {
  name: string;
  qty: number;
  unit: string;
  hs_code: string | null;
  hs_candidates?: string[];
  nace_code?: string | null;
  confidence: number;
  pending_questions?: Array<{ field: string; question: string; options: string[] }>;
} {
  const lower = name.toLowerCase();

  // Pilot lexicon
  if (lower.includes('wine')) {
    return { name: 'Wine (bottled)', qty: 100, unit: 'case', hs_code: '2204.21', hs_candidates: ['2204.21', '2204.29'], nace_code: '11.02', confidence: 0.86 };
  }
  if (lower.includes('heat pump')) {
    const candidates = ['8418.61 (heat pumps – air-air)', '8418.69 (other)'];
    return {
      name,
      qty: 1,
      unit: 'unit',
      hs_code: null,
      hs_candidates: candidates,
      confidence: 0.55,
      pending_questions:
        0.55 >= profile.tradebrain.hs_thresholds.ambiguous
          ? [
              {
                field: `item[${idx}].hs_code`,
                question: 'Pick the best match',
                options: candidates
              }
            ]
          : undefined
    };
  }
  if (lower.includes('apparel') || lower.includes('t-shirt') || lower.includes('tshirt')) {
    return { name, qty: 1, unit: 'unit', hs_code: '6109.10', hs_candidates: ['6109.10', '6109.90'], confidence: 0.72 };
  }
  if (lower.includes('machinery')) {
    return { name, qty: 1, unit: 'unit', hs_code: '8479.89', hs_candidates: ['8479.89'], confidence: 0.7 };
  }

  return { name, qty: 1, unit: 'unit', hs_code: null, hs_candidates: [], confidence: 0.5 };
}
