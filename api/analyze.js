// ============================================================================
//  Paysalia — Backend IA v3 (Vercel Serverless Function)
//  Vision : remplacer un paysagiste — analyse de site, palette végétale
//  régionale détaillée, conseils de pro, devis chiffré, rendu photo réaliste.
//
//  Optimisations : analyse et image générées EN PARALLÈLE (Promise.all)
//  pour tenir largement sous la limite de 60s de Vercel.
// ============================================================================

const OPENAI = 'https://api.openai.com/v1';

// ─── Données climatiques réelles (Open-Meteo, gratuit, sans clé API) ───
// Transforme une ville en coordonnées, puis récupère les vraies normales
// climatiques (mini hivernal, pluviométrie) pour fiabiliser le choix des plantes.
async function fetchClimateData(location) {
  if (!location || !location.trim()) return null;

  // Petit helper : fetch avec timeout, pour ne JAMAIS bloquer l'analyse si
  // Open-Meteo est lent ou injoignable.
  const fetchT = async (url, ms = 4000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { signal: ctrl.signal }); }
    finally { clearTimeout(id); }
  };

  try {
    // 1) Géocodage : "Aubenas" -> lat/lng
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location.trim())}&count=1&language=fr`;
    const geoRes = await fetchT(geoUrl);
    if (!geoRes.ok) return null;
    const geo = await geoRes.json();
    const place = geo.results && geo.results[0];
    if (!place) return null;
    const { latitude, longitude, name, admin1, country } = place;

    // 2) Normales climatiques sur ~10 ans (température min quotidienne, précipitations)
    const start = '2014-01-01', end = '2023-12-31';
    const archUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${start}&end_date=${end}&daily=temperature_2m_min,precipitation_sum&timezone=auto`;
    const archRes = await fetchT(archUrl, 5000);
    if (!archRes.ok) return { latitude, longitude, place: [name, admin1, country].filter(Boolean).join(', ') };
    const arch = await archRes.json();

    const mins = (arch.daily && arch.daily.temperature_2m_min) || [];
    const precs = (arch.daily && arch.daily.precipitation_sum) || [];
    const absoluteMin = mins.length ? Math.min(...mins.filter((v) => v !== null)) : null;
    const avgAnnualPrecip = precs.length ? Math.round(precs.filter((v) => v !== null).reduce((a, b) => a + b, 0) / 10) : null;

    // 3) Zone de rusticité USDA à partir du mini absolu (°C)
    const usda = absoluteMin === null ? null : (
      absoluteMin >= -1 ? '10' : absoluteMin >= -7 ? '9' : absoluteMin >= -12 ? '8' :
      absoluteMin >= -18 ? '7' : absoluteMin >= -23 ? '6' : absoluteMin >= -29 ? '5' : '4'
    );

    return {
      latitude, longitude,
      place: [name, admin1, country].filter(Boolean).join(', '),
      winterMinC: absoluteMin !== null ? Math.round(absoluteMin) : null,
      annualPrecipMm: avgAnnualPrecip,
      hardinessZone: usda,
    };
  } catch (e) {
    console.error('Climat Open-Meteo indisponible:', e && e.message);
    return null;
  }
}

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
  const { preferences, inspiration, budgetRange, location, maintenanceLevel, usages, allergies, houseStyle, climate } = opts || {};

  const prefText = (preferences || []).map((p) => PREF_TEXT[p] || p).join(', ') || 'jardin polyvalent';
  const budgetHint = { low: 'budget serré', medium: 'budget moyen', high: 'budget confortable', luxury: 'budget haut de gamme' }[budgetRange] || 'budget moyen';

  // Si on a de vraies données climatiques, on les donne à l'IA comme FAITS
  // vérifiés — elle ne devine plus, elle s'appuie dessus.
  let locText;
  if (climate) {
    locText =
      `DONNÉES CLIMATIQUES RÉELLES pour ${climate.place} (source météo, à respecter impérativement) : ` +
      (climate.winterMinC !== null ? `température minimale hivernale observée ≈ ${climate.winterMinC}°C ; ` : '') +
      (climate.hardinessZone ? `zone de rusticité USDA ${climate.hardinessZone} ; ` : '') +
      (climate.annualPrecipMm ? `pluviométrie annuelle ≈ ${climate.annualPrecipMm} mm. ` : '') +
      `Ne propose QUE des plantes qui survivent à ${climate.winterMinC !== null ? climate.winterMinC + '°C' : 'ce climat'} et adaptées à cette pluviométrie. `;
  } else if (location) {
    locText = `Le client se situe à/en : ${location}. Adapte TOUT (climat, plantes, périodes) à cette localisation précise. `;
  } else {
    locText = "Déduis la région/le climat probable des indices visibles (végétation, architecture, lumière). ";
  }

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
      max_tokens: 4000,
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
                '"maintenanceCalendar":[{"period":"Printemps","tasks":["tâche 1","tâche 2"]},{"period":"Été","tasks":["..."]},{"period":"Automne","tasks":["..."]},{"period":"Hiver","tasks":["..."]}],' +
                '"layoutPlan":{"description":"1 phrase décrivant l\'organisation générale","zones":[{"name":"nom de la zone (ex: Coin potager)","x":10,"y":15,"width":35,"height":30,"color":"#4c855a","content":"ce qu\'on y met (plantes/matériaux du projet)"}]},' +
                '"workPhases":[{"phase":1,"title":"titre de l\'étape","season":"meilleure saison","duration":"durée estimée","tasks":["tâche concrète 1","tâche 2"],"diyLevel":"facile/modéré/pro recommandé"}],' +
                '"shoppingList":[{"category":"Végétaux ou Matériaux ou Outillage","items":["article précis avec quantité"]}]' +
                '}\n' +
                "IMPORTANT : 5 à 8 plantes VARIÉES, réellement adaptées au climat de la région ET à ce que tu observes (exposition, sol, pente). Prix du marché français réalistes en euros. Quantités cohérentes avec la surface estimée. " +
                "POUR layoutPlan : positionne 3 à 6 zones sur un plan vu de dessus de l'espace, en te basant sur ce que tu vois dans la photo (x, y, width, height en POURCENTAGES de 0 à 100, sans chevauchement excessif). Utilise des couleurs parmi : #4c855a (végétal), #c4783f (terrasse/bois), #8b7ec7 (fleuri), #6b8fa3 (eau), #a0895c (allée/minéral). " +
                "POUR workPhases : 3 à 5 phases dans l'ORDRE logique de chantier (préparation du sol AVANT plantation, structures AVANT végétaux...). " +
                "POUR shoppingList : consolide TOUT ce qu'il faut acheter pour réaliser le projet, avec les quantités.",
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
  const parsed = JSON.parse(match ? match[0] : '{}');

  // Normalisation du calendrier : le frontend attend tasks sous forme de tableau.
  // Si l'IA a renvoyé une chaîne ("tonte, paillage"), on la découpe en liste.
  if (Array.isArray(parsed.maintenanceCalendar)) {
    parsed.maintenanceCalendar = parsed.maintenanceCalendar.map((item) => {
      let tasks = item.tasks ?? item.taches ?? [];
      if (typeof tasks === 'string') {
        tasks = tasks.split(/[,;•·\n]/).map((s) => s.trim()).filter(Boolean);
      }
      return { period: item.period || item.periode || '', tasks: Array.isArray(tasks) ? tasks : [] };
    });
  }

  return parsed;
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

    // Le climat réel fiabilise les plantes, mais n'est jamais bloquant : s'il
    // échoue ou tarde (timeouts internes de 4-5s), l'analyse se fait sans lui.
    const climate = await fetchClimateData(location).catch(() => null);

    // Analyse (nourrie du climat réel si dispo) ET image en PARALLÈLE.
    const analyzeOpts = { preferences, inspiration, budgetRange, location, maintenanceLevel, usages, allergies, houseStyle, climate };
    const [analysis, mainImage] = await Promise.all([
      analyzeGardenPhoto(image, analyzeOpts, apiKey),
      generateGardenDesign(preferences, inspiration, apiKey, image),
    ]);

    const budget = generateBudget(analysis);

    // On fait remonter les vraies données climatiques dans l'analyse : elles
    // priment sur ce que l'IA aurait estimé (affichage "climat vérifié").
    if (climate) {
      if (climate.hardinessZone) analysis.hardinessZone = climate.hardinessZone;
      if (climate.place) analysis.region = climate.place;
      analysis.climateVerified = true;
      analysis.winterMinC = climate.winterMinC;
      analysis.annualPrecipMm = climate.annualPrecipMm;
    }

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
