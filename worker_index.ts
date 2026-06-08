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
// 使用 POST → doPost 路徑，確保所有 action 都能正確路由
app.post('/api', async (c) => {
  try {
    const body = await c.req.json()

    // 優先嘗試 POST（走 doPost，支援所有 action）
    let res = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OEG-Fleet-Proxy/1.0'
      },
      body: JSON.stringify(body)
    })

    // GAS doPost 有時會因為 redirect 回傳非 JSON，fallback 到 GET
    let text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // doPost redirect 失敗，fallback 到 GET + payload
      const payload = encodeURIComponent(JSON.stringify(body))
      const getUrl = GAS_URL + '?payload=' + payload
      res = await fetch(getUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'OEG-Fleet-Proxy/1.0' }
      })
      text = await res.text()
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
