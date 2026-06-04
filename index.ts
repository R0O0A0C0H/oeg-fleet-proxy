import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

const GAS_URL = 'https://script.google.com/macros/s/AKfycby9cWe_I8XGopIFL_GuMtMeQkFwocGKQB6qEWBE1cb5YeA0qI1opXpFSSF4abMjKbwN8w/exec'

// 允許所有來源的 CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// 健康檢查
app.get('/', (c) => c.json({ status: 'OEG Fleet Proxy running' }))

// 轉發所有 API 請求到 Apps Script
app.post('/api', async (c) => {
  try {
    const body = await c.req.json()
    const payload = encodeURIComponent(JSON.stringify(body))
    const url = GAS_URL + '?payload=' + payload

    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'OEG-Fleet-Proxy/1.0'
      }
    })

    const text = await res.text()
    
    // 解析回應（可能是 JSON 或 JSONP）
    let data
    try {
      data = JSON.parse(text)
    } catch {
      const match = text.match(/^[\w]+\((.+)\)\s*;?$/s)
      if (match) {
        data = JSON.parse(match[1])
      } else {
        data = { success: false, message: 'Invalid response from API' }
      }
    }

    return c.json(data)
  } catch (e: any) {
    return c.json({ success: false, message: e.message }, 500)
  }
})

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch
}
