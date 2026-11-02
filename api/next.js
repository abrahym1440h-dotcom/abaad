// أبعاد: جلب منتجات نكست مباشرة (صفحة بصفحة) عبر فيرسال
// الاستخدام: /api/next?path=shop/mens/clothing/jeans&page=2   (اضف &debug=1 للفحص)
const BASE = 'https://www.next.sa/ar/'
const IMG = c => `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${String(c).toUpperCase()}.jpg?im=Resize,width=600`
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const num = s => { const m = String(s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/\d[\d,]*(?:\.\d+)?/); return m ? parseFloat(m[0].replace(/,/g, '')) : 0 }

function parse(html) {
  const out = new Map()
  // 1) JSON مضمّن إن وجد
  const re = /<a\b[^>]*href=["']((?:https?:\/\/www\.next\.sa)?\/ar\/style\/([a-z0-9]+)\/([a-z0-9]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const [, href, style, code, inner] = m
    if (out.has(code)) continue
    const alt = (inner.match(/alt=["']([^"']{4,})["']/i) || [])[1]
    const aria = (m[0].match(/aria-label=["']([^"']{4,})["']/i) || [])[1]
    const text = strip(inner)
    // الأسعار: أرقام قبل/بعد "ر.س" أو SAR
    const prices = [...text.matchAll(/(\d[\d,.]*)\s*(?:ر\.?\s?س|SAR)|(?:ر\.?\s?س|SAR)\s*(\d[\d,.]*)/g)].map(x => num(x[1] || x[2])).filter(Boolean)
    let title = strip(alt || aria || '') || text.replace(/(\d[\d,.]*)\s*(ر\.?\s?س|SAR)/g, '').trim()
    title = title.slice(0, 160)
    if (!title) continue
    const price = prices.length ? Math.min(...prices) : 0
    const old = prices.length > 1 ? Math.max(...prices) : 0
    out.set(code, { id: 'nx-' + code.toLowerCase(), title, price, old: old > price ? old : 0, img: IMG(code), url: 'https://www.next.sa' + href.replace(/^https?:\/\/www\.next\.sa/, '') })
  }
  const total = (html.match(/(\d[\d,]*)\s*(?:منتج|منتجات|results|items)/i) || [])[1]
  return { items: [...out.values()], total: total ? num(total) : null }
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {}
    const path = String(q.path || 'shop/mens').replace(/^\/+/, '')
    if (!/^(shop|promotions|brands)\/[a-z0-9\-~\/]*$/i.test(path) && !/^shop\/[a-z0-9\-~\/]*$/i.test(path)) return res.status(400).json({ error: 'bad path' })
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const url = BASE + path + (page > 1 ? `?page=${page}` : '')
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'accept-language': 'ar-SA,ar;q=0.9', accept: 'text/html' } })
    const html = await r.text()
    if (q.debug) return res.status(200).json({ status: r.status, length: html.length, url, sample: html.slice(0, 600), firstAnchor: (html.match(/<a\b[^>]*\/ar\/style\/[\s\S]{0,900}/i) || [''])[0] })
    if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status })
    const { items, total } = parse(html)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({ page, total, items })
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }) }
}
