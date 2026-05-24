export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!API_KEY) return res.status(200).json({ success: false, error: 'API key not set in Vercel environment variables' });

    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(200).json({ success: false, error: 'No image received' });

    const prompt = `You are reading an Indian supplier invoice, bill, or challan for a factory maintenance store (spare parts, electrical, pipes, bearings, tools etc.).

Extract all information and return ONLY a valid JSON object. No text before or after the JSON.

Return this exact structure:
{
  "supplier_name": "company name in UPPERCASE, or null",
  "invoice_number": "bill or challan number as string, or null",
  "date": "date in YYYY-MM-DD format (convert from DD/MM/YYYY), or null",
  "items": [
    {
      "item_name": "part name in UPPERCASE",
      "size_spec": "size like 2 inch, 3/4, 1.5 etc, or null",
      "quantity": number (never null or string),
      "unit": "Nos or Kg or Mtr or Roll or Pack or Set or Ltr, or null",
      "rate": price per unit as number or null,
      "total_amount": line total as number or null
    }
  ]
}

Rules:
- Extract ALL line items - do not skip any
- supplier_name and item_name must be in UPPERCASE
- quantity must always be a number (e.g. 1, 2, 0.5)
- Convert Indian date DD/MM/YYYY to YYYY-MM-DD
- Remove rupee signs from numbers
- Return ONLY the JSON object, nothing else`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Claude API error ${aiRes.status}: ${errText.slice(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const raw = aiData.content[0].text.trim();

    let extracted;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AI returned unexpected format. Please try again with a clearer photo.');
      extracted = JSON.parse(match[0]);
    }

    if (!extracted.items) extracted.items = [];

    return res.status(200).json({ success: true, data: extracted });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}
