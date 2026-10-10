
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is missing'
    });
  }

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: 'Reply with exactly: ClaimFlow Gemini connected'
            }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: 'Gemini API request failed',
        details: data.error?.message || 'Unknown error'
      });
    }

    return res.status(200).json({
      ok: true,
      message: data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Unable to connect to Gemini'
    });
  }
}
