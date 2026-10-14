# 美股 Substack 作者文章與標的觀點

美股頁面新增作者文章區，預設刊物為「大叔美股筆記 Uncle Stock Notes」，對應使用者提供的 `https://substack.com/@unclestocknotes`。台股與 Podcast 資料維持各自來源。

## 使用方式

1. 在美股頁面點「匯入 Substack 作者的全部文章」，貼上 `https://substack.com/@作者`、`https://刊物.substack.com` 或刊物文章連結；也支援 `open.substack.com/pub/刊物/...` 分享連結。
2. 點「解析作者／刊物」後核對刊物，再點「匯入此刊物的全部文章」。作者頁可能列出多個刊物，需選擇要匯入的刊物；不以作者 handle 猜測刊物網域。個人頁無法辨識時可直接貼刊物網址。自訂網域須提供 Substack 原始刊物網址。
3. 作者加入共用來源後，背景自動匯入全部歷史文章，不受目前日期、個股或搜尋篩選限制。同一網址重複匯入會更新既有文章，不建立重複文章。來源失敗保留資料與歷史游標。
4. 「作者匯入進度」顯示實際已儲存篇數、完整公開內文／預覽篇數、完成狀態與錯誤；未提供總篇數時不估算百分比。歷史匯入未完成可按「繼續匯入全部文章」，失敗可按「重試匯入」。開啟此頁時每 30 秒自動更新未完成的進度，背景匯入不需保持頁面開啟。
5. 以作者、標的、標題或選定日期篩選。預設顯示所有歷史日期，左側選定個股時只顯示該股票相關文章。
6. 月曆顯示「★ Substack」的日期代表原文提及目前追蹤美股；點日期可查看相關文章。文章的星號表示目前追蹤股。
7. 點股票按鈕可定位原文段落。原文比對只代表提及，不代表看多、推薦買進或持倉。
8. 主動點「生成作者標的與觀點」才會呼叫個人 AI，整理作者立場、理由、催化事件、風險、期限與明確操作。成果保存於同帳號的 AI 成果中心，可跨裝置同步。長文分段處理，保留全篇原文段落編號。

## 匯入範圍與更新

- 使用匿名可取得的 Substack 刊物 archive 與文章內容；不使用訂閱帳號、cookie 或付費牆繞過方法。付費文章或無完整內文的文章標記為「公開預覽／部分內容」，AI 不推測未取得的部分。本文超過 100,000 字元時只保留前段，亦標記部分內容。
- 目前收錄刊物文章；不含作者的 Notes、留言、Chat 或其他作者的轉貼全文。
- 新文分頁讀取至已保存的最新日期，先保存較舊的新文批次，避免中途失敗漏抓。正式工作歷史不再限制 10 頁／200 篇：每頁 20 篇持續抓至最後一頁。單次工作有 20 分鐘預算，接近上限時保存已完成頁面並自動排入後續 workflow，下次重疊一頁後續抓，直到完成。
- 無法讀取內文的 401／403／404 文章保留 archive 提供的公開標題、日期與描述，標記公開預覽，不阻擋後續歷史文章。來源限流／伺服器錯誤仍顯示失敗並保留游標，不將失敗誤判為全部匯入完成。
- `.github/workflows/substack.yml` 每日台灣時間 06:20、18:20 執行。GitHub 實際啟動時間可能延遲。使用現有 `WORKER_API_URL` 與 `COLLECTOR_SECRET`，不新增 AI 金鑰或套件。
- 「更新全部／選定作者的文章」啟動背景工作；「重新載入文章」讀取已保存資料。新作者優先處理，但工作仍檢查所有待匯入來源，避免多位使用者同時匯入時遺漏來源。只有已完成歷史匯入且 15 分鐘內成功更新的單一作者才限流；未完成或失敗作者可續抓／重試。
- 來源是 Substack 公開介面，可能限流、變更或拒絕匿名請求；會顯示來源錯誤並保留既有內容。本次執行環境無法直接存取作者文章端點，實際文章數及內容可取得程度須於正式工作執行後確認，測試使用 fixtures。

## 管理、API 與部署

管理頁面新增兩個可全域或按使用者設定的開關：`news_calendar.substack` 控制文章、標記與使用者 API；`news_calendar.substack_import` 控制新增作者。關閉顯示不刪除文章，既有作者排程繼續更新。美股市場關閉時不提供使用者 Substack API。

共用資料首次呼叫 API 時自動建立 `substack_authors`、`substack_articles`，不需手動 migration。列表僅回傳文章資訊與標的；點文章才讀取公開內文。共用文章不含個人的 AI 觀點整理。

沿用現有 GitHub Pages 前端與 Cloudflare Pages API Git 整合；合併後需兩者完成部署。Cloudflare build command 保持 `npm ci && node scripts/build_cloudflare_pages.mjs`，輸出目錄保持 `cloudflare-api`。後端更新成功後，首次點更新作者文章或執行 `Update Substack articles` 工作開始導入預設作者。首次歷史匯入可能需多次背景工作，工作會自動安排續抓，不需使用者每日重按。

API：`POST /substack/resolve`、`GET/POST /substack/authors`、`GET /substack/articles?offset=0`、`GET /substack/article?id=...`、`POST /substack/refresh`（可傳 `author_id`）。收集端使用 `GET /admin/substack/authors`、`POST /admin/substack/update` 與 `POST /admin/substack/continue`；僅既有 collector secret 可用。續抓僅針對未完成且無來源錯誤的來源；發送續抓失敗會寫入錯誤供使用者重試。workflow 沿用全域 concurrency，續抓包含所有健康待處理作者，不為同一來源並行寫入。AI 成果種類新增 `substack`，沿用 `/account-results` 的登入帳號隔離及來源資訊欄位。

驗證：`npm test`（包含美股 DOM 整合）、`python -m unittest discover -s tests -p 'test_substack_sync.py'`、`npm run build`、`node scripts/build_cloudflare_pages.mjs`。
