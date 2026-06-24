const GROQ_MODELS = [
  'llama-3.3-70b-versatile',                   // Model Utama
  'meta-llama/llama-4-scout-17b-16e-instruct', // Fallback 1: Llama 4 generasi terbaru (sangat canggih)
  'llama-3.1-8b-instant'                       // Fallback 2: Versi ringan, cepat, dan stabil
];

const WEB_TRIGGERS = [
  'harga','kurs','ihsg','saham','emas','inflasi','suku bunga','bi rate',
  'dolar','usd','rupiah','ekonomi','pasar','bursa','terbaru','terkini',
  'reksa dana','obligasi','sbr','sukuk','kripto','bitcoin','forex',
  'resesi','gdp','pdb','ojk','bank indonesia','bloomberg','fed','the fed',
  'deposito rate','bunga bank','berita','hari ini','sekarang','kondisi pasar',
  'world bank','imf','oecd','adb','syariah','baznas','nber'
];

function needsWebSearch(history) {
  const last = [...history].reverse().find(m => m.role === 'user');
  if (!last) return false;
  return WEB_TRIGGERS.some(kw => last.content.toLowerCase().includes(kw));
}

const TRUSTED_DOMAINS = [
  // Internasional - Institusi
  'worldbank.org','imf.org','oecd.org','adb.org','weforum.org',
  // Internasional - Media
  'bloomberg.com','reuters.com','ft.com','wsj.com','economist.com',
  // Indonesia - Otoritas
  'bi.go.id','ojk.go.id','bps.go.id','kemenkeu.go.id','idx.co.id',
  // Indonesia - Media
  'katadata.co.id','bisnis.com','kontan.co.id','cnbcindonesia.com',
  'investordaily.id',
  // Syariah & Kajian
  'kneks.go.id','isdb.org','puskasbaznas.com','lpem-febui.org',
  // Riset Akademik
  'nber.org','ssrn.com','jepi.ui.ac.id'
];

async function tavilySearch(query, apiKey) {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query + ' ekonomi Indonesia investasi',
      max_results: 4,
      include_domains: TRUSTED_DOMAINS,
      search_depth: 'basic'
    })
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.results || []).map(r => ({
    url: r.url,
    title: r.title,
    snippet: (r.content || '').slice(0, 300)
  }));
}

async function jinaFetch(url) {
  try {
    const resp = await fetch('https://r.jina.ai/' + url, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return '';
    const text = await resp.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 800);
  } catch { return ''; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { history, konteks } = req.body;
    if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'history tidak valid' });

    const groqKey   = process.env.GROQ_API_KEY;
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY belum di-set' });

    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    const useWeb = needsWebSearch(history) && !!tavilyKey;

    // ── Tavily + Jina: ambil data real-time dari sumber terpercaya ────────────
    let webContext = '';
    if (useWeb) {
      try {
        const lastMsg = [...history].reverse().find(m => m.role === 'user')?.content || '';
        const results = await tavilySearch(lastMsg, tavilyKey);

        if (results.length > 0) {
          const contents = await Promise.all(
            results.slice(0, 2).map(async r => {
              const body = await jinaFetch(r.url);
              return `Sumber: ${r.title} (${r.url})\n${body || r.snippet}`;
            })
          );
          webContext = '\n\n=== DATA TERKINI DARI SUMBER TERPERCAYA ===\n' +
            contents.join('\n\n---\n') +
            '\n=== AKHIR DATA ===';
        }
      } catch (e) {
        console.warn('Web search gagal:', e.message);
      }
    }

    const sourceList = `World Bank, IMF, OECD, ADB, World Economic Forum, Bloomberg, Reuters, Financial Times, Wall Street Journal, The Economist, Bank Indonesia, OJK, BPS, Kemenkeu RI, Bursa Efek Indonesia, Katadata, Bisnis Indonesia, Kontan, CNBC Indonesia, Investor Daily, KNEKS, Islamic Development Bank, Puskas BAZNAS, LPEM FEB UI, NBER, SSRN, Jurnal Ekonomi dan Pembangunan Indonesia`;

    const systemPrompt = `Kamu adalah Chief Financial Advisor & Investment Manager pribadi klien — profesional keuangan senior dengan akses ke sumber data ekonomi global dan domestik terpercaya.

Basis pengetahuan dan sumber rujukan kamu mencakup:
${sourceList}

Data keuangan klien:
${konteks}
${webContext}

Hari ini: ${today}

Tugas:
- AUDIT: Identifikasi kebocoran anggaran, anomali, saving rate, kesehatan dana darurat. Jangan sekadar mengulang angka — berikan interpretasi dan konteks yang tajam, stright to the point atau spesifik, bukan wawasan umum, mendetail.
- INVESTASI: Rekomendasi instrumen (reksa dana, deposito, saham, emas, sukuk/SBR) sesuai kondisi keuangan klien${useWeb && webContext ? ', diperkuat data terkini dari sumber di atas' : ', berbasis pengetahuan dari sumber terpercaya'}.
- PERENCANAAN: Roadmap finansial — dana darurat ideal, target investasi bulanan, proyeksi pertumbuhan kekayaan berdasarkan tren historis data mereka.
- RISIKO: Deteksi potensi defisit atau ketergantungan satu sumber pendapatan. Beri langkah mitigasi konkret.
${useWeb && webContext ? '- Sebutkan sumber data yang digunakan secara singkat (contoh: "Menurut BI per ' + today + '...").' : '- Jika merujuk data makro, sebutkan sumbernya (contoh: "Berdasarkan data BPS...").'}

Format: Bahasa Indonesia profesional, tajam, tegas, mendetail, spesifik pembahasannya bukan umum, memotivasi. **Bold** angka/instrumen krusial. Baris baru antar ide. Tanpa ### header maupun di poin-poin yang ada nomornya. Tanpa rightarrow. Maks 400 kata kecuali diminta lebih. Identitas: "Financial Advisor AI" — jangan sebut vendor AI apapun.`;

    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    let lastError = '';

    for (const model of GROQ_MODELS) {
      try {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 650 })
        });

        // ── PERBAIKAN DI SINI: Menambahkan resp.status === 400 ────────────
        if (resp.status === 429 || resp.status === 503 || resp.status === 400) {
          const d = await resp.json().catch(() => ({}));
          lastError = `Groq (${model}): ${d?.error?.message || resp.status}`; continue;
        }
        if (resp.status === 404) { lastError = `Groq: model ${model} tidak ada`; continue; }
        if (!resp.ok) {
          const d = await resp.json().catch(() => ({}));
          return res.status(500).json({ error: `Groq error: ${d?.error?.message || resp.status}` });
        }

        const data = await resp.json();
        const reply = data?.choices?.[0]?.message?.content || '';
        if (!reply) { lastError = `Groq (${model}): kosong`; continue; }

        return res.status(200).json({
          reply,
          model_used: model,
          provider: useWeb && webContext ? 'Groq+Tavily+Jina' : 'Groq'
        });

      } catch (err) { lastError = `Groq (${model}): ${err.message}`; continue; }
    }

    return res.status(503).json({ error: `AI tidak tersedia. (${lastError})` });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
