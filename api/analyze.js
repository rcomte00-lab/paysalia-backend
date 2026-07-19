// ============================================================================
//  Paysalia — Backend IA (Vercel Serverless Function)
//  Zéro dépendance : utilise fetch() natif de Node 18+, aucun npm install.
//
//  Flux : photo -> GPT-4o-mini (analyse) -> DALL-E 3 (1 image) -> budget calculé
//  Optimisé pour : rester sous la limite 60s de Vercel + économiser les crédits.
// ============================================================================

const OPENAI = 'https://api.openai.com/v1';

// ─── Base de prix (matériaux, plantes, main d'œuvre) ───
const PRICE_DATABASE = {
  lavender: { unitPrice: 8.5, unit: 'plant', category: 'plant' },
  olive_tree: { unitPrice: 120, unit: 'tree', category: 'plant' },
  stone_pavers: { unitPrice: 45, unit: 'm2', category: 'material' },
  terracotta_planters: { unitPrice: 35, unit: 'unit', category: 'material' },
  irrigation_system: { unitPrice: 680, unit: 'system', category: 'structure' },
  raised_bed: { unitPrice: 85, unit: 'unit', category: 'structure' },
  tomato_plants: { unitPrice: 4.5, unit: 'plant', category: 'plant' },
  lettuce_mix: { unitPrice: 2.5, unit: 'plant', category: 'plant' },
  herb_collection: { unitPrice: 5, unit: 'plant', category: 'plant' },
  potting_soil: { unitPrice: 120, unit: 'm3', category: 'material' },
  feature_boulders: { unitPrice: 180, unit: 'unit', category: 'material' },
  bamboo: { unitPrice: 65, unit: 'plant', category: 'plant' },
  japanese_maple: { unitPrice: 280, unit: 'tree', category: 'plant' },
  raked_gravel: { unitPrice: 55, unit: 'm2', category: 'material' },
  wooden_bridge: { unitPrice: 650, unit: 'unit', category: 'structure' },
  moss_ground_cover: { unitPrice: 35, unit: 'm2', category: 'plant' },
  stepping_stones: { unitPrice: 28, unit: 'unit', category: 'material' },
  wisteria: { unitPrice: 45, unit: 'plant', category: 'plant' },
  gravel_border: { unitPrice: 25, unit: 'm2', category: 'material' },
  planting_labor: { unitPrice: 450, unit: 'project', category: 'labor' },
  design_labor: { unitPrice: 1200, unit: 'project', category: 'labor' },
  installation_labor: { unitPrice: 350, unit: 'project', category: 'labor' },
};

const PREFERENCE_ITEMS = {
  edible: ['raised_bed', 'tomato_plants', 'lettuce_mix', 'herb_collection', 'potting_soil', 'planting_labor'],
  flowering: ['lavender', 'wisteria', 'potting_soil', 'planting_labor', 'gravel_border'],
  structural: ['stone_pavers', 'gravel_border', 'feature_boulders', 'stepping_stones', 'installation_labor'],
  woodwork: ['wooden_bridge', 'wisteria', 'planting_labor'],
  zen: ['bamboo', 'japanese_maple', 'raked_gravel', 'feature_boulders', 'moss_ground_cover', 'stepping_stones', 'design_labor'],
  cottage: ['lavender', 'wisteria', 'stone_pavers', 'gravel_border', 'planting_labor'],
};

const PREF_TEXT = {
  edible: 'potager comestible avec legumes, herbes aromatiques et arbres fruitiers',
  flowering: 'jardin fleuri avec rosiers, lavande, pivoines et fleurs saisonnieres',
  structural: 'allees pavees, murets en pierre seche, terrasses et escaliers',
  woodwork: 'pergola en chene, terrasse bois, bancs et clotures naturelles',
  zen: 'jardin zen japonais avec gravier, bambou, pierres et bassin',
  cottage: 'jardin cottage anglais romantique avec bordures fleuries',
};

// Visuels locaux pour la grille (évite 4 générations DALL-E coûteuses et lentes).
// Ces chemins existent déjà dans le frontend (public/assets/).
const GRID_ASSETS = [
  '/assets/design-cottage.jpg',
  '/assets/design-zen.jpg',
  '/assets/design-pergola.jpg',
  '/assets/design-mediterranean.jpg',
];

// ─── 1. Analyse de la photo (GPT-4o-mini vision) ───
async function analyzeGardenPhoto(imageBase64, apiKey) {
  const r = await fetch(`${OPENAI}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                "Tu es un paysagiste expert. Analyse cette photo d'espace exterieur et retourne UNIQUEMENT un JSON valide (aucun texte autour) avec cette structure exacte:\n" +
                '{"soilDrainage":"description","exposure":"South-facing / North-facing / East-facing / West-facing","slope":"description","climateZone":"zone Köppen ex Temperate Cfb","sunHours":7.5,"windExposure":"description","detectedElements":["element1","element2"],"recommendedStyle":"style","estimatedArea":50}\n' +
                'estimatedArea en m2. Sois precis et professionnel.',
            },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Analyse (GPT-4o) échouée : ${r.status} ${err.slice(0, 200)}`);
  }

  const data = await r.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message.content) || '{}';
  const match = content.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : '{}');
}

// ─── 2. Génération du design (DALL-E 3, une seule image) ───
async function generateGardenDesign(analysis, preferences, inspiration, apiKey) {
  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ');
  const elements = (analysis.detectedElements || []).join(', ');

  const prompt =
    'Professional watercolor landscape architect concept sketch on cream textured paper. ' +
    `Garden design for a ${analysis.estimatedArea || 50}m2 ${(analysis.exposure || '').toLowerCase()} outdoor space in ${analysis.climateZone || 'temperate'} climate. ` +
    `Features: ${prefText}. ` +
    (inspiration ? `Client inspiration: ${inspiration}. ` : '') +
    (elements ? `Incorporate existing elements: ${elements}. ` : '') +
    'Style: loose ink and watercolor washes, pencil underdrawing visible, botanical illustration, labeled plant positions, compass rose. Soft sage greens, lavender, terracotta tones. No text, no letters.';

  const r = await fetch(`${OPENAI}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt.slice(0, 3900), // limite DALL-E 3 : 4000 caractères
      n: 1,
      size: '1792x1024',
      quality: 'standard',
      style: 'vivid',
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Génération (DALL-E) échouée : ${r.status} ${err.slice(0, 200)}`);
  }

  const data = await r.json();
  return (data.data && data.data[0] && data.data[0].url) || '';
}

// ─── 3. Calcul du budget ───
function generateBudget(area, preferences, budgetRange) {
  const multiplier = { low: 0.5, medium: 1, high: 2, luxury: 4 }[budgetRange] || 1;
  const areaFactor = (area || 50) / 50;

  const itemIds = new Set();
  (preferences || []).forEach((p) => (PREFERENCE_ITEMS[p] || []).forEach((id) => itemIds.add(id)));
  itemIds.add('planting_labor');
  if ((area || 50) > 30) itemIds.add('irrigation_system');

  const items = Array.from(itemIds).map((id) => {
    const price = PRICE_DATABASE[id];
    const baseQty = id.includes('labor') ? 1 : Math.max(1, Math.ceil(2 * areaFactor));
    const qty = Math.ceil(baseQty * multiplier);
    return {
      name: id.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      quantity: `${qty} ${price.unit}`,
      unitPrice: price.unitPrice,
      totalPrice: Math.round(price.unitPrice * qty * 100) / 100,
      category: price.category,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const vatRate = 20;
  const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  return { items, subtotal: Math.round(subtotal * 100) / 100, vatRate, vatAmount, total: Math.round((subtotal + vatAmount) * 100) / 100 };
}

// ─── Handler principal ───
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY manquante dans les variables d\'environnement Vercel' });
  }

  try {
    // Vercel parse déjà req.body si Content-Type: application/json.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { image, preferences, inspiration, budgetRange } = body;

    if (!image) return res.status(400).json({ error: 'Image requise' });

    const analysis = await analyzeGardenPhoto(image, apiKey);
    const mainImage = await generateGardenDesign(analysis, preferences, inspiration, apiKey);
    const budget = generateBudget(analysis.estimatedArea || 50, preferences, budgetRange);

    return res.status(200).json({
      success: true,
      analysis,
      design: { mainImage, gridImages: GRID_ASSETS },
      budget,
    });
  } catch (err) {
    console.error('Erreur analyze:', err);
    return res.status(500).json({ error: (err && err.message) || 'Génération impossible' });
  }
};
