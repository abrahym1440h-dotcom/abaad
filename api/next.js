// أبعاد: جلب منتجات نكست عبر Firecrawl (نكست يحظر سيرفرات فيرسال مباشرة)
// يحتاج متغير بيئة في فيرسال: FIRECRAWL_API_KEY
// الاستخدام: /api/next?path=shop/womens/clothing&page=2   (اضف &debug=1 للفحص)
const BASE = 'https://www.next.sa/ar/'
const IMG = c => `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${String(c).toUpperCase()}.jpg?im=Resize,width=600`
const schema = { type: 'object', properties: { total: { type: 'number' }, products: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' }, old: { type: 'number' }, url: { type: 'string' } } } } } }
const prompt = 'List every real product tile on the page (skip category/banner tiles that have no price): full title, current price in SAR as a number, old/was price only if higher than the current price, and product page URL. Also return the total number of results for this category as a number.'

module.exports = async (req, res) => {
  try {
    const q = req.query || {}
    const path = String(q.path || 'shop/mens').replace(/^\/+/, '')
    if (!/^(shop|brands|promotions)(\/[a-z0-9\-~]+)*$/i.test(path)) return res.status(400).json({ error: 'bad path' })
    const key = process.env.FIRECRAWL_API_KEY
    if (!key) return res.status(500).json({ error: 'FIRECRAWL_API_KEY missing' })
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const url = BASE + path + (page > 1 ? `?page=${page}` : '')
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ url, formats: ['json'], jsonOptions: { prompt, schema }, maxAge: 86400000 })
    })
    const j = await r.json().catch(() => ({}))
    if (q.debug) return res.status(200).json({ status: r.status, url, success: j.success, error: j.error, sample: (j.data && j.data.json) || null })
    if (!r.ok || !j.success) return res.status(502).json({ error: 'firecrawl ' + r.status, detail: j.error || null })
    const data = j.data.json || {}; const out = new Map()
    for (const p of data.products || []) {
      const m = String(p.url || '').match(/\/ar\/style\/([a-z0-9]+)\/([a-z0-9]+)/i); if (!m || !p.price || out.has(m[2])) continue
      out.set(m[2], { id: 'nx-' + m[2].toLowerCase(), title: String(p.title || '').slice(0, 160), price: p.price, old: p.old > p.price ? p.old : 0, img: IMG(m[2]), url: 'https://www.next.sa/ar/style/' + m[1] + '/' + m[2] })
    }
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    res.status(200).json({ page, total: null, items: [...out.values()] })
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }) }
}
