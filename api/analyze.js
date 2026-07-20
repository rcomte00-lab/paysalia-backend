// ============================================================================
//  Paysalia — Backend IA v3 (Vercel Serverless Function)
//  Vision : remplacer un paysagiste — analyse de site, palette végétale
//  régionale détaillée, conseils de pro, devis chiffré, rendu photo réaliste.
//
//  Optimisations : analyse et image générées EN PARALLÈLE (Promise.all)
//  pour tenir largement sous la limite de 60s de Vercel.
// ============================================================================

const OPENAI = 'https://api.openai.com/v1';

const PREF_TEXT = {
  edible: 'potager comestible avec legumes, herbes aromatiques et arbres fruitiers',
  flowering: 'jardin fleuri avec rosiers, lavande, pivoines et fleurs saisonnieres',
  structural: 'allees pavees, murets en pierre seche, terrasses et escaliers',
  woodwork: 'pergola en chene, terrasse bois, bancs et clotures naturelles',
  zen: 'jardin zen japonais avec gravier, bambou, pierres et bassin',
  cottage: 'jardin cottage anglais romantique avec bordures fleuries',
};

// ─── 1. Analyse paysagiste complète (GPT-4o-mini vision) ───
// Joue le rôle du paysagiste-conseil : lit la photo, croise avec la région
// et les envies du client, et livre un dossier complet.
async function analyzeGardenPhoto(imageBase64, opts, apiKey) {
  const { preferences, inspiration, budgetRange, location, maintenanceLevel, usages, allergies, houseStyle } = opts || {};

  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ') || 'jardin polyvalent';
  const budgetHint = { low: 'budget serré', medium: 'budget moyen', high: 'budget confortable', luxury: 'budget haut de gamme' }[budgetRange] || 'budget moyen';
  const locText = location ? `Le client se situe à/en : ${location}. Adapte TOUT (climat, plantes, périodes) à cette localisation précise. ` : "Déduis la région/le climat probable des indices visibles (végétation, architecture, lumière). ";

  // ── Personnalisation avancée : ces contraintes doivent VRAIMENT filtrer les choix ──
  const maintText = maintenanceLevel
    ? `Niveau d'entretien souhaité : ${maintenanceLevel}/5 (1 = quasi-autonome, 5 = jardinier passionné). ${Number(maintenanceLevel) <= 2 ? "PRIVILÉGIE des plantes robustes, autonomes, peu d'arrosage et peu de taille." : Number(maintenanceLevel) >= 4 ? "Le client aime jardiner : tu peux proposer des végétaux plus exigeants et variés." : "Équilibre entre autonomie et plaisir de jardiner."} `
    : '';
  const usagesText = (usages && usages.length) ? `Usages prévus de l'espace : ${usages.join(', ')}. Adapte l'aménagement à ces usages (zones dédiées, circulation, mobilier suggéré). ` : '';
  const allergyText = (allergies && allergies.length)
    ? `CONTRAINTE IMPÉRATIVE — le client a ces sensibilités : ${allergies.join(', ')}. EXCLUS formellement toute plante à risque (fort pollen allergisant, plantes urticantes/toxiques si enfants ou animaux, plantes très mellifères si allergie aux piqûres). Mentionne dans "whyHere" que la plante est sûre pour ce profil. `
    : '';
  const houseText = houseStyle ? `Style architectural de la maison : ${houseStyle}. Recherche l'harmonie visuelle entre le jardin et ce style de maison. ` : '';

  const r = await fetch(`${OPENAI}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 2500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                "Tu es un paysagiste-conseil français expérimenté. Ton client n'a PAS de paysagiste : ton analyse doit être aussi complète et professionnelle que celle d'un vrai bureau d'études paysager. " +
                "Regarde ATTENTIVEMENT cette photo précise : sol, exposition, pente, murs, accès, végétation existante, contraintes. " +
                locText +
                `Souhaits du client : ${prefText}. ${inspiration ? `Inspiration exprimée : ${inspiration}. ` : ''}Contrainte budgétaire : ${budgetHint}. ` +
                maintText + usagesText + allergyText + houseText +
                "Réponds en FRANÇAIS. Retourne UNIQUEMENT un JSON valide (aucun texte autour) avec EXACTEMENT cette structure :\n" +
                '{' +
                '"soilDrainage":"observation du sol sur la photo",' +
                '"exposure":"exposition déduite (ex: Sud-ouest)",' +
                '"slope":"pente observée",' +
                '"climateZone":"climat de la région (ex: Méditerranéen, Océanique, Semi-continental...)",' +
                '"region":"région déduite ou fournie",' +
                '"hardinessZone":"zone de rusticité USDA estimée (ex: 8b)",' +
                '"sunHours":7.5,' +
                '"windExposure":"exposition au vent observée",' +
                '"detectedElements":["éléments réellement visibles sur la photo"],' +
                '"constraints":["contraintes du terrain à prendre en compte"],' +
                '"recommendedStyle":"style retenu et pourquoi en une phrase",' +
                '"estimatedArea":50,' +
                '"personalizationNotes":"1-2 phrases expliquant comment tu as pris en compte les contraintes du client (entretien, usages, allergies, style maison) — vide si aucune contrainte fournie",' +
                '"designConcept":"2-3 phrases : le concept d\'aménagement proposé, comme le ferait un paysagiste à son client",' +
                '"plants":[{"name":"nom courant","latinName":"nom latin","quantity":6,"unit":"plant","unitPrice":8.5,"sunNeeds":"plein soleil/mi-ombre/ombre","waterNeeds":"faible/modéré/important","floweringPeriod":"ex: juin-septembre","plantingPeriod":"ex: mars-avril ou octobre","careLevel":"facile/modéré/exigeant","careTip":"un conseil d\'entretien concret en une phrase","whyHere":"pourquoi cette plante est adaptée à CE terrain et CE climat, une phrase"}],' +
                '"materials":[{"name":"matériau/structure","quantity":15,"unit":"m2","unitPrice":25}],' +
                '"labor":[{"name":"poste de main d\'œuvre","quantity":1,"unit":"projet","unitPrice":800}],' +
                '"proTips":["3 à 5 conseils de paysagiste concrets et personnalisés pour CE projet (ordre des travaux, saison idéale, erreurs à éviter, arrosage...)"],' +
                '"maintenanceCalendar":[{"period":"Printemps","tasks":"tâches principales"},{"period":"Été","tasks":"..."},{"period":"Automne","tasks":"..."},{"period":"Hiver","tasks":"..."}]' +
                '}\n' +
                "IMPORTANT : 5 à 8 plantes VARIÉES, réellement adaptées au climat de la région ET à ce que tu observes (exposition, sol, pente). Prix du marché français réalistes en euros. Quantités cohérentes avec la surface estimée.",
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

// ─── 2. Transformation de la photo (gpt-image-1 édition) ───
// Indépendante de l'analyse → peut tourner EN PARALLÈLE.
async function generateGardenDesign(preferences, inspiration, apiKey, imageBase64) {
  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ') || 'beautiful versatile garden';

  const editPrompt =
    'Transform this outdoor space into a stunning, professionally landscaped garden. ' +
    'CRITICAL: keep the EXACT same viewpoint, camera angle, perspective, and all existing architecture ' +
    '(house, walls, stairs, fences, background buildings) unchanged. ' +
    `Redesign only the garden and ground areas with: ${prefText}. ` +
    (inspiration ? `Client wish: ${inspiration}. ` : '') +
    'Golden hour lighting, lush healthy plants, magazine-quality photorealistic landscape rendering, ' +
    'harmonious colors, inviting atmosphere. The client must recognize their own space, beautifully transformed.';

  // Tentative 1 : édition de la vraie photo
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
      headers: { Authorization: `Bearer ${apiKey}` },
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

  // Tentative 2 (secours) : génération from scratch
  const genPrompt =
    'Magazine-quality photorealistic landscape design rendering of a beautiful garden. ' +
    `Features: ${prefText}. ` +
    (inspiration ? `Style wish: ${inspiration}. ` : '') +
    'Golden hour light, lush, inviting, professional.';

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

// ─── 3. Devis construit sur les propositions de l'IA ───
function generateBudget(analysis) {
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

  const items = [
    ...cleanList(analysis.plants, 'plant'),
    ...cleanList(analysis.materials, 'material'),
    ...cleanList(analysis.labor, 'labor'),
  ];

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { image, preferences, inspiration, budgetRange, location } = body;

    if (!image) return res.status(400).json({ error: 'Image requise' });

    // Les champs de perso peuvent arriver à plat OU groupés dans `personalization`.
    // On accepte les deux formats pour rester compatible quelle que soit l'app.
    const perso = body.personalization || {};
    const maintenanceLevel = body.maintenanceLevel ?? perso.maintenanceLevel;
    const usages = body.usages ?? perso.usages;
    const allergies = body.allergies ?? perso.allergies;
    const houseStyle = body.houseStyle ?? perso.houseStyle;

    // Analyse ET image en PARALLÈLE : temps total = le plus lent des deux.
    const analyzeOpts = { preferences, inspiration, budgetRange, location, maintenanceLevel, usages, allergies, houseStyle };
    const [analysis, mainImage] = await Promise.all([
      analyzeGardenPhoto(image, analyzeOpts, apiKey),
      generateGardenDesign(preferences, inspiration, apiKey, image),
    ]);

    const budget = generateBudget(analysis);

    return res.status(200).json({
      success: true,
      analysis,
      design: { mainImage, gridImages: [] },
      budget,
    });
  } catch (err) {
    console.error('Erreur analyze:', err);
    return res.status(500).json({ error: (err && err.message) || 'Génération impossible' });
  }
};
