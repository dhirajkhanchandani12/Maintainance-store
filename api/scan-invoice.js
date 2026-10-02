export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!API_KEY) return res.status(200).json({ success: false, error: 'API key not configured in Vercel environment variables' });

    const { imageBase64, mediaType } = req.body;
    if (!imageBase64) return res.status(200).json({ success: false, error: 'No image received' });

    const prompt = `You are reading an Indian supplier invoice, bill, or challan for a factory maintenance store.

=== CRITICAL: INDIAN DATE FORMAT ===
Indian invoices use DD/MM/YYYY (Day FIRST, then Month, then Year).
- "09/10/2026" = 9th October 2026 → output "2026-10-09"
- "15/08/2026" = 15th August 2026 → output "2026-08-15"
- "01/09/2026" = 1st September 2026 → output "2026-09-01"
NEVER treat the first number as month. Day is always first in Indian invoices.

=== CRITICAL: INDIAN NUMBER FORMAT ===
Indian numbers use commas differently. Remove all commas when reading amounts.
- "6,000" = 6000
- "1,25,000" = 125000
- "₹3,500.00" = 3500

=== CRITICAL: LINE ITEM AMOUNTS ===
For each line item in the invoice table, read the LAST column (Total / Amount / Line Total).
Do NOT read subtotals, GST amounts, or the grand total as a line item amount.
Each line item has: Description, HSN code (ignore), Quantity, Unit, Rate, and then the Line Total.
The Line Total = Quantity × Rate. Extract this for each row.

Return ONLY a valid JSON object. Absolutely no other text.

{
  "supplier_name": "full company name in UPPERCASE, or null",
  "invoice_number": "invoice/bill/challan number as string, or null",
  "date": "YYYY-MM-DD (convert from DD/MM/YYYY — DAY IS FIRST), or null",
  "items": [
    {
      "item_name": "part description in UPPERCASE (concise, remove HSN/SAC codes)",
      "size_spec": "size or spec like 2 inch, 3/4 inch, etc., or null",
      "quantity": number (must be numeric, never null),
      "unit": "Nos or Kg or Mtr or Roll or Pack or Set or Ltr, best guess if not clear",
      "rate": rate per unit as plain number (remove ₹ and commas) or null,
      "total_amount": line total as plain number (remove ₹ and commas) or null
    }
  ]
}

Additional rules:
- Extract EVERY line item from the bill table — do not miss any
- supplier_name and item_name: UPPERCASE only
- If rate × quantity gives a different number than the shown line total, use the SHOWN line total
- Return ONLY the JSON object, nothing else before or after it`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
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
      if (!match) throw new Error('Could not read the bill. Please try a clearer photo.');
      extracted = JSON.parse(match[0]);
    }

    if (!extracted.items) extracted.items = [];

    // Post-process: clean up any remaining ₹ signs or commas in numbers
    extracted.items = extracted.items.map(item => ({
      ...item,
      quantity: typeof item.quantity === 'string'
        ? parseFloat(item.quantity.replace(/[,₹\s]/g, '')) || 0
        : item.quantity,
      rate: item.rate != null
        ? (typeof item.rate === 'string' ? parseFloat(item.rate.replace(/[,₹\s]/g, '')) : item.rate)
        : null,
      total_amount: item.total_amount != null
        ? (typeof item.total_amount === 'string' ? parseFloat(item.total_amount.replace(/[,₹\s]/g, '')) : item.total_amount)
        : null
    }));

    return res.status(200).json({ success: true, data: extracted });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}
