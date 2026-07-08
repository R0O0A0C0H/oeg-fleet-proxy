import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

const GAS_URL = 'https://script.google.com/macros/s/AKfycby9cWe_I8XGopIFL_GuMtMeQkFwocGKQB6qEWBE1cb5YeA0qI1opXpFSSF4abMjKbwN8w/exec'

// 只讀 action（可以快取）
const CACHEABLE_ACTIONS = new Set([
  'getAllOrders', 'getOrders', 'getRepairs', 'getAllRepairs', 'getSettings', 'getAccounts'
])

// 快取時間（秒）
const CACHE_TTL: Record<string, number> = {
  getSettings:   300, // 5分鐘
  getAllOrders:   60,  // 1分鐘
  getOrders:     60,
  getRepairs:    60,
  getAllRepairs:  60,
  getAccounts:   120,
}

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

app.get('/', (c) => c.json({ status: 'OEG Fleet Proxy running' }))

app.post('/api', async (c) => {
  try {
    const body = await c.req.json()
    const action: string = body.action || ''

    // ── Worker 端快取（只讀操作）────────────────────────────
    const cache = caches.default
    if (CACHEABLE_ACTIONS.has(action)) {
      // 用 action + 關鍵參數組成 cache key
      const cacheKey = new Request(
        `https://oeg-cache/${action}/${body.vesselCode || 'all'}`,
        { method: 'GET' }
      )
      const cached = await cache.match(cacheKey)
      if (cached) {
        const data = await cached.json()
        return c.json({ ...data, _cached: true })
      }

      // 向 GAS 請求
      const gasRes = await fetchGAS(body)
      if (gasRes.success) {
        // 存入 Worker Cache
        const ttl = CACHE_TTL[action] || 60
        const resp = new Response(JSON.stringify(gasRes), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${ttl}`,
          }
        })
        c.executionCtx.waitUntil(cache.put(cacheKey, resp))
      }
      return c.json(gasRes)
    }

    // 寫入操作：清除相關快取
    if (['updateDeliveredQty','batchUpdateOrder','updateOrder','replyOrder',
         'submitOrder','deleteOrderItem','updateOrderItem','updateSignedImages',
         'saveSettings','approveAccount','updateAccount'].includes(action)) {
      c.executionCtx.waitUntil(clearRelatedCache(cache, action, body))
    }

    // 直接轉發到 GAS
    const data = await fetchGAS(body)
    return c.json(data)

  } catch (e: any) {
    return c.json({ success: false, message: e.message }, 500)
  }
})

async function fetchGAS(body: any): Promise<any> {
  // 直接用 POST，不再 fallback GET
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OEG-Fleet-Proxy/1.0'
      },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      // 嘗試解析 JSONP
      const match = text.match(/^[\w]+\((.+)\)\s*;?$/s)
      if (match) return JSON.parse(match[1])
      return { success: false, message: 'Invalid response: ' + text.slice(0, 100) }
    }
  } catch (e: any) {
    return { success: false, message: e.message, offline: true }
  }
}

async function clearRelatedCache(cache: Cache, action: string, body: any) {
  const keysToDelete = [
    `https://oeg-cache/getAllOrders/all`,
    `https://oeg-cache/getSettings/all`,
  ]
  if (body.vesselCode) {
    keysToDelete.push(`https://oeg-cache/getOrders/${body.vesselCode}`)
    keysToDelete.push(`https://oeg-cache/getRepairs/${body.vesselCode}`)
  } else {
    // 清除所有船隻的快取
    for (const v of ['VLK','WTN','VLN','WYF']) {
      keysToDelete.push(`https://oeg-cache/getOrders/${v}`)
      keysToDelete.push(`https://oeg-cache/getRepairs/${v}`)
    }
  }
  if (action === 'saveSettings' || action === 'approveAccount' || action === 'updateAccount') {
    keysToDelete.push(`https://oeg-cache/getAccounts/all`)
  }
  await Promise.all(keysToDelete.map(k => cache.delete(new Request(k, { method: 'GET' }))))
}

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch
}
