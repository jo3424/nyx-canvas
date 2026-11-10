'use strict';
// Nyx v2.6.6 — model zones for the Hub. Licenses never exclude a model; each card shows the exact licence.
// Checked on 10/11/2026 from official licence files where noted. Κρατάω is live from /v1/models, not this list.
const MODEL_ZONES = {
  checkedAt: '10/11/2026',
  // Υποψήφια: up to 3 per category. Licences have territorial / use limits; the user decides.
  candidates: {
    image: [
      { id: 'hunyuan-image-3', name: 'HunyuanImage 3.0', role: 'image', license: 'Tencent Hunyuan Community License', licenseNote: 'Does not apply in the EU, the United Kingdom or South Korea. You decide.', licenseUrl: 'https://huggingface.co/tencent/HunyuanImage-3.0', sizeNote: 'File size not re-checked on 10/11/2026.' },
      { id: 'qwen-image-21', name: 'Qwen-Image-2.1', role: 'image', license: 'Qwen research / evaluation licence', licenseNote: 'Research or evaluation only (official file, 10/11/2026). You decide.', licenseUrl: 'https://huggingface.co/Qwen', sizeNote: 'File size not re-checked on 10/11/2026.' },
    ],
    video: [
      { id: 'hunyuan-video-15', name: 'HunyuanVideo 1.5', role: 'video', license: 'Tencent Hunyuan Community License', licenseNote: 'Does not apply in the EU, the United Kingdom or South Korea. You decide.', licenseUrl: 'https://huggingface.co/tencent/HunyuanVideo', sizeNote: 'File size not re-checked on 10/11/2026.' },
      { id: 'minimax-h3', name: 'MiniMax H3', role: 'video', license: 'MiniMax Model License', licenseNote: 'Does not apply in the EU, the United Kingdom, South Korea or the United States. You decide.', licenseUrl: 'https://huggingface.co/MiniMaxAI', sizeNote: 'File size not re-checked on 10/11/2026.' },
    ],
  },
  // Άλλα διαθέσιμα — άδεια στην κάρτα. Not excluded.
  other: [
    { id: 'insightface', name: 'InsightFace', role: 'faces', license: 'Non-commercial research only (InsightFace model weights)', licenseNote: 'The ready-made InsightFace models (including antelopev2) are licensed for non-commercial research only. Confirmed 10/11/2026. You decide.', licenseUrl: 'https://github.com/deepinsight/insightface' },
    { id: 'pulid', name: 'PuLID', role: 'faces', license: 'Apache-2.0 (code)', licenseNote: 'Requires InsightFace antelopev2. InsightFace models are licensed for non-commercial research only (confirmed 10/11/2026). You decide.', licenseUrl: 'https://github.com/ToTheBeginning/PuLID', requires: 'InsightFace antelopev2' },
    { id: 'instantid', name: 'InstantID', role: 'faces', license: 'Apache-2.0 (code); InsightFace checkpoints: non-commercial research only', licenseNote: 'Requires InsightFace antelopev2. The InstantID code is free; the ready-made InsightFace checkpoints are licensed for non-commercial research only (confirmed 10/11/2026). You decide.', licenseUrl: 'https://github.com/InstantID/InstantID', requires: 'InsightFace antelopev2' },
    { id: 'photomaker', name: 'PhotoMaker', role: 'faces', license: 'Apache-2.0', licenseNote: 'Apache-2.0 (official file, 10/11/2026). You decide.', licenseUrl: 'https://github.com/TencentARC/PhotoMaker' },
    { id: 'sulphur-2-base', name: 'Sulphur-2-base', role: 'other', license: 'See the official licence file', licenseNote: 'Licence was not re-checked on 10/11/2026. Open the official file and decide.', licenseUrl: '' },
    { id: 'llama-32-vision', name: 'Llama 3.2 Vision', role: 'vision', license: 'Llama 3.2 Community License', licenseNote: 'Licence was not re-checked on 10/11/2026. Open the official file and decide.', licenseUrl: 'https://www.llama.com/llama3_2/license/' },
    { id: '4x-ultrasharp', name: '4x-UltraSharp', role: 'upscale', license: 'See the official licence file', licenseNote: 'Licence was not re-checked on 10/11/2026. Open the official file and decide.', licenseUrl: '' },
    { id: 'chroma-h3', name: 'Chroma-H3', role: 'other', license: 'See the official licence file', licenseNote: 'Licence was not re-checked on 10/11/2026. Open the official file and decide.', licenseUrl: '' },
  ],
  // Απορρίφθηκαν: technical reasons only. Empty on 10/11/2026.
  rejected: [],
};

function zoneMatchId(installedId, card) {
  const a = String(installedId || '').toLowerCase();
  const names = [card.id, card.name, ...(card.aliases || [])].map((s) => String(s || '').toLowerCase());
  return names.some((n) => n && (a.includes(n.replace(/\s+/g, '')) || a.includes(n) || n.includes(a.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''))));
}

if (typeof module === 'object' && module.exports) module.exports = { MODEL_ZONES, zoneMatchId };
