// Konfigurasi Model Berdasarkan Provider (Final)
const VISION_MODELS = [
  { provider: 'groq', id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, // Model Vision utama Groq yang aktif saat ini
  { provider: 'gemini', id: 'gemini-2.5-flash' },                        // Cadangan 1
  { provider: 'gemini', id: 'gemini-2.0-flash' }                         // Cadangan 2
];

// Fungsi Request ke Groq Vision
async function callGroqVision(apiKey, model, imageBase64, mimeType, prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
        ]
      }],
      temperature: 0.1,
      max_tokens: 400
    })
  });
  return { status: response.status, data: await response.json() };
}

// Fungsi Request ke Gemini Vision (Native Fetch Tanpa SDK tambahan)
async function callGeminiVision(apiKey, model, imageBase64, mimeType, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType, data: imageBase64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 400,
        responseMimeType: "application/json" // Memaksa Gemini merespons dalam format JSON bersih
      }
    })
  });
  return { status: response.status, data: await response.json() };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 tidak ada di request' });

    // Membaca kedua API Key dari Environment Variables Vercel
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!groqKey && !geminiKey) {
      return res.status(500).json({ error: 'API Key (GROQ atau GEMINI) belum di-set di Vercel' });
    }

    const today = new Date().toISOString().split('T')[0];
    const prompt = `Kamu adalah asisten pencatatan keuangan pribadi. Baca gambar nota/struk/receipt/kwitansi ini dengan teliti.

Tentukan informasi berikut lalu balas HANYA dengan JSON murni (tanpa markdown, tanpa backtick, tanpa penjelasan):
{
  "type": "expense",
  "tanggal": "YYYY-MM-DD",
  "nominal": 75000,
  "keterangan": "deskripsi singkat transaksi",
  "kategori": "Jajan",
  "kategori_custom": "",
  "wallet": "Tunai"
}

=== ATURAN TYPE ===
- "expense": pembayaran/pembelian/pengeluaran
- "income": bukti penerimaan uang/gaji/hasil jual

=== ATURAN KATEGORI ===
Jika expense, pilih SATU: Bensin, Body care, Dating, Ganti Oli, Infak, Jajan, Jalan-jalan, Makan dan Minum, Make up, Ngasih Ortu, Ngopi, Ojek, Parkir, Kuota/Wifi, Sabun Muka, Shopping, Skincare, Staycation, Sunscreen, Tabungan, Lainnya
Jika income, pilih SATU: Gaji / Upah, Hasil Usaha / Bisnis, Bonus / THR, Pemberian / Uang Saku, Pencairan Investasi, Lainnya

Panduan: Klinik/dokter/apotek → Lainnya | Makan/cafe → Makan dan Minum | Grab/Gojek → Ojek | Belanja online/mall → Shopping | Listrik/internet → Kuota/Wifi

=== ATURAN WALLET ===
Pilih SATU: Tunai, Muamalat, BSI, Bank Jago, SeaBank, Blu, e-Wallet
CASH/Tunai → Tunai | QRIS/GoPay/OVO/Dana → e-Wallet | Tidak ada petunjuk → Tunai

=== ATURAN LAIN ===
- tanggal: YYYY-MM-DD, jika tidak ada gunakan: ${today}
- nominal: total akhir dibayar, angka bulat tanpa simbol
- keterangan: nama toko + jenis transaksi, maks 60 karakter
- kategori_custom: isi HANYA jika kategori="Lainnya", tulis jenis pengeluaran 2-4 kata (contoh: "Perawatan Gigi"). Selain itu isi "".
- Balas HANYA JSON, tidak ada teks lain`;

    let lastError = '';

    // Loop Evaluasi Lintas Provider
    for (const item of VISION_MODELS) {
      console.log(`Mencoba akses [${item.provider.toUpperCase()}] dengan model: ${item.id}`);
      
      try {
        let status, data;

        // Eksekusi Berdasarkan Jenis Provider
        if (item.provider === 'groq') {
          if (!groqKey) { console.warn('Groq Key tidak tersedia, skip ke model berikutnya...'); continue; }
          const resGroq = await callGroqVision(groqKey, item.id, imageBase64, mimeType, prompt);
          status = resGroq.status;
          data = resGroq.data;
        } else if (item.provider === 'gemini') {
          if (!geminiKey) { console.warn('Gemini Key tidak tersedia, skip ke model berikutnya...'); continue; }
          const resGemini = await callGeminiVision(geminiKey, item.id, imageBase64, mimeType, prompt);
          status = resGemini.status;
          data = resGemini.data;
        }

        // Jika HTTP Status bermasalah (429, 400, 503, dll), lempar ke model fallback berikutnya
        if (status !== 200) {
          const reason = data?.error?.message || `HTTP ${status}`;
          console.warn(`Model ${item.id} gagal dieksekusi (${reason})`);
          lastError = `${item.id} (${item.provider}): ${reason}`;
          continue;
        }

        // Ekstraksi Teks Hasil Berdasarkan Struktur Struktur Respons Masing-masing Provider
        let rawText = '';
        if (item.provider === 'groq') {
          rawText = data?.choices?.[0]?.message?.content || '';
        } else if (item.provider === 'gemini') {
          rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        if (!rawText) { lastError = `${item.id}: Respons teks kosong`; continue; }

        // Proses Pembersihan Struktur JSON
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { lastError = `${item.id}: Pola regex JSON tidak ditemukan`; continue; }

        const hasil = JSON.parse(jsonMatch[0]);
        if (!hasil.nominal && !hasil.keterangan) { lastError = `${item.id}: Atribut esensial gagal diekstrak`; continue; }

        // Validasi Aturan Isian Data Finansial
        const validTypes   = ['expense', 'income'];
        const validWallets = ['Tunai', 'Muamalat', 'BSI', 'Bank Jago', 'SeaBank', 'Blu', 'e-Wallet'];
        const validExpCats = ['Bensin','Body care','Dating','Ganti Oli','Infak','Jajan','Jalan-jalan','Makan dan Minum','Make up','Ngasih Ortu','Ngopi','Ojek','Parkir','Kuota/Wifi','Sabun Muka','Shopping','Skincare','Staycation','Sunscreen','Tabungan','Lainnya'];
        const validIncCats = ['Gaji / Upah','Hasil Usaha / Bisnis','Bonus / THR','Pemberian / Uang Saku','Pencairan Investasi','Lainnya'];

        if (!validTypes.includes(hasil.type))     hasil.type   = 'expense';
        if (!validWallets.includes(hasil.wallet)) hasil.wallet = 'Tunai';
        const validCats = hasil.type === 'income' ? validIncCats : validExpCats;
        if (!validCats.includes(hasil.kategori))  hasil.kategori = 'Lainnya';

        console.log(`Berhasil memproses dokumen dengan model: ${item.id} [${item.provider.toUpperCase()}]`);
        return res.status(200).json({ hasil, model_used: item.id, provider: item.provider });

      } catch (err) {
        lastError = `${item.id} (${item.provider}): ${err.message}`;
        console.error(`Sistem Error pada model ${item.id}:`, err.message);
        continue;
      }
    }

    return res.status(503).json({
      error: `Seluruh model pemroses Vision tidak tersedia saat ini. Log terakhir: ${lastError}`
    });

  } catch (err) {
    console.error('Fatal Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
