// أبعاد: جلب كل منتجات أي متجر سلة مباشرة (من خريطة الموقع sitemap) صفحة بصفحة
// الاستخدام: /api/salla?site=oldgoal.com&page=1   (اضف &debug=1 للفحص)
const { put, list: blobList } = require('@vercel/blob')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const PER = 24
const cache = {}
const get = async u => { const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'ar-SA,ar;q=0.9' } }); if (!r.ok) throw new Error(u + ' ' + r.status); return r.text() }
const locs = x => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])

async function allProducts(site) {
  const c = cache[site]; if (c && Date.now() - c.t < 3600e3) return c.list
  const root = await get(`https://${site}/sitemap.xml`)
  let maps = locs(root).filter(u => /sitemap/i.test(u)); if (!maps.length) maps = [`https://${site}/sitemap.xml`]
  const seen = new Set(), list = []
  for (const m of maps) {
    const x = await get(m).catch(() => '')
    for (const b of x.split('<url>').slice(1)) {
      const u = (b.match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1]; if (!u) continue
      const path = u.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '')
      /* منتج سلة: /p123456789 أو /اسم/p123456789 أو رابط قصير /AbCdEfG */
      const id = (path.match(/\/p(\d{5,})$/) || path.match(/^\/([A-Za-z0-9]{5,9})$/) || [])[1]
      if (!id || seen.has(id)) continue; seen.add(id)
      list.push({ id, url: u, img: (b.match(/<image:loc>\s*([^<\s]+)/) || [])[1] || '' })
    }
  }
  cache[site] = { t: Date.now(), list }; return list
}
const dec = s => { try { return decodeURIComponent(s) } catch { return s } }
const ent = s => String(s || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0 }

function product(html, p) {
  let name = '', img = '', price = 0, old = 0
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]); const arr = Array.isArray(j) ? j : (j['@graph'] || [j])
      const pr = arr.find(x => x && /Product/i.test([].concat(x['@type'] || []).join(',')))
      if (!pr) continue
      name = pr.name || name; img = [].concat(pr.image || [])[0] || img
      const o = [].concat(pr.offers || [])[0] || {}; price = num(o.price || o.lowPrice) || price
    } catch {}
  }
  const meta = k => (html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${k}["']`, 'i')) || [])[1]
  name = ent(name || meta('og:title') || '')
  img = img || meta('og:image') || ''
  price = price || num(meta('product:price:amount') || meta('product:sale_price:amount'))
  old = num(meta('product:original_price:amount') || meta('product:regular_price:amount') || meta('product:original_price')) 
  if (!old) { const m = html.match(/(?:regular_price|original_price|"old_price"|"regular_price")["':\s]+([\d.]+)/i); if (m) old = num(m[1]) }
  if (!name) { const slug = dec(p.url.split('/').slice(3, -1).join('/')); name = slug.replace(/-/g, ' ') }
  if (!name) name = ''
  return { id: 'sl-' + p.id, title: name.replace(/\s*\|[^|]*$/, '').replace(/\s+/g, ' ').trim().slice(0, 160), price, old: old > price ? old : 0, img: img || p.img || '', url: p.url }
}

const bkey = (site, page) => `abaad/salla/${site}_p${page}.json`
async function saved(key) {
  try {
    const { blobs } = await blobList({ prefix: key, limit: 3 }); const b = blobs.find(x => x.pathname === key); if (!b) return null
    const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null
    const j = await r.json(); return j && j.items && j.items.length && Date.now() - (j.at || 0) < 14 * 864e5 ? j : null
  } catch { return null }
}
const save = (key, obj) => put(key, JSON.stringify({ ...obj, at: Date.now() }), { access: 'public', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' }).catch(() => {})

module.exports = async (req, res) => {
  try {
    const q = req.query || {}
    const site = String(q.site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return res.status(400).json({ error: 'bad site' })
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const key = bkey(site, page)
    if (!q.debug) { const hit = await saved(key); if (hit) { res.setHeader('Cache-Control', 's-maxage=3600'); return res.status(200).json({ page, total: hit.total, items: hit.items, saved: true }) } }
    const list = await allProducts(site)
    if (q.debug) {
      let probe = null; if (list[0]) { try { const h = await get(list[0].url); probe = product(h, list[0]) } catch (e) { probe = String(e.message || e) } }
      return res.status(200).json({ site, total: list.length, sample: list.slice(0, 3), probe })
    }
    const slice = list.slice((page - 1) * PER, page * PER)
    const items = (await Promise.all(slice.map(p => get(p.url).then(h => product(h, p)).catch(() => null)))).filter(x => x && x.title)
    if (items.length) { await save(key, { total: list.length, items }); res.setHeader('Cache-Control', 's-maxage=3600') } else res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ page, total: list.length, items })
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }) }
}
