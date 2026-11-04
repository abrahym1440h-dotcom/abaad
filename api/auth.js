// حسابات حقيقية: كلمات المرور مشفّرة (scrypt)، والجلسة توقيع HMAC، والبيانات في Vercel Blob
const crypto = require('crypto')
const { put, list } = require('@vercel/blob')

const SECRET = crypto.createHash('sha256').update('abaad-auth|' + (process.env.AUTH_SECRET || process.env.BLOB_READ_WRITE_TOKEN || 'dev')).digest()
const hm = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex')
const keyOf = email => 'abaad/users/' + hm('u:' + email).slice(0, 40) + '.json'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = k => { const p = b64({ k, exp: Date.now() + 1000 * 60 * 60 * 24 * 90 }); return p + '.' + hm('t:' + p) }
const verify = t => {
  try {
    const [p, s] = String(t || '').split('.'); if (!p || !s) return null
    const good = hm('t:' + p); if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null
    const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o.k : null
  } catch { return null }
}
const hashPass = (pass, salt) => crypto.scryptSync(String(pass), salt, 64).toString('hex')

async function read(key) {
  const { blobs } = await list({ prefix: key, limit: 5 })
  const b = blobs.find(x => x.pathname === key); if (!b) return null
  const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null
  return r.json()
}
const write = (key, obj) => put(key, JSON.stringify(obj), { access: 'public', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' })
const pub = u => ({ id: u.id, name: u.name, email: u.email })

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const { action } = b
    if (action === 'register') {
      const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 60), pass = String(b.pass || '')
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'اكتب بريد صحيح' })
      if (pass.length < 6) return res.status(400).json({ error: 'كلمة المرور ٦ خانات على الأقل' })
      if (name.length < 2) return res.status(400).json({ error: 'اكتب اسمك' })
      const key = keyOf(email)
      if (await read(key)) return res.status(409).json({ error: 'هذا البريد مسجل مسبقاً' })
      const salt = crypto.randomBytes(16).toString('hex')
      const u = { id: 'u' + crypto.randomBytes(6).toString('hex'), name, email, salt, hash: hashPass(pass, salt), created: Date.now(), data: {} }
      await write(key, u)
      return res.json({ token: sign(key), user: pub(u), data: {} })
    }
    if (action === 'login') {
      const email = String(b.email || '').trim().toLowerCase(), key = keyOf(email)
      const u = await read(key)
      if (!u || !crypto.timingSafeEqual(Buffer.from(hashPass(b.pass, u.salt)), Buffer.from(u.hash))) return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة' })
      return res.json({ token: sign(key), user: pub(u), data: u.data || {} })
    }
    const key = verify(b.token)
    if (!key) return res.status(401).json({ error: 'انتهت الجلسة، سجّل دخولك من جديد' })
    const u = await read(key)
    if (!u) return res.status(401).json({ error: 'الحساب غير موجود' })
    if (action === 'me') return res.json({ user: pub(u), data: u.data || {} })
    if (action === 'save') {
      const s = JSON.stringify(b.data || {}); if (s.length > 3.5e6) return res.status(413).json({ error: 'حجم البيانات كبير' })
      u.data = b.data || {}; await write(key, u)
      return res.json({ ok: true })
    }
    return res.status(400).json({ error: 'bad action' })
  } catch (e) {
    return res.status(500).json({ error: 'تعذّر الاتصال بالخادم، جرّب مرة ثانية' })
  }
}
