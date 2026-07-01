// adviceTree.ts
// Deterministic conversational decision tree for the crop-irrigation advisor.
// Structure: each node has a `reply` (what the bot says) and `options`
// (buttons → child node ids). Leaf nodes carry detailed `advice`.
// Anything the user TYPES that isn't a button → handled by Gemini (free-text),
// so this tree covers the guided flow and Gemini covers the long tail.

export interface TreeNode {
  id: string;
  reply: string;                 // bot message shown when this node is entered
  options?: { label: string; next: string }[];  // button → next node id
  advice?: AdviceCard;           // optional rich advice block (leaf)
}

export interface AdviceCard {
  title: string;
  severity: 'info' | 'good' | 'warning' | 'urgent';
  steps: string[];
  note?: string;
}

export const ROOT_ID = 'root';

export const ADVICE_TREE: Record<string, TreeNode> = {
  // ─────────────────────────── ROOT ───────────────────────────
  root: {
    id: 'root',
    reply: 'What would you like help with? Choose a topic, or type your own question.',
    options: [
      { label: '🌾 Crop Classification', next: 'crop' },
      { label: '💧 Irrigation Advice',   next: 'irrigation' },
      { label: '🔥 Moisture Stress',     next: 'stress' },
      { label: '🌱 Growth Stage',        next: 'phenology' },
      { label: '🛰️ How the system works', next: 'system' },
    ],
  },

  // ─────────────────────── 1. CROP CLASSIFICATION ───────────────────────
  crop: {
    id: 'crop',
    reply: 'Crop classification identifies what is growing in each field from its satellite signature. What do you want to know?',
    options: [
      { label: 'Which crops are detected?', next: 'crop_list' },
      { label: 'How accurate is it?',        next: 'crop_accuracy' },
      { label: 'Wheat vs Rice vs Cotton?',   next: 'crop_diff' },
    ],
  },
  crop_list: {
    id: 'crop_list',
    reply: 'The system classifies four classes for Punjab.',
    advice: {
      title: 'Detected Crop Classes',
      severity: 'info',
      steps: [
        'Wheat — dominant Rabi crop, peaks Feb–Mar (high NDVI).',
        'Rice — Kharif paddy, flooded signature (high NDWI early).',
        'Cotton — Kharif, rough canopy (high SAR VH/VV ratio).',
        'Fallow — bare/resting land, persistently low NDVI.',
      ],
      note: 'Non-cropland (urban, water, forest) is masked out using Dynamic World.',
    },
    options: [
      { label: 'How accurate is it?',      next: 'crop_accuracy' },
      { label: 'Wheat vs Rice vs Cotton?', next: 'crop_diff' },
    ],
  },
  crop_accuracy: {
    id: 'crop_accuracy',
    reply: 'Accuracy depends on the model and ground-truth labels.',
    advice: {
      title: 'Classification Accuracy',
      severity: 'good',
      steps: [
        'Target: >85% Overall Accuracy, Cohen\'s Kappa >0.85.',
        'Validated on a held-out 30% test split with a confusion matrix.',
        'Multi-temporal NDVI + SAR features reduce single-date confusion.',
      ],
      note: 'See the Analytics tab for live feature importances and the confusion matrix.',
    },
    options: [
      { label: 'Which crops are detected?', next: 'crop_list' },
      { label: 'Wheat vs Rice vs Cotton?',  next: 'crop_diff' },
    ],
  },
  crop_diff: {
    id: 'crop_diff',
    reply: 'Each crop has a distinct spectral + radar fingerprint.',
    advice: {
      title: 'Telling Crops Apart',
      severity: 'info',
      steps: [
        'Wheat: steady NDVI rise to a sharp Feb–Mar peak, dry (low LSWI).',
        'Rice: early water signature — high NDWI/LSWI from flooding.',
        'Cotton: moderate NDVI but high SAR VH/VV from open boll canopy.',
      ],
    },
    options: [
      { label: 'Which crops are detected?', next: 'crop_list' },
      { label: 'How accurate is it?',       next: 'crop_accuracy' },
    ],
  },

  // ─────────────────────── 2. IRRIGATION ───────────────────────
  irrigation: {
    id: 'irrigation',
    reply: 'Irrigation advice is driven by an 8-day FAO-56 water balance. What do you need?',
    options: [
      { label: 'How is deficit calculated?', next: 'irr_calc' },
      { label: 'When should I irrigate?',    next: 'irr_when' },
      { label: 'Crop water demand (Kc)?',    next: 'irr_kc' },
    ],
  },
  irr_calc: {
    id: 'irr_calc',
    reply: 'Water deficit = crop demand minus available water.',
    advice: {
      title: '8-Day Water Deficit (FAO-56)',
      severity: 'info',
      steps: [
        'ETc = Kc × ET0 (crop coefficient × reference evapotranspiration).',
        'Deficit ΔW = ETc − (effective rainfall + soil moisture).',
        'Thresholds: <8mm OK, <18 Monitor, <30 Irrigate Soon, ≥30 Urgent.',
      ],
    },
    options: [
      { label: 'When should I irrigate?', next: 'irr_when' },
      { label: 'Crop water demand (Kc)?', next: 'irr_kc' },
    ],
  },
  irr_when: {
    id: 'irr_when',
    reply: 'Timing depends on crop stage and deficit class.',
    advice: {
      title: 'Irrigation Timing',
      severity: 'warning',
      steps: [
        'Urgent zones (deficit ≥30mm): irrigate within 24–48h.',
        'Wheat: critical at crown-root initiation (~21 days) and flowering.',
        'Rice: keep standing water through tillering; never drain before grain fill.',
        'Apply at early morning / late evening to cut evaporation loss.',
      ],
      note: 'Prioritise Urgent zones first — see the Irrigation Advisory tab for the live list.',
    },
    options: [
      { label: 'How is deficit calculated?', next: 'irr_calc' },
      { label: 'Crop water demand (Kc)?',    next: 'irr_kc' },
    ],
  },
  irr_kc: {
    id: 'irr_kc',
    reply: 'Crop coefficient (Kc) scales reference ET to each crop.',
    advice: {
      title: 'Crop Water Demand (Kc)',
      severity: 'info',
      steps: [
        'Rice — highest demand, Kc ≈ 1.20.',
        'Wheat — Kc ≈ 1.15.',
        'Cotton — Kc ≈ 1.05.',
        'Fallow — minimal, Kc ≈ 0.30.',
      ],
      note: 'Kc can be driven dynamically from NDVI (e.g. wheat Kc = 6.3268·NDVI − 1.4207).',
    },
    options: [
      { label: 'How is deficit calculated?', next: 'irr_calc' },
      { label: 'When should I irrigate?',    next: 'irr_when' },
    ],
  },

  // ─────────────────────── 3. MOISTURE STRESS ───────────────────────
  stress: {
    id: 'stress',
    reply: 'Moisture stress is detected before it is visible to the eye. What do you want to know?',
    options: [
      { label: 'How is stress detected?', next: 'stress_how' },
      { label: 'What do the levels mean?', next: 'stress_levels' },
      { label: 'Why use radar (SAR)?',     next: 'stress_sar' },
    ],
  },
  stress_how: {
    id: 'stress_how',
    reply: 'Stress fuses an optical index with a radar signal.',
    advice: {
      title: 'Stress Detection Method',
      severity: 'info',
      steps: [
        'VCI = (NDVI − NDVImin) / (NDVImax − NDVImin) — normalised greenness.',
        'SAR backscatter drop (1–2.5 dB in VH) signals drying soil/canopy.',
        'Low VCI + falling backscatter together = high stress.',
      ],
      note: 'SAR decline precedes optical decline — a pre-visual leading indicator.',
    },
    options: [
      { label: 'What do the levels mean?', next: 'stress_levels' },
      { label: 'Why use radar (SAR)?',     next: 'stress_sar' },
    ],
  },
  stress_levels: {
    id: 'stress_levels',
    reply: 'Three levels, colour-coded on the map.',
    advice: {
      title: 'Stress Levels',
      severity: 'warning',
      steps: [
        'None (green): VCI healthy, no backscatter drop.',
        'Moderate (yellow): VCI 0.35–0.55 or mild SAR drop — monitor.',
        'High (red): VCI <0.35 or >2 dB SAR drop — act soon.',
      ],
    },
    options: [
      { label: 'How is stress detected?', next: 'stress_how' },
      { label: 'Why use radar (SAR)?',    next: 'stress_sar' },
    ],
  },
  stress_sar: {
    id: 'stress_sar',
    reply: 'Radar sees what optical cannot during the monsoon.',
    advice: {
      title: 'Why SAR Matters',
      severity: 'good',
      steps: [
        'C-band SAR penetrates cloud — works in Kharif monsoon when optical fails.',
        'Sensitive to soil moisture via the dielectric constant.',
        'VH/VV ratio tracks canopy structure independent of soil moisture.',
      ],
    },
    options: [
      { label: 'How is stress detected?', next: 'stress_how' },
      { label: 'What do the levels mean?', next: 'stress_levels' },
    ],
  },

  // ─────────────────────── 4. PHENOLOGY ───────────────────────
  phenology: {
    id: 'phenology',
    reply: 'Growth-stage (phenology) tracking prevents mistaking natural senescence for drought.',
    options: [
      { label: 'What stages are tracked?', next: 'phen_stages' },
      { label: 'Why does stage matter?',   next: 'phen_why' },
    ],
  },
  phen_stages: {
    id: 'phen_stages',
    reply: 'Stages come from the NDVI time-series curve.',
    advice: {
      title: 'Phenological Stages',
      severity: 'info',
      steps: [
        'SOS — Start of Season (sowing/emergence).',
        'POS — Peak of Season (maximum canopy / NDVI peak).',
        'EOS — End of Season (senescence/harvest).',
        'Derived per-pixel via curve-fitting on the NDVI series.',
      ],
    },
    options: [
      { label: 'Why does stage matter?', next: 'phen_why' },
    ],
  },
  phen_why: {
    id: 'phen_why',
    reply: 'Stage context changes how a signal is read.',
    advice: {
      title: 'Why Stage Awareness Matters',
      severity: 'good',
      steps: [
        'NDVI naturally falls at end-of-season — that is harvest, not drought.',
        'Phenology gating avoids flagging senescence as moisture stress.',
        'Water demand (Kc) also shifts by stage, so timing advice adapts.',
      ],
    },
    options: [
      { label: 'What stages are tracked?', next: 'phen_stages' },
    ],
  },

  // ─────────────────────── 5. SYSTEM ───────────────────────
  system: {
    id: 'system',
    reply: 'The pipeline fuses optical and radar satellite data end-to-end.',
    advice: {
      title: 'How It Works',
      severity: 'info',
      steps: [
        '1. Ingest Sentinel-2 (optical) + Sentinel-1 (SAR) over your field via GEE.',
        '2. Mask non-cropland with Dynamic World; compute NDVI/NDWI/SAR indices.',
        '3. Classify crop from the seasonal signature.',
        '4. Detect stress (VCI + SAR); apply FAO-56 water balance for advisories.',
      ],
      note: 'Everything runs cloud-side on Google Earth Engine — no local downloads.',
    },
    options: [
      { label: 'Crop classification', next: 'crop' },
      { label: 'Irrigation advice',   next: 'irrigation' },
      { label: 'Moisture stress',     next: 'stress' },
    ],
  },
};