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
// GPT-4o interprète RÉELLEMENT la photo + les styles voulus, et propose
// lui-même les plantes, matériaux et main d'œuvre adaptés, avec quantités et prix.
async function analyzeGardenPhoto(imageBase64, preferences, inspiration, budgetRange, apiKey) {
  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ') || 'jardin polyvalent';
  const budgetHint = { low: 'budget serré', medium: 'budget moyen', high: 'budget confortable', luxury: 'budget haut de gamme' }[budgetRange] || 'budget moyen';

  const r = await fetch(`${OPENAI}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1600,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                "Tu es un paysagiste-conseil expert. Regarde ATTENTIVEMENT cette photo précise et interprète l'espace réel (taille, sol, exposition, éléments existants, pente, murs, accès). " +
                `Le client souhaite ce style : ${prefText}. ${inspiration ? `Inspiration du client : ${inspiration}. ` : ''}Contrainte : ${budgetHint}. ` +
                "En te basant sur CE que tu vois vraiment dans la photo (pas des généralités), propose un aménagement chiffré et réaliste avec des prix du marché français en euros. " +
                "Retourne UNIQUEMENT un JSON valide (aucun texte autour) avec EXACTEMENT cette structure :\n" +
                '{' +
                '"soilDrainage":"ce que tu observes du sol",' +
                '"exposure":"South-facing/North-facing/East-facing/West-facing selon la lumière visible",' +
                '"slope":"pente observée",' +
                '"climateZone":"zone Köppen probable",' +
                '"sunHours":7.5,' +
                '"windExposure":"exposition au vent observée",' +
                '"detectedElements":["éléments réellement visibles sur la photo"],' +
                '"recommendedStyle":"style retenu",' +
                '"estimatedArea":50,' +
                '"plants":[{"name":"nom de plante adapté","quantity":6,"unit":"plant","unitPrice":8.5}],' +
                '"materials":[{"name":"matériau/structure","quantity":15,"unit":"m2","unitPrice":25}],' +
                '"labor":[{"name":"poste de main d\'œuvre","quantity":1,"unit":"projet","unitPrice":800}]' +
                '}\n' +
                "estimatedArea en m2. Propose 4 à 7 plantes VARIÉES et cohérentes avec ce que tu vois et le style, 2 à 4 matériaux/structures, 1 à 2 postes de main d'œuvre. Adapte les quantités à la surface estimée. Prix réalistes.",
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

// ─── 2. Transformation de la photo (gpt-image-1 en mode édition) ───
// Prend la VRAIE photo du client et la réaménage en gardant le lieu, la
// perspective, la maison et les murs — pour un vrai "avant/après" projeté.
async function generateGardenDesign(analysis, preferences, inspiration, apiKey, imageBase64) {
  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ');

  const editPrompt =
    'Transform this outdoor space into a beautifully landscaped garden. ' +
    'Keep the EXACT same viewpoint, camera angle, perspective and lighting as the original photo. ' +
    'Keep all existing architecture unchanged: house, walls, fences, boundaries, buildings in the background. ' +
    `Redesign only the garden and ground areas with: ${prefText}. ` +
    (inspiration ? `Client wish: ${inspiration}. ` : '') +
    'Photorealistic professional landscape design rendering, lush, inviting and realistic, ' +
    'so the client can visualize the real transformation of their own space. High quality, natural daylight.';

  // ── Tentative 1 : édition de la vraie photo (le rendu souhaité) ──
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('image', new Blob([buffer], { type: 'image/jpeg' }), 'photo.jpg');
    form.append('prompt', editPrompt.slice(0, 3900));
    form.append('size', '1536x1024');
    form.append('quality', 'medium');
    form.append('n', '1');

    const r = await fetch(`${OPENAI}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // FormData gère le Content-Type
      body: form,
    });

    if (r.ok) {
      const data = await r.json();
      const item = data.data && data.data[0];
      if (item && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item && item.url) return item.url;
    } else {
      console.error('Édition photo échouée:', r.status, (await r.text()).slice(0, 200));
    }
  } catch (e) {
    console.error('Erreur édition photo:', e && e.message);
  }

  // ── Tentative 2 (secours) : génération d'une esquisse à partir de zéro ──
  const genPrompt =
    'Professional photorealistic landscape design rendering of a garden. ' +
    `A ${analysis.estimatedArea || 50}m2 ${(analysis.exposure || '').toLowerCase()} outdoor space in ${analysis.climateZone || 'temperate'} climate. ` +
    `Features: ${prefText}. ` +
    (inspiration ? `Client wish: ${inspiration}. ` : '') +
    'Lush, inviting, natural daylight, high quality.';

  const r2 = await fetch(`${OPENAI}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: genPrompt.slice(0, 3900), n: 1, size: '1536x1024' }),
  });

  if (r2.ok) {
    const data = await r2.json();
    const item = data.data && data.data[0];
    if (item && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item && item.url) return item.url;
  }

  throw new Error(`Génération image échouée : ${r2.status} ${(await r2.text()).slice(0, 200)}`);
}

// ─── 3. Calcul du budget à partir de ce que l'IA a proposé ───
// Utilise les plantes / matériaux / main d'œuvre que GPT-4o a déduits de la photo.
// Repli sur la table figée uniquement si l'IA n'a rien renvoyé d'exploitable.
function generateBudget(analysis, preferences, budgetRange) {
  const cleanList = (arr, category) =>
    (Array.isArray(arr) ? arr : [])
      .map((it) => {
        const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
        const unitPrice = Math.max(0, Number(it.unitPrice) || 0);
        const unit = (it.unit || 'u').toString();
        const name = (it.name || '').toString().trim();
        if (!name || unitPrice <= 0) return null;
        return {
          name,
          quantity: `${qty} ${unit}`,
          unitPrice: Math.round(unitPrice * 100) / 100,
          totalPrice: Math.round(unitPrice * qty * 100) / 100,
          category,
        };
      })
      .filter(Boolean);

  let items = [
    ...cleanList(analysis.plants, 'plant'),
    ...cleanList(analysis.materials, 'material'),
    ...cleanList(analysis.labor, 'labor'),
  ];

  // Repli : si l'IA n'a proposé aucun item, on utilise l'ancienne table figée.
  if (items.length === 0) {
    const area = analysis.estimatedArea || 50;
    const multiplier = { low: 0.5, medium: 1, high: 2, luxury: 4 }[budgetRange] || 1;
    const areaFactor = area / 50;
    const itemIds = new Set();
    (preferences || []).forEach((p) => (PREFERENCE_ITEMS[p] || []).forEach((id) => itemIds.add(id)));
    itemIds.add('planting_labor');
    if (area > 30) itemIds.add('irrigation_system');
    items = Array.from(itemIds).map((id) => {
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
  }

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

    const analysis = await analyzeGardenPhoto(image, preferences, inspiration, budgetRange, apiKey);
    const mainImage = await generateGardenDesign(analysis, preferences, inspiration, apiKey, image);
    const budget = generateBudget(analysis, preferences, budgetRange);

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
