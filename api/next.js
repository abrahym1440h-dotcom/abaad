// أبعاد: جلب منتجات نكست عبر Firecrawl (نكست يحظر سيرفرات فيرسال مباشرة)
// يحتاج متغير بيئة في فيرسال: FIRECRAWL_API_KEY
// الاستخدام: /api/next?path=shop/womens/clothing&page=2   (اضف &debug=1 للفحص)
const BASE = 'https://www.next.sa/ar/'
const IMG = c => `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${String(c).toUpperCase()}.jpg?im=Resize,width=600`
const n = s => parseFloat(String(s).replace(/,/g, '')) || 0

function parse(md) {
  const t = md.match(/(?:^|\n)#\s[^\n]*\n+\s*\(([\d,]+)\)/); const total = t ? n(t[1]) : null
  // الأسعار من كتل العنوان: ‏A ر.س.‏ ‏B ر.س.‏](url)
  const prices = {}
  for (const m of md.matchAll(/‏\s*([\d,.]+)\s*ر\.س\.?‏?\s*(?:\\+\s*)*(?:‏\s*([\d,.]+)\s*ر\.س\.?‏?\s*)?\]\(https:\/\/www\.next\.sa\/ar\/style\/\w+\/(\w+)\)/g)) prices[m[3].toLowerCase()] = [n(m[1]), m[2] ? n(m[2]) : 0]
  const items = new Map()
  for (const m of md.matchAll(/\]\((https:\/\/www\.next\.sa\/ar\/style\/(\w+)\/(\w+))\s+"([^"]*?)\s*\((\w+)\)\s*\|\s*‏?\s*([\d,.]+)\s*ر\.س/g)) {
    const [, url, style, code, title, , price] = m; const k = code.toLowerCase(); if (items.has(k)) continue
    const pp = prices[k] || []; const cur = n(price); const old = Math.max(...pp, 0)
    items.set(k, { id: 'nx-' + k, title: title.replace(/\s+/g, ' ').trim().slice(0, 160), price: cur, old: old > cur ? old : 0, img: IMG(code), url })
  }
  return { total, items: [...items.values()] }
}
module.exports.parse = parse

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
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, maxAge: 86400000 })
    })
    const j = await r.json().catch(() => ({}))
    const md = (j.data && j.data.markdown) || ''
    if (q.debug) return res.status(200).json({ status: r.status, url, success: j.success, error: j.error, length: md.length, parsed: parse(md).items.length, sample: md.slice(0, 500) })
    if (!r.ok || !j.success) return res.status(502).json({ error: 'firecrawl ' + r.status, detail: j.error || null })
    const { total, items } = parse(md)
    res.setHeader('Cache-Control', items.length ? 's-maxage=86400, stale-while-revalidate=604800' : 'no-store')
    res.status(200).json({ page, total, items })
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }) }
}
module.exports.parse = parse
