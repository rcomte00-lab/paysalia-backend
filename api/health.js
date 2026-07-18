// Vercel Serverless Function — vérification que le backend est en ligne.
// Zéro dépendance : rien à installer, rien qui puisse casser au déploiement.

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    status: 'ok',
    service: 'Paysalia AI Backend',
    version: '2.0.0',
    features: ['analyze', 'design', 'budget'],
  });
};
