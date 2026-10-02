# 股聞日曆 — 台灣上市櫃公司新聞追蹤

手機與電腦可用的新聞月曆，前端部署 GitHub Pages，後端使用 Supabase，GitHub Actions 每日自動蒐集。

## 功能

- 股號、公司簡稱、完整名稱搜尋；使用證交所及櫃買中心官方公司名錄。
- 新增追蹤即回補近一個曆月新聞；同名候選由使用者選擇，已追蹤公司直接篩選。
- 月曆依新聞發布時間（Asia/Taipei）歸檔，點日期查看標題、媒體、原始 RSS 連結。
- 當日總結：統計來源與新聞數，整理最多四則不重複標題；另有獨立全文摘要視窗與依日期分組的新聞列點。
- Google 帳號登入（Gmail 帳號可用），跨裝置保留公司清單與新聞；不申請 Gmail 郵件權限。
- 每天台灣 06:17 更新所有使用者追蹤公司的聯集；同一公司共享蒐集结果，但私人追蹤清單受 RLS 保護。
- RSS URL 去重、失敗重試、公司蒐集鎖、15 分鐘更新節流；取消追蹤不刪除其他人的新聞。

## 1. 建立 Supabase

1. 建立 Supabase 專案，至 SQL Editor 執行 `supabase/schema.sql`（新專案執行一次）。
2. 記錄 Project URL、**anon 公開 key**、**service_role 私密 key**。前端只能使用 anon key，絕對不可放 service_role。
3. Authentication → Providers → Google 啟用，填入 Google OAuth Client ID / Secret。
4. 在 Google Cloud 建立 Web application OAuth Client。Authorized redirect URI 填入 Supabase 提供的 callback：`https://PROJECT.supabase.co/auth/v1/callback`。如 OAuth consent screen 仍在測試模式，先加入測試帳號。
5. Supabase Authentication → URL Configuration：Site URL 與 Redirect URLs 加入 `https://帳號.github.io/儲存庫名稱/`（包含結尾 `/`）。本機測試另外加入 `http://localhost:5173/`。

官方說明：https://supabase.com/docs/guides/auth/social-login/auth-google

## 2. 部署新聞後端

安裝 Supabase CLI，登入並連結專案：

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set APP_ORIGIN=https://YOUR_ACCOUNT.github.io
supabase secrets set COLLECTOR_SECRET=YOUR_RANDOM_LONG_SECRET
supabase functions deploy collect --no-verify-jwt
```

APP_ORIGIN 為網站 origin，不含儲存庫路徑。COLLECTOR_SECRET 請產生至少 32 bytes 隨機字串，與 GitHub Secret 一致。Supabase 預設提供 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 給函數。函數雖關閉 gateway JWT 檢查，**內部會用 Auth API 驗證使用者 JWT**，並確認該公司在其追蹤清單；排程以另一個私密 secret 驗證。

## 3. 上傳 GitHub 與設定 Pages

1. 解壓縮，將 `stock-news-calendar/` 裡的所有檔案（包含 `.github/`）放在新 repository 根目錄。
2. 預設分支使用 `main`；若名稱不同，修改 `.github/workflows/pages.yml`。
3. Repository Settings → Secrets and variables → Actions，新增：

| 類型 | 名稱 | 內容 |
| --- | --- | --- |
| Variable | SUPABASE_URL | 專案 URL |
| Variable | SUPABASE_ANON_KEY | anon 公開 key |
| Secret | SUPABASE_SERVICE_ROLE_KEY | service_role 私密 key |
| Secret | COLLECTOR_SECRET | 與 Edge Function 相同的排程密鑰 |

4. Settings → Pages → Source 選 **GitHub Actions**。
5. Actions → **Update company news** → Run workflow，首次下載完整公司名錄。
6. Actions → **Deploy GitHub Pages** → Run workflow（或 push main），完成後開啟 Pages 網址。
7. 用 Google 登入，搜尋 `2330`，選擇台積電，等待首次回補。重新登入確認清單保留。

GitHub Pages 是靜態網站，無法自己執行伺服器排程，因此資料庫、登入與 RSS 請求都在 Supabase；私密金鑰只有後端與 Actions 能使用。

## 4. 本機開發

```bash
npm ci
cp .env.example .env
# 填入公開 Supabase URL 與 anon key
npm run dev
npm test
npm run build
```

使用 Node.js 24（測試直接載入 TypeScript 純邏輯）。未設定環境變數時，畫面會顯示設定提示，不會假裝登入或生成新聞。

## 每日更新、資料來源與限制

- GitHub cron 使用 UTC：`17 22 * * *` = 台灣次日 06:17。排程只在預設分支執行，可能延遲；公開儲存庫長期未活動也可能自動停用，請定期確認 Actions。官方說明：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- 每次回補一個月，補回漏跑資料；較舊的新聞不會刪除。請注意資料庫容量。
- Google News RSS 是聚合搜尋，不是具有涵蓋率 SLA 的付費新聞 API。只收錄標題、來源與 RSS 連結，連結可能先跳轉 Google News；全文摘要功能會按需讀取公開文章內文，但不保存或展示完整內文。
- 每家公司約 28–31 日視窗、四路並行查詢；RSS 查詢邊界多抓前後一天，再按實際發布時間過濾。熱門公司單日仍可能受 RSS 結果上限影響；**不能保證蒐集所有新聞**。
- 標題須含公司簡稱、完整名稱或獨立股號。避免無關數字，但簡稱含糊時仍可能誤收，名稱未出現在標題時也可能漏收。
- 預設範圍為台灣上市、上櫃公司；不含興櫃、ETF、海外股票。
- 來源暫時失敗會顯示錯誤，不宣稱更新成功；追蹤清單保留，可稍後重試。函數保留部分已完成的新聞。
- 每家公司有 3 分鐘鎖與 15 分鐘節流。前端與排程皆逐家公司呼叫，避免一次函數執行更新大量公司而逾時。
- 資料量大時應分批排程或改長時間 worker。Supabase Edge Function 有執行時間及用量限制，GitHub Actions 也可能收費，請依帳號方案調整；預設 job 上限 300 分鐘。
- 公司名錄只新增/更新，不自動刪除下市公司，避免破壞歷史資料。

官方公司來源：
- https://openapi.twse.com.tw/v1/opendata/t187ap03_L
- https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O

## 驗證與上線檢查

已在產出環境驗證 6 個日期/摘要/過濾測試、前端正式建置及 Python 語法。已實作手機響應式排版；因測試瀏覽器下載失敗，本次未完成瀏覽器視覺驗證。未連接你的 Supabase/Google/GitHub 帳號，因此實際 OAuth、RLS、Edge Function、官方來源可用性與排程需要部署後驗收。

1. A 帳號新增公司，登出再登入確認保留；B 帳號不得讀取 A 的 watchlists。
2. 未登入呼叫 collect 須回 401；未追蹤公司回 403。
3. 台灣午夜附近新聞歸正確日期，同一 RSS URL 重跑不增加重複資料。
4. 手動執行 Update company news，確認來源同步及新聞蒐集 steps 成功；故意錯誤密鑰須失败。
5. 確認正式前端沒有 service_role 或 COLLECTOR_SECRET；檢查 GitHub Actions 排程運作。

## 專案結構

- `src/`：月曆、Google 登入、篩選、新聞與標題總結。
- `supabase/schema.sql`：資料表、RLS、搜尋與蒐集鎖。
- `supabase/functions/collect/`：JWT 驗證、RSS 蒐集、日期篩選、去重與保存。
- `scripts/`：官方名錄同步、排程新聞更新。
- `.github/workflows/`：Pages 部署與每日更新。
- `tests/`：日期與新聞純邏輯測試。

## 全文摘要版本升級

既有部署在 SQL Editor 執行 `supabase/migrations/20261002_article_summaries.sql`；新專案使用已更新的 schema.sql。部署新函數：

```bash
supabase functions deploy summarize --no-verify-jwt
# 選用：啟用 AI 摘要（私密 key 僅存後端）
supabase secrets set OPENAI_API_KEY=YOUR_KEY SUMMARY_MODEL=gpt-4.1-mini
```

按「全文摘要・日期新聞」開啟獨立視窗，沿用目前公司篩選，依日期由新到舊列出當月新聞（不含月曆相鄰月份的邊界日期）。可逐篇摘要或依序處理視窗中所有未完成項目。摘要結果存在 news，下次登入仍保留；新新聞在使用者按下摘要時產生，每日排程先收錄新聞。

- 有 API key 時將擷取的內文傳送 OpenAI，產生繁體中文列點摘要，會產生 API 費用；請在部署前確認來源使用權及服務用量。
- 未設定 key 或 AI 暫時失敗時提供「全文重點摘錄（非 AI）」，從文章前、中、後段挑選原句，與 AI 摘要分別標示。
- Google News RSS 聚合網址會先嘗試解析原文（舊版內嵌網址及新版頁面參數/RPC）。新版方式依賴非公開介面，可能變更或受限，不保證成功。若未跳轉原文、付費牆、反爬限制、JavaScript 頁面或內文不足，明確標示無法取得全文，不以標題冒充全文摘要。擷取不保證能辨識所有截斷內容。超過 40,000 字文章不送出不完整摘要。
- 成功摘要使用快取；失敗後 15 分鐘才能重試。批次依序執行，關閉視窗仍會繼續處理目前工作；單次新聞摘要的來源讀取與 AI 有逾時限制。
- 摘要端點驗證登入及追蹤權限；網址僅使用資料庫新聞網址，拒絕內網/IP 網址並驗證每次轉址及 DNS。正式環境建議另加出口防火牆阻擋私有網段以防 DNS rebinding。

部署後驗收：單篇可讀取公開文章須顯示摘要及方法；無法讀取原文須顯示原因；未登入 401、未追蹤公司 403；重新登入摘要仍存在。全文擷取及 AI 需要你的雲端環境實測，本次未連接帳號驗證。

### 後續驗證與修正

- AI 連線逾時或服務錯誤，仍保留可取得內文的重點摘錄，避免誤顯示成全文擷取失敗。
- 摘要視窗嚴格限於選定月份；批次更新保留視窗捲動位置，使用者登出或切換帳號時停止後續摘要請求。
- Google News 原文解析使用非公開 RPC，僅盡力解析，不繞過 CAPTCHA、付費牆或來源限制。參考實作：https://github.com/dbernheisel/google_news_decoder （另見 GoogleNewsDecoder README）。
- 目前執行環境缺少瀏覽器執行檔，未完成真實瀏覽器視覺驗收；未連線執行 Google News RPC 或 AI API，這些仍須部署驗收。
