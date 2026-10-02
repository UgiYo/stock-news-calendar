# 股聞日曆 — GitHub Pages＋Cloudflare Workers／D1＋GitHub Actions

台灣上市櫃公司新聞月曆。Google 登入後保存個人追蹤清單，支援股號／公司名稱搜尋、近一個月回補、每日更新、獨立全文摘要視窗及依日期列點新聞。

## 架構

- GitHub Pages：靜態前端。
- Cloudflare Workers：Google OAuth、30 天登入 session、公司搜尋、追蹤清單、新聞 API、工作排隊。
- D1：公司、使用者、session、追蹤清單、新聞、摘要與工作狀態。
- GitHub Actions：官方名錄同步、Google News RSS 蒐集、全文擷取及選用 AI 摘要。HTML 處理不在 Workers 執行，降低免費 CPU 額度壓力。
- 不使用 Supabase；AI API 仍為選用、另行計費。

## 1. 建立 Cloudflare D1 與 Worker

使用 Node.js 24，在專案根目錄執行（Wrangler 透過 npx 安裝）：

```bash
npx wrangler login
npx wrangler d1 create stock-news-calendar
```

將回傳 database_id 填入 `worker/wrangler.toml`，並設定 GOOGLE_CLIENT_ID。APP_URL 預設為 `https://ugiyo.github.io/stock-news-calendar/`，需包含結尾斜線。Google 登入回到這個網址，CORS 僅接受這個網址的 origin。

```bash
npx wrangler d1 migrations apply stock-news-calendar --remote --config worker/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put COLLECTOR_SECRET --config worker/wrangler.toml
npx wrangler secret put GITHUB_DISPATCH_TOKEN --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

COLLECTOR_SECRET 為至少 32 bytes 隨機密鑰，稍後同值放 GitHub Actions。GITHUB_DISPATCH_TOKEN 使用 fine-grained PAT，僅選此 repository，授予 **Actions: Read and write**；Worker 用它觸發已存在的 news.yml 工作流程。請設定期限並到期輪替。此 token 不需要寫入原始碼，前端也不會取得它。

若不設定 dispatch token，要求仍保存於 D1，但需手動 Run workflow 或等待每日排程，無法即時執行。Actions 預設每日台灣 06:17 執行；排程可能延遲或因 repository 久未活動停用。

## 2. Google 登入

Google Cloud／Google Auth Platform 建立 Web application OAuth client：

- Authorized redirect URI：`https://stock-news-calendar-api.YOUR_SUBDOMAIN.workers.dev/auth/callback`（精確匹配實際 Worker 網址）。
- OAuth branding／audience 若仍為 Testing，加入你的 Google 帳號為測試使用者。
- Scope：openid、email、profile。不存取 Gmail 郵件。
- Client ID 填 Worker vars；Client Secret 使用上面的 Worker secret。

登入使用 state Cookie＋單次 D1 state＋PKCE；Worker 驗證 Google ID token 的簽章、issuer、audience、到期時間與已驗證 email，以 Google sub 識別使用者。session 私密 token 僅回傳登入使用者，D1 保存 SHA-256 雜湊。前端接收 URL fragment 後立即移除並存 localStorage，30 天後需重登；登出刪除 server session。請勿在前端加入不可信第三方腳本，以避免 session 被讀取。

## 3. GitHub 設定

Repository Settings → Secrets and variables → Actions：

| 類型 | 名稱 | 內容 |
| --- | --- | --- |
| Variable | WORKER_API_URL | Worker 網址，不含尾端斜線 |
| Secret | COLLECTOR_SECRET | 與 Worker 同值 |
| Secret，選用 | OPENAI_API_KEY | 啟用 AI 全文摘要；只供 Actions 使用 |
| Variable，選用 | SUMMARY_MODEL | 預設 gpt-4.1-mini |

Settings → Pages → Source 選 GitHub Actions。

1. Actions → Update company news → Run workflow，選 **daily**，先同步公司名錄並更新所有追蹤公司。
2. Actions → Deploy GitHub Pages → Run workflow。
3. 開啟 Pages 網址、Google 登入、搜尋股號、選公司追蹤。
4. 新增公司及立即更新會排入工作；Worker 觸發 Actions，回補近一個月。前端最多等待兩分鐘；尚未完成時會提示稍後重新整理，工作不取消。
5. 開啟全文摘要視窗，逐篇或批次排入摘要工作。結果保存到 D1，下次登入仍能查看。

Actions 使用 concurrency 序列化工作，排程會依序處理 D1 待辦工作；多次快速触發可能由 GitHub 合併／取消尚未啟動的 pending workflow，但已保存的 D1 工作仍保留。单次最多處理 500 個工作，剩餘工作由下一次 workflow 處理。running 工作超過 20 分鐘可回到 pending 重試。相同要求有 15 分鐘節流；D1 session 權限由 API 每次查詢追蹤清單實施。

## 4. 本機與驗證

```bash
npm ci
cp .env.example .env
# VITE_WORKER_API_URL 填已部署 Worker URL
npm run dev
npm test
npm run build
python3 -m py_compile scripts/collect.py scripts/sync_catalog.py
```

本機前端需將 Worker APP_URL 暫改為 `http://localhost:5173/`，Google 仍回呼 Worker、再導向本機。不應把測試與正式環境混用，建議另建測試 Worker／D1。

Wrangler 本機資料庫：

```bash
npx wrangler d1 migrations apply stock-news-calendar --local --config worker/wrangler.toml
npx wrangler dev --config worker/wrangler.toml
```

私密設定可放 `worker/.dev.vars`（已忽略），請勿 commit。

## 摘要、來源與限制

- RSS 為 Google News 搜尋，不保證涵蓋所有媒體。使用文章發布時間按台灣日期歸檔，近一曆月逐日查詢，URL 去重；熱門公司仍可能受搜尋結果上限影響。
- Google News 原文解析依賴 googlenewsdecoder 的非公開介面，可能變更、受限或遇到 CAPTCHA，失敗會標示原因，不冒充全文摘要。
- trafilatura 擷取公開文章；不繞過付費牆。不保存或展示完整文章，僅保存來源連結與摘要。無法保證辨識所有截斷內文。
- 有 OPENAI_API_KEY 時，內文傳送 OpenAI 產生繁體中文列點摘要並产生 API 費用。未設定或 AI 失敗時提供「全文重點摘錄（非 AI）」。超過 40,000 字不做截斷摘要。
- 擷取檢查 DNS 私有網段與每次轉址，限制頁面大小及逾時；DNS rebinding 仍需部署出口網路策略进一步限制。僅由 Actions 使用新聞資料庫內的網址，不接受任意使用者網址。
- 免費服務有請求、D1 讀寫／容量、Actions 等限制；大量公司需分批、監控與清理歷史資料。本版本按追蹤公司聯集蒐集，非自動蒐集所有上市櫃公司。
- 尚未連接你的 Cloudflare／Google 帳號完成 OAuth、實際 RSS／原文及 AI 驗收，未實際部署 Worker。浏览器執行檔缺失，仍需實機檢查手機版畫面。
- 從舊 Supabase 版本升級時，不會自動搬移資料；若已有真實資料請先匯出，再依 Google sub 對應使用者重新匯入。本次專案先前未設定 Supabase，通常可直接以空 D1 啟動。

## 上線驗收

- A、B 帳號：各自追蹤清單隔離；B 無法讀取 A 未共同追蹤公司的新聞、工作。
- 未登入 API 回 401；admin 密鑰錯誤回 403；未追蹤公司不能蒐集／摘要。
- 新增追蹤後 Actions 啟動、新聞按正確日期保存，重跑不增加重複資料。
- 可讀取全文產生摘要，付費牆／來源拒絕顯示錯誤；重新登入摘要保留。
- Worker／Actions／Google 配置完成後，確認 Pages 網址及 Google callback 精確匹配。

官方文件：
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

### 新聞事件與股價反應第一版

追蹤公司的每則新聞可展開「股價反應」，包含發布時間對齊交易日、事件分類、前 5 日報酬、後 1/3/5/20 日個股與加權指數報酬，以及兩者差值（百分點）。事件日算第 1 個交易日，基準是事件日前一交易日收盤。13:30 起發布及非交易日新聞對齊下個有行情的交易日。這是發布後價格反應，不能證明因果。日期缺資料不補值。

第一版股價來源為 TWSE 官方月行情，支援上市公司，未支援上櫃行情；價格為未還原 OHLCV，除權息、分割會影響報酬，不能当作總報酬。事件時間使用新聞發布時間，尚無人工校正的實際事件時間；事件分類為標題規則，既有近似標題去重尚不等同完整語意事件合併。

`Update company news` 最後會執行 `scripts/market_prices.py`，共享補入最近五個月行情，逐公司失敗在 log 顯示並使步驟失敗。Worker 透過驗證 COLLECTOR_SECRET 的 `/admin/prices` 自動建立 prices 表，毋須手動 SQL migration。主鍵(code,date)與條件 upsert 避免使用者倍增或相同行情反覆寫入。讀取需登入並追蹤該公司。

部署完成後手動執行一次 Update company news（queued）初始化股價，查看 Update shared daily stock prices 的 Market prices 2303 / TAIEX log。首次遇 TWSE 限制或尚無本月資料時可稍後重試。前端資料在重新整理後載入，未完成的後續區間顯示等待資料。
