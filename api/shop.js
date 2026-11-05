// أبعاد: متاجر محفوظة داخل الموقع. المزامنة تتم مرة وحدة وتنحفظ في Blob، والموقع يقرأ ملف واحد جاهز.
//   /api/shop?site=sportswear.sa                    -> كل المنتجات المحفوظة
//   /api/shop?site=...&op=sync&step=0               -> يجلب دفعة ويحفظها (يستدعيها صفحة #/sync)
//   /api/shop?site=...&op=compile                   -> يجمّع الدفعات في ملف واحد
const { put, list: blobList } = require('@vercel/blob')
const H = require('./salla.js').helpers
const N = 10
const base = site => `abaad/shop/${site}/`
const readBlob = async key => {
  try {
    const { blobs } = await blobList({ prefix: key, limit: 3 }); const b = blobs.find(x => x.pathname === key); if (!b) return null
    const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' }); return r.ok ? await r.json() : null
  } catch { return null }
}
const writeBlob = (key, obj) => put(key, JSON.stringify(obj), { access: 'public', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' })

async function viaFirecrawl(p) {
  const k = process.env.FIRECRAWL_API_KEY; if (!k) throw new Error('blocked')
  const r = await fetch('https://api.firecrawl.dev/v1/scrape', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k }, body: JSON.stringify({ url: p.url, formats: ['markdown'], onlyMainContent: true, maxAge: 86400000 }) })
  const j = await r.json(); const m = (j.data && j.data.metadata) || {}
  const price = H.num(m['product:sale_price:amount'] || m['product:price:amount']); const old = H.num(m['product:original_price:amount'] || m['product:regular_price:amount'])
  const title = H.ent(String(m['og:title'] || m.title || '').replace(/\s*\|[^|]*$/, '')).replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('empty')
  return { id: 'sl-' + p.id, title: title.slice(0, 160), price, old: old > price ? old : 0, img: m['og:image'] || m.ogImage || p.img || '', url: p.url }
}
async function one(p) {
  try { const h = await H.get(p.url); const x = H.product(h, p); if (x && x.title) return x } catch {}
  try { return await viaFirecrawl(p) } catch { return null }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const q = req.query || {}
    const site = String(q.site || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) return res.status(400).json({ error: 'bad site' })
    const op = q.op || 'get', B = base(site)
    if (op === 'get') {
      const all = await readBlob(B + 'all.json')
      if (all) res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
      return res.status(200).json(all || { total: 0, items: [] })
    }
    if (op === 'sync') {
      const step = Math.max(0, parseInt(q.step || '0', 10) || 0)
      let idx = step > 0 ? await readBlob(B + 'index.json') : null
      if (!idx) { const list = await H.allProducts(site); idx = { list, at: Date.now() }; await writeBlob(B + 'index.json', idx) }
      const steps = Math.ceil(idx.list.length / N)
      const slice = idx.list.slice(step * N, step * N + N)
      const items = (await Promise.all(slice.map(one))).filter(Boolean)
      await writeBlob(B + `part_${step}.json`, { items })
      return res.status(200).json({ step, steps, total: idx.list.length, got: items.length, done: step + 1 >= steps })
    }
    if (op === 'compile') {
      const idx = await readBlob(B + 'index.json'); if (!idx) return res.status(400).json({ error: 'sync first' })
      const steps = Math.ceil(idx.list.length / N), items = [], seen = new Set()
      for (let i = 0; i < steps; i += 10) {
        const parts = await Promise.all(Array.from({ length: Math.min(10, steps - i) }, (_, k) => readBlob(B + `part_${i + k}.json`)))
        for (const p of parts) for (const it of (p && p.items) || []) if (!seen.has(it.id)) { seen.add(it.id); items.push(it) }
      }
      await writeBlob(B + 'all.json', { total: items.length, expected: idx.list.length, items, at: Date.now() })
      return res.status(200).json({ saved: items.length, expected: idx.list.length })
    }
    return res.status(400).json({ error: 'bad op' })
  } catch (e) { return res.status(500).json({ error: String(e && e.message || e) }) }
}
