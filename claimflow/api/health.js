// Public liveness endpoint. Does not expose secrets or claim Gemini availability.
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok', service: 'claimflow-api' });
}
