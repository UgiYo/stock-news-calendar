# Substack 匯入來源驗證

測試刊物：`https://unclestocknotes.substack.com`。日期：2026-10-15（台灣時間）。不使用付費訂閱 cookie、不呼叫 AI。

| 方式 | 實測結果 | 適用範圍 |
| --- | --- | --- |
| GitHub Actions 的 Python 直接連線 | Cloudflare challenge，HTTP 403 | 保留為優先嘗試，失敗切換 |
| Chrome 相容 HTTP/TLS 客戶端 | 同環境仍為 403 | 未加入額外相依套件 |
| Pages 讀取 archive／posts API | 曾讀到兩頁與正文；背景環境仍有 429 | 可用時使用；受限時切換 |
| Pages 讀取歷史網頁與分享頁 | 429 | 不依賴這些頁面完成匯入 |
| 官方 RSS | 200，最近 20 篇；增加 limit／offset 不提供歷史 | 不能將 RSS 當成全部文章 |
| 官方 sitemap | 200，首次 1,314、最終校驗 1,315 個文章連結 | 完整性交叉驗證，不提供正文 |
| 雲端瀏覽器 | 工作環境顯示 Site Unavailable | 無法作為正式背景來源 |
| Jina Reader 原始 JSON | 已取得分頁 JSON 與舊公開文章正文 | 匿名備援，不使用 AI 轉換 |

Reader 回應必須保留原始來源網址；JSON 格式、文章 slug、來源網域不符即失敗。付費文章僅使用匿名可見預覽，保持「公開預覽／部分內容」分類，不推測隱藏段落。

分頁實測出現過一篇重疊，故採半頁重疊、正文快取與資料庫 upsert。完整歷史驗證會持續列舉到最後一頁，再與 sitemap 比較缺漏，不能僅憑第一頁能讀取就宣稱整批匯入成功。

## 驗證結果

- [完整來源清單驗證](https://github.com/UgiYo/stock-news-calendar/actions/runs/38657885121)：已列舉並去重 **1,315 篇**，與官方 sitemap 比對無缺漏；測試包含舊公開文正文與付費預覽。這是來源清單完整性，不代表全部正文已寫入資料庫。
- 測試期間 `gs-2026` 一度存在 sitemap、卻未出現在 archive；因此加入 sitemap 補抓，並在後端逐篇核對已存 ID 後才標記完成。
- [實際保存與時間上限驗證](https://github.com/UgiYo/stock-news-calendar/actions/runs/38655888364)：20 分鐘工作正常保存到游標 240，觸及預算後自動排入續抓。
- [自動續抓工作](https://github.com/UgiYo/stock-news-calendar/actions/runs/38657870796) 已實際啟動；2026-10-15 08:07 台灣時間的資料庫截點為 **254 篇，含 55 篇公開正文，last_error 為 null**。其餘正文仍在背景匯入。
- 自動測試涵蓋匿名備援來源驗證、無憑證外送、錯誤頁拒收、限流恢復、半頁重疊、UTF-8 分批保存、預算暫停、sitemap 補抓、未部署 API 不誤報完成、超過 1,000 篇儲存清單分頁與一般作者解析。

合併後須完成現有 Pages API 部署，提供 collector 專用的已存 ID 分頁介面，才能進行最後逐篇核對。資料會保留；來源或核對失敗不標記全部完成。
