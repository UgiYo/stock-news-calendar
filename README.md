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

### 每日成交值排行榜與族群 Tag

登入後首頁新增上市＋上櫃普通股成交金額前十（億元），排除 ETF／權證，以官方公司名錄交集限定普通公司股票。資料非盤中即時行情。Tag 使用交易所產業代碼中文對照，未知代碼直接顯示「產業 XX」，不猜測 AI 等概念股。

點選排行榜的產業 Tag，顯示該日全市場同產業股票，按成交金額排序；點股票可預覽新聞，不會自動加入追蹤。提供最近保存 60 個交易日切換，歷史從首次執行起累積，不回填既往排行榜。排行共享保存 D1 rankings 表，一日一份，相同 payload 不重寫，自動刪除超過 60 份的舊排行；沒有使用者重複記錄。表由驗證密鑰的 admin endpoint 自動建立。

GitHub Actions `Update daily turnover ranking` 每日台灣時間 20:00 執行 `scripts/ranking.py`，也可在 Actions 手動執行。新聞流程仍維持原本早上排程，不會因排行榜改時而延後。上市／上櫃日期必須相同，上市 OpenAPI 延遲時改查當日 TWSE MI_INDEX；仍不同或来源不完整则步驟失敗，保留原排行，畫面日期呈現實際資料日，不標成今日。日期為官方來源，不用程式執行日冒充。

### 新進成交值前十與族群延續

排行榜比對官方加權指數行情確認的前一交易日。前日未在前十、當日在前十，標記「新進前十」；包含再次進榜，不代表歷史首次。前日快照缺失時顯示缺前日資料，不拿最近保存日代替前一交易日。

族群追蹤顯示全市場該產業的成交值、占全市場普通股成交值比例、相較前日占比變化（百分點）、前十檔數、連續占比增加日數。選擇歷史日期可看該日起最多 21 份已保存交易日的後續數據。缺前日快照不計變化／不中斷地續算連增。成交值為交易活躍度，無法區分買賣資金淨流向。

排行 payload 增加 previousDate，舊資料兼容但無前日日期時不推定；下次更新會補入官方前日日期。仍保留 60 份快照。


### 補收上個月排行榜

`Backfill turnover rankings` workflow 支援 YYYY-MM 完整月份，空白預設上個月；新增 workflow 首次推送自動補收上個月。查詢官方歷史 TWSE MI_INDEX 和 TPEx dailyQuotes，核對日期，按官方加權指數交易日執行並額外補該月前一交易日作為基準。保存已有日期會略過，失敗可重跑接續。完成 log 列出 expected/saved/failed，任何失敗日期使工作失敗。

歷史產業 Tag 依目前官方公司名錄分類，不能還原當時公司產業分類／已下市公司；因此排行榜涵蓋目前名錄中可對應的歷史普通股。此限制也影響歷史族群占比。保持 60 份快照，API 每次只解析所選日期附近至多 28 份，避免讀取所有歷史 payload。

### 前十股票單檔歷史

點排行榜或族群篩選中的股票，開啟單檔視窗，可直接「加入追蹤・更新新聞」或預覽新聞。已追蹤時按鈕顯示已加入，不重複追蹤。加入追蹤沿用原有 GitHub Actions 新聞更新流程。

單檔歷史提供已保存至多 60 交易日的成交值折線、前十名次折線、前十出現天數、最佳前十名次，以及每日精確全市場排名與進出榜狀態。排名圖將超過 10 名畫在「榜外」列；缺資料留空，不當成第 0 名或成交值為 0。表格保留精確榜外名次。讀取需登入，不需先追蹤，歷史資料共用。

### 日／週／月及分鐘 K 線

單檔視窗提供日 K、週 K、月 K、1／5／15／60 分鐘 K，紅漲綠跌，附成交量。日 K 只列官方回傳有效 OHLC 的交易日，無假日占位；週 K 以週一分組，月 K 以年月分組，開＝首日、收＝末日、高低＝區間極值、量＝加總。未結束的週／月／分鐘 K 標記尚未完成。手機可水平滑動，點 K 棒查看數字。價格未還原，除權息需另行考慮。

日行情支援上市 TWSE STOCK_DAY 與上櫃 TPEx tradingStock（成交股數千股轉為股）。每日 Actions 補所有已追蹤公司，以及保存排行中曾入前十的股票。首次補近五個月，後續僅更新最後行情日前七天涵蓋月份，條件 upsert 包含 OHLC 更正，所有使用者共用。首次自動執行 Refresh stock candlesticks；亦可手動重跑。既有 Update company news 每日會更新行情。

分鐘 K 由 Worker 依官方公司名錄組合 Yahoo Finance .TW／.TWO 查詢近五個交易日；用來源真實分鐘 OHLC，不從日 K 推算。固定白名單代碼／週期，快取三分鐘，無分鐘資料 D1 寫入、無輪詢。Yahoo chart 介面非有服務保證的正式開放 API，可能延遲／限制存取；失敗顯示原因，日週月圖仍可用。圖最多顯示最近 100 根，省略未回傳時段、空 OHLC 和一般交易時段外資料；重新載入仍受三分鐘快取影響。

### 可調整 MA 均線

K 線可開關 MA5／10／15／60，預設開啟 5／10；輸入 1～250 的自訂週期（最多 6 條）後套用。MA 使用選定週期每根 K 棒收盤价的简单平均，日 K 為交易日、週 K 為週、分鐘 K 為該分鐘週期。先用完整已讀行情計算再裁出最近 100 根，避免因畫面範圍少算長均線。資料不滿 N 根不畫 MA；缺少有效收盤不補值。設定保存在裝置 localStorage，計算完全在前端，不新增 DB 寫入／Cloudflare 查詢。

### 手機券商庫存匯入（不是券商登入）

目前使用者僅使用手機，因此本版採永豐金／中國信託庫存 CSV／TSV 匯入或手動貼上，不宣稱已連線券商。永豐正式整合需 Shioaji SDK 與 API Key；中信官方庫存 API 需 Windows 致富王 COM 元件。現有 Pages／Worker 無法直接運行這些元件。中信行情 API 尚未確認，現版仍使用網站行情。

登入 Google 後點「券商庫存」，選券商及數量單位，選擇 UTF-8／Big5 檔案或貼上明細，先預覽再確認。欄位示例：股票代號,股數,平均成本；成本可留空。明確股數／張數欄位優先於選擇單位，普通數量欄位按選擇單位處理。只匯入正數現股庫存，同代號重複時需先彙整，最多 100 檔。支援 0050 等代號保留前導零，但 ETF 可能無本站行情／無法加入普通公司新聞追蹤。

每家券商各保存一份最新快照，確認時取代該券商舊明細。僅 localStorage 保存於裝置，按 Google 使用者 ID 隔離，不跨手機同步，不上傳股數、成本、券商密碼或憑證。行情查詢只傳股票代號，一次批次讀取已保存日收盤，不輪詢、不寫 DB。估計損益未含費用／股利；顯示行情實際日期，非券商即時帳務。可逐檔加入新聞追蹤、查看 K 線或清除此裝置該券商明細。

### 使用者自己的 AI（僅瀏覽器直接連線）

頁首「AI 設定」、當日總結中的「使用個人 AI」、新聞卡片的「個人 AI 摘要」支援 OpenAI、Azure OpenAI 與 LiteLLM。這組設定與 GitHub Actions 的 OPENAI_API_KEY 完全獨立。

- OpenAI：Base URL `https://api.openai.com/v1`，填模型與自己的 API Key。
- Azure OpenAI：填資源根網址 `https://資源名稱.openai.azure.com`、部署名稱、API version（預設 `2024-10-21`）、API Key。本介面使用 `/openai/deployments/{deployment}/chat/completions?api-version=...`，不是 Azure v1 模式。
- LiteLLM：填公司閘道的 Base URL（例如 `https://ai.company.example/v1`，系統附加 `/chat/completions`）、閘道模型別名與個人虛擬金鑰。閘道若直接提供 `/chat/completions`，Base URL 不加 `/v1`。

預設設定與金鑰只留在分頁記憶體，重新整理即清除。「在這個瀏覽器記住」才寫入該瀏覽器 localStorage，未加密且不跨裝置同步，共用裝置不應啟用。清除設定會刪除保存資料與記憶體金鑰。個人金鑰只放在直接 AI 請求的認證 header，不送往本專案 Worker、GitHub Actions 或 D1；不跟隨重新導向，不傳送 Cookie。模型供應商或公司閘道仍會收到金鑰、新聞與提示詞，並可能依其政策保存。請使用有限額、可撤銷的個人金鑰。

公司端點必須使用 HTTPS、瀏覽器信任的憑證，並允許來源 `https://ugiyo.github.io` 的 CORS 預檢 OPTIONS 與 POST，允許 `Content-Type, Authorization`；Azure 為 `Content-Type, api-key`。私人網路端點還可能需要瀏覽器的區域網路存取許可與公司 VPN。若瀏覽器連線失敗，不會改用本專案後端轉送。

送出前可檢視、編輯新聞內容。預設只有標題與既有摘要／摘錄，不會自動抓取新聞連結全文；可自行貼上全文。每次上限 60,000 字元，超過時視窗明確提醒截取。摘要結果僅在目前視窗顯示，不寫入共享 DB。測試連線也會呼叫模型並可能計費。未持有實際公司服務金鑰，部署驗證不代表公司 CORS／模型設定已通過。

### 本機 Python 模式：公司 AI 不需要設定 CORS

需在**實際使用網站的同一台電腦**啟動 Python 3.8 以上；不需 pip 或外部套件。下載 `tools/local_ai_bridge.py`，在所在目錄執行：

```bat
py -3 local_ai_bridge.py --open
```

也可使用 `python local_ai_bridge.py --open`。Windows 可將 `tools/start-local-ai.bat` 與 Python 檔放在同一資料夾，雙擊 bat 開啟。保持命令視窗開啟；Ctrl+C 停止。

網站 AI 設定中選「本機 Python」，本機網址預設 `http://127.0.0.1:8765`，填入命令視窗顯示的 `Pairing token`，再填公司 LiteLLM 的 HTTPS Base URL、模型與金鑰。配對碼每次啟動重新產生，永不寫入瀏覽器保存設定。金鑰在請求時經 loopback 傳入本機 Python，再由 Python 直接呼叫 AI，不傳至本專案後端。公司 AI 不需 CORS；本機工具已允許此網站來源。

若瀏覽器要求本機／區域網路存取權限，需要允許。公司瀏覽器政策若禁止網站連線至 localhost，可直接開啟 `http://127.0.0.1:8765` 本機操作頁面，貼上新聞並填入金鑰；該頁不保存設定。手機上的 127.0.0.1 指手機自己，不能連到電腦上的工具。本版只監聽 127.0.0.1，不開放 LAN。

本機工具限制 Host、Origin 與配對碼，拒絕重新導向、不記錄金鑰／內容、不保存結果。支援系統 HTTP(S) 代理環境變數；公司 CA 可用 `--ca-file company-ca.pem` 指定，保持 TLS 驗證。網頁取消會停止等待，但已送往 AI 的請求可能繼續執行並計費。工具不是公司 LiteLLM 的實際連線驗證；仍需在公司網路測試憑證、端點及模型權限。

### 引導下載與背景執行（Windows）

AI 設定中的「本機 Python」提供三步引導：下載 ZIP → 完整解壓縮並雙擊 `start-local-ai.vbs` → 在本機頁面複製配對碼，回網站確認配對。配對成功後填 LiteLLM／AOAI／OpenAI 的 endpoint、模型與 API Key，再測試連線。摘要時會自動確認本機配對並送交 Python。

下載包在建置時由 `scripts/prepare_ai_download.py` 產生，包含目前版本 Python 工具、背景啟動 VBS、命令視窗 BAT 與說明；不包含金鑰或使用者設定。Windows 背景模式使用已安裝的 `pyw`／`pythonw`，不需保持命令視窗。需要 Python 3.8 以上，不會自動安裝 Python、不設定開機啟動，也不修改公司安全政策。若公司限制 VBS，改用 BAT。

背景工具啟動會開啟 `http://127.0.0.1:8765`，頁面提供「複製配對碼」與「停止背景工具」。關閉該分頁仍會繼續執行；重啟工具配對碼會更新。健康檢查不回傳配對碼；配對與摘要請求均需本機通行碼。配對碼不寫入網址或瀏覽器保存設定。背景啟動的 Windows 操作需在使用者電腦實際測試，CI 驗證不代表公司政策允許 VBS。

### 個人 AI 設定與新聞內文生成（工具版本 3）

頁首設定並套用 API 資料一次後，新聞卡片、當日總結與月份摘要視窗中的生成按鈕會直接使用目前設定，不再重複顯示設定表單。各視窗另有「查看目前 AI 設定」，金鑰預設以密碼欄位遮蔽。設定仍只在個人裝置保存。

新聞摘要先讀取原文，不使用標題或先前摘要當作全文。瀏覽器直接連線模式由後端只讀取新聞內文，API Key 留在個人裝置直接呼叫 AI；本機 Python 模式則由本機工具讀取新聞與呼叫 AI。手機使用 OpenAI 不需下載工具。來源限制為中央社、MoneyDJ、鉅亨網，可解析 Google News 原文網址；從文章 JSON-LD 的 articleBody 或文章內文區塊讀取可取得的完整內文。付費牆、太短、來源拒絕、解析失敗及超過長度上限時停止，不截斷後宣稱全文。網站結構變動或來源僅提供部分文字時仍可能無法取得，需檢查顯示的原文內容。

多篇生成先確認所有文章可讀；任何一篇失敗便停止，不默默略過。內容可一次容納時直接送入模型；較長時逐篇完整摘要，再整合。可在結果視窗展開「查看已讀取的新聞內文與來源」核對。AI 內容只留在目前視窗，不寫入共享 DB，也不經本專案後端。多篇與分段整合可能產生多次模型費用。

已下載舊工具的使用者需先停止背景工具，再下載新版 ZIP、解壓縮啟動並重新配對。版本檢查會提示舊工具更新。本環境無法連到三家來源進行實站抽樣驗證，解析邏輯測試不代表每篇原文都可取得；失敗會在介面列出且不呼叫 AI。

### 手機 OpenAI 不需工具（修正）

「瀏覽器直接連線」模式：後端 `/article-content` 只接受新聞網址、驗證網站登入與三家來源白名單，再回傳文章內文；不接收個人 AI 設定、不呼叫 AI、不寫入 D1 新聞內容。手機拿到內文後直接向使用者選定 AI 服務送出認證 header 與提示詞。此模式不檢查 localhost、不需要 Python。全文取得仍可能因來源結構、Google News 解析或來源限制失敗，失敗不生成標題替代摘要。

「本機 Python」模式：公司 LiteLLM 不允許網頁 CORS 時才選用；需要電腦啟動與配對工具。網頁設定中的工具下載引導只在此模式顯示。

新聞內容讀取會產生後端請求及來源讀取，但不增加 D1 新聞資料存量。模型金鑰不在此請求中；後端拒絕包含額外 AI 設定欄位的內容請求。手機端 OpenAI 真實金鑰與來源連線仍需使用者測試，測試使用模擬服務，不宣稱已驗證使用者金鑰。

### 新聞網址誤擋修正

全文讀取支援 MoneyDJ 手機入口 `m.moneydj.com/f1a.aspx`、鉅亨同站入口 `gfe-desktop.cnyes.com`，會轉成對應的桌機原文網址；僅將已知來源的 HTTP 連結升級為 HTTPS，不對其他網站開放。Google 的 `/url?url=...` 包裝只解開並重新驗證目的來源，Google News 直接轉到原文時立即讀取原文，不再強制要求 RPC signature。錯誤會列出被拒絕的網域。短篇公告在辨識出的文章內文區塊中取得至少 80 字元即可處理；不再以 350 字元門檻排除真實短文，付費牆、無文章區塊及極短標題仍會拒絕。

## Podcast 月曆與個人 AI 整理

已接入「兆華與股惑仔」Spotify 頻道與 SoundOn 公開 RSS。左側 Podcast 頻道可啟用、更新或匯入；每集以台灣時間發布日期顯示於月曆及當日 Podcast 區塊，不套用個股篩選。GitHub Actions `Update podcast episodes` 每天台灣時間 18:00 刷新最近 100 日、最多 150 集的共用 JSON，並啟動 Pages 部署。內建頻道使用共用 JSON；登入者匯入的頻道與集數保存在共用 D1，不保存音訊。

目前官方 RSS 沒有逐字稿。點「逐字稿・AI 整理」後，可下載原集並轉文字、選取音訊檔，或貼上／匯入 TXT、SRT、VTT。語音模型與文字模型分開指定（例如 OpenAI 的 `whisper-1`；Azure 填語音部署名稱；LiteLLM 必須有語音模型與 `/audio/transcriptions` 支援）。使用上方已套用的個人 AI Key，先取得逐字稿，再按「生成內容整理」。節目簡介不替代整集逐字稿。

手機直接下載來源音訊並呼叫個人 AI 服務；API Key 不傳至 Cloudflare、GitHub 或本專案後端。公司 LiteLLM 若選本機 Python 模式，需下載新版工具（version 4），音訊在本機轉送到指定 AI 服務。語音轉錄與摘要均會消耗個人 API 用量。音訊上限 120 MB；大於 24 MB 時以 Web Audio 在裝置中解碼為五分鐘單聲道 WAV 分段，最多兩小時。長音訊需要較多裝置記憶體，請保持頁面開啟；無法解碼或來源拒絕下載時可改用分段音訊或逐字稿。

部分音訊轉錄失敗會列出缺漏段落，仍可整理其餘內容並標示部分摘要。文字整理會逐段讀取較長逐字稿後整合。逐字稿及結果預設只留此分頁記憶體；勾選保存後留在此裝置、依使用者與單集識別，不寫入共享資料庫。可以清除此集本機記錄。

單集視窗最上方「一鍵生成本集重點」自動完成下載、逐字稿轉錄與內容整理；已有逐字稿時略過下載及轉錄。即使最後摘要失敗，成功取得的逐字稿仍留在裝置，重試只需重新整理文字。「只轉成逐字稿」保留為進階操作。

來賓篩選依節目標題 ft. 欄位辨識，選擇後列出符合的發布日期，可點日期跳轉；不影響個股新聞。AI 成果中心自動將 Podcast 重點、逐字稿及新聞摘要保存於目前裝置，依登入使用者分開，不保存 API Key。生成中可關閉視窗並操作其他日期，完成時以站內通知連到成果中心；網站分頁必須保持開啟，手機休眠或關閉瀏覽器可能中斷。儲存空間不足時通知成果僅留在目前分頁。

Podcast 長音訊改為每段 2 分鐘（16 kHz 單聲道 WAV），暫時網路錯誤及 HTTP 429/502/503/504 最多重試一次。成果中心部分內容可點「補轉未完成段落」，保留成功段落，下載原集後只送出缺少時間範圍，並重新整合重點。舊版含 [0～5 分鐘] 之類標記的逐字稿也可續轉；沒有時間標記則不猜測完成位置。成功段落與進度只存在個人裝置，不保存音訊或 API Key。

已接入第二個頻道「Gooaye 股癌」：可貼上 Spotify show/1zWxx5pKk0XBEzMupVC7UZ 匯入。官方 SoundOn RSS 同樣每天台灣時間 18:00 更新最近 100 日（涵蓋三個月），每頻道最多 150 集。月曆上方可選擇頻道，再依來賓篩選；來賓未標示不猜測。不同頻道單集 ID 分開，原有成果不變。

Podcast 匯入也支援任何公開 HTTPS RSS Feed。從 Podcast 平台複製 RSS Feed 網址貼入「匯入 Podcast 頻道」即可；登入後匯入的頻道與最近最多 150 集會保存到共用 D1，所有登入者均可查看。每天台灣時間 18:00 自動同步，立即更新也會保存至共用資料。既有瀏覽器的本機 RSS 頻道會在登入後自動同步，成功後移除本機清單項目，失敗則保留並提示。任意 Spotify 節目頁不一定包含 RSS，若貼 Spotify 網址無法取得集數，請改貼節目的 RSS Feed；RSS 可透過既有代理讀取；共用清單與集數 API 必須登入才能存取。同一 RSS 重複匯入不重建頻道，更新失敗保留原有集數。

手機離開 App 不保證背景運作。從任務建立（包含下載尚未完成）起，進度會保存於同一裝置／瀏覽器；重新開啟後，沒有執行中的任務會標為中斷，成果中心可繼續任務，保留成功音訊段落。未登入時的本機成果也會在登入後顯示，其他已登入帳號的成果不混用。記錄只包含節目來源、逐字稿、成果與進度，沒有 API Key。


### Personal AI background tasks and result notifications

The header notification list links each unread item to its own result. Results are grouped into news and podcast categories. Device mode retains local progress and requires an open browser tab; it does not continue after the tab is closed.

Cloud background mode is opt-in per task and requires login. It accepts public OpenAI/Azure endpoints, encrypts the task payload and temporary provider key using AES-GCM with a key derived from the existing COLLECTOR_SECRET, and processes jobs in GitHub Actions. The provider key is deleted on terminal status or stale-task cleanup; queued tasks expire after 24 hours. `/ai-jobs` only returns the logged-in user's results and never returns encrypted credentials. Completion/read state is synchronized to that account.

**Rollout:** deploy the updated Worker (including `worker/ai-jobs.js`) with the existing DB binding, COLLECTOR_SECRET, GITHUB_DISPATCH_TOKEN and GITHUB_REPO. The new table is created automatically. The existing `news.yml` workflow installs cryptography and ffmpeg and runs the personal job processor before the news collector; it safely skips if the Worker still returns 404. No new secret values are needed. The frontend shows a clear error when the background API is not deployed. Cloud tasks cannot reach company-only endpoints.

Cloud result deletion cancels future checkpoints and removes its stored credentials. A provider request already in progress may still finish and incur API usage. Worker code can be bundled for Cloudflare dashboard upload using `node_modules/esbuild/bin/esbuild worker/index.js --bundle --format=esm --outfile=worker-bundle.js`; retain the existing Worker settings/bindings when updating it.

Podcast RSS 匯入會先由瀏覽器直接讀取；若 RSS 來源（例如部分 SoundCloud Feed）未開放 CORS，前端會改呼叫 `GET /podcasts/rss?url=...` 由 Worker 代理讀取。此端點只接受公開 HTTPS RSS、限制 3 MB，且不接收 AI 設定、API Key、音訊或逐字稿。修改 Worker 後需重新部署，否則仍會看到 `Failed to fetch`。


### Company LiteLLM isolation and optional local background jobs (v5)

Existing browser-direct LiteLLM connections remain supported: enter the company gateway URL,
model and gateway key as before. No Python installation or company-side configuration is required.
The cloud background checkbox is hidden/disabled for LiteLLM, and `submitCloudTask` rejects LiteLLM,
Python transport and locally marked content **before any cloud capability request or upload**.
The key may be a company-issued proxy key; it is still never sent to Cloudflare/GitHub AI jobs.
Direct mode requires the browser to stay open. Its existing optional local browser storage remains.
Public-news retrieval may still send the public article URL (only) to the article reader; company keys,
transcripts and generated answers are not included. The configured company gateway controls downstream routing.

For users who opt into LiteLLM + Python, update the local ZIP to v5. The loopback-only authenticated
`/local-jobs` API queues work independently of the page, retains keys only in memory and checkpoints
results in `~/.stock-news-local-ai/results.sqlite3` (override with `--data-dir`). Re-pair/apply settings
after reopening the page to load local results in the result center, or use the local homepage.
A restart requires re-entering the key and explicitly resuming interrupted work. No cloud fallback exists.
News/text summaries need Python standard library only; background audio downloading/transcription needs
company-approved ffmpeg/ffprobe on PATH. Already imported transcripts need no audio tools. File-input
transcription remains device-controlled and explicitly requires the page open. Public audio/news GETs
carry no gateway credentials or private task payload. The computer/Python must stay awake/running.
Local results are scoped to the OS user and pairing token, not a cloud account. Cancellation/deletion
prevents subsequent checkpoints; an in-flight provider request may still finish. No Worker/D1 update
is needed for this change. GitHub Pages deploys the frontend and the updated optional tool ZIP.

成交值排行新增櫃買中心產業價值鏈細項分類。`public/data/value-chains.json` 由 `scripts/sync_value_chains.py` 擷取官方公司名單，每月 1 日台灣時間 10:30 由 Update Value Chains 更新，也可手動執行；全部成功後才覆寫快照。不同細項可重複包含同一公司，占比不可加總。歷史分析採目前分類，不推定過去公司業務相同。

追蹤股「高關聯・成交集中」需同細項其他成員的成交值占全市場比例至少 2%，較前一交易日增加至少 0.3 個百分點，且個股與同細項其他成員的每日成交占比變化 Pearson 相關係數至少 0.6。使用選定日期以前最多 31 日資料、至少 15 組相鄰交易日變化；排除個股自身成交值，資料不足不標高關聯。這是成交活躍度同步估計，不能視為資金淨流入、因果關係或未來漲跌預測。

### Optional account data sync

The header checkbox `同步帳號資料` defaults to off and is remembered separately for each account in each browser. The first local-mode visit copies the existing account watchlist and current month's saved news as a starting point. Subsequent watchlist changes and news refreshes are saved to that browser. Turning sync on merges local companies into the account watchlist and synchronizes saved news and completed public-mode AI output. Turning it off keeps a device copy and leaves the existing account records intact. API settings, API keys, bridge tokens, continuation requests, and company-mode AI results are excluded. Cloud background tasks remain account-stored because enabling that mode is a separate explicit choice.

Deploy the updated `worker/index.js` or paste `worker/worker-bundle.js` into the existing Cloudflare Worker, preserving its bindings and secrets. The authenticated `/account-results` and `/account-news` routes create their own D1 tables on first use; no manual migration is needed. Until that Worker update is deployed, the frontend leaves sync off and displays a message. Result sync uses latest timestamps and deletion tombstones; account data is isolated by authenticated user ID. Results larger than 500 KB stay on the device and report a sync error. Device mode requires the same browser profile and is lost when site data is cleared.

### Podcast financial terminology and evidence

Browser, cloud background, and the updated local Python tool share the finance-aware summary policy and compact transcription vocabulary. Summary output contains episode takeaways, sector/value-chain groups, mentioned targets, original-to-corrected terminology, and unresolved excerpts for listening. The original transcript stays intact; model provenance is carried into summaries and saved results, with imported/edited/legacy transcripts marked as unknown instead of inferred from the current model setting. Correction uses actual supplied text and episode metadata, not the vocabulary hint as evidence. It never claims a second audio-model verification or listening when none was performed, invents ticker codes, or silently changes numbers and trading direction. Existing summaries are retained; regenerate content summaries to apply the new policy. Company Python users should download the updated tool ZIP.

Podcast device-mode failures now distinguish transcription and summary stages and include the provider host, reported offline state and page visibility, without keys. A transient transcription request retries once (using Retry-After when supplied); three consecutive failed segments pause the job, checkpoint successful ranges and mark the remaining range as not attempted. Permission, invalid-model and quota failures stop immediately. Paused transcription never automatically advances to summary. Use the existing resume action after restoring connectivity; prior successful segments are skipped. Missing content details are collapsed in the results center. Public OpenAI/Azure users can explicitly choose cloud background mode for long episodes on mobile; company-only providers stay in device/local mode.

Podcast watchlist mentions first use saved transcripts and then align to completed AI summaries. The calendar uses the episode date, respects the selected stock and podcast filters, and shows a star badge for days mentioning current watchstocks. Day details link to the saved summary and highlight matching paragraphs, with source excerpts and their original time ranges. Gold marks direct transcript matches; purple marks AI name corrections whose original phrase is actually present in the transcript. Uncertain, title-only, code-block, and correction-only statements do not create a calendar mention. Pure price numbers and known conflicting names are excluded. No AI/API requests are made by marking or changing watchstocks. Saved transcripts also create preliminary mentions before summarization. Existing episode drafts are reused. Completed AI answers align matching summary passages and may add explicitly evidenced name corrections; raw mentions absent from the summary remain labeled preliminary. Marks recalculate without extra AI requests.

Podcast imports and episode refreshes now reuse saved transcripts and automatically fetch public `podcast:transcript` links from RSS (TXT/SRT/VTT/JSON). Requests run with three concurrent downloads, a 20-second timeout and a 1.5 MB / 300,000-character limit. Public CORS failures fall back to `/podcasts/transcript`, which validates HTTPS targets and redirects, rejects private/IP hosts and non-text media, and forwards no user credentials or API keys. Original source text and timestamps are retained; JSON segment times are rendered as source minute ranges. No transcript link displays “需轉錄或匯入”; failures offer retry in the episode window. Import never automatically invokes paid transcription or AI summarization.

Podcast result previews now provide a separate location button and occurrence count for every mentioned watchstock. Each click selects that stock and cycles through its own summary positions, including names in headings, links, tables and shared paragraphs. Stocks omitted from the summary remain reachable through clearly labeled source excerpts, including long-line mentions beyond the first 500 characters. Publication dates and original transcript time ranges remain unchanged; navigation does not invoke AI.

D1 quota recovery: daily read/write exhaustion returns HTTP 503 with `D1_READ_QUOTA` / `D1_WRITE_QUOTA`, next UTC-midnight `reset_at` and Retry-After. The browser remembers the backend pause until reset, preserves the login token, and stops repeating database requests; public RSS/transcript fetching and device-local data remain available. Cloud result polling is every 5 minutes when idle, 15 seconds while tasks are active, pauses in hidden tabs and avoids resaving unchanged tasks. Optional account sync idles at 5 minutes; news uploads use batches of 40 and unchanged records are not rewritten. Query indexes are created lazily once per Worker database binding for news URL lookup, personal task user/order/status/expiry, account result ordering and summary-cache expiry. The quota status offers a read-only recovery check to resume earlier if service capacity becomes available. Existing data is retained. Index creation retries after quota recovery; this release cannot replenish an exhausted Cloudflare quota.


### Independent daily news recovery

An independent ChatGPT task checks the daily news collector at 06:17, 07:17, 08:17 and 09:17 Asia/Taipei. If no full daily collection has succeeded since 06:00, and no daily news job is queued or collecting, it updates `.automation/news-daily.json` on `main` with a `[news-daily-trigger]` commit. This file is an explicit workflow input: its push runs `news.yml` in daily mode without relying on GitHub cron delivery. Scheduled recovery and marked heartbeat pushes share the daily success guard inside the serialized news job. A successful news step suppresses duplicate daily collections even when price/AI maintenance fails. Queued per-company dispatches are never treated as a full daily refresh. Failed collection or an absent workflow remains eligible for a later attempt; the task reports unresolved failures. The heartbeat contains only request date/time and attempt metadata. It does not contain secrets and does not change user AI settings. Heartbeat-only pushes skip GitHub Pages deployment.

GitHub cron remains a fallback. The independent task still depends on the connected GitHub account and GitHub push/Actions availability; monitor failures rather than assuming that a successful dispatch or maintenance job proves news freshness.
