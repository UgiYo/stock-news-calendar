# 公司內網 LDAP 登入部署

本功能前端維持 GitHub Pages，內網 HTTPS 登入服務只在公司/VPN 可達；公司密碼只送至內網服務，以 LDAP TLS Bind 驗證。內網服務主動對 Worker 回報 RS256 簽章結果。Worker 不連入公司，不接收密碼。這是自訂橋接協定，並非 OIDC server。

## 已整合

- 登入畫面新增公司帳號（限內網/VPN）；未配置後端時提供設定未完成訊息。
- Worker `/auth/company/start`、`assertions`、`exchange`，D1 migration 0002。
- 簽章登入請求、簽章驗證結果、state + PKCE S256、60 秒一次性授權碼、交易原子消耗。
- 公司帳號以 issuer + objectGUID 雜湊命名，與 Google 身分分開，不依 email 合併。現有 users.email 欄位對公司帳號保存顯示名稱。
- 公司 Session 沿用現有 Bearer token 機制與前端儲存方式，有效期一小時。離開內網不立即失效。帳號綁定/合併尚未實作，Google 的追蹤股不會自動移至公司帳號。
- 内網 Flask/ldap3 服務、Dockerfile、設定範本、金鑰產生工具與測試。

## 需要 IT 確認

已提供 `10.10.101.2:3268`、Base DN `DC=umc,DC=com`。3268 疑似 AD GC；改用 3269 LDAPS 或 3268 強制 StartTLS 需確認伺服器支援。提供憑證 SAN 對應 DNS 名稱與公司 CA；禁止關閉憑證驗證。

確認帳號格式（UPN suffix 或 DOMAIN\\username）、內網 HTTPS 登入域名、允許登入群組、內網對 Worker HTTPS 443 出站權限及必要代理。服務目前用使用者 Bind 後的權限搜尋 sAMAccountName/objectGUID/displayName，不需要預存 LDAP 搜尋服務帳號。若權限不足需另加最小權限搜尋機制。巢狀群組使用 AD matching rule；GC 的跨網域群組與部分屬性必須實測，必要時改連所屬網域的 LDAPS 636。

## 1. 金鑰

在安全主機執行（目錄不可位於 git repo）：

```sh
node internal-auth/generate-keys.mjs /private/company-auth-secrets
```

內網部署 company-signing-private.pem、worker-request-public.jwks.json、公司 CA 與 flask-secret.txt。Worker 配置 worker-request-private.jwk.json 與 company-signing-public.jwks.json。兩邊只交換公鑰，不交換私鑰；工具不覆蓋現有檔案。輪替時先部署新公鑰，再切換 kid/私鑰。

## 2. D1 與 Worker

```sh
npx wrangler d1 migrations apply stock-news-calendar --remote --config worker/wrangler.toml
```

如使用 Dashboard 管理 D1，執行 `worker/migrations/0002_company_auth.sql`。這只新增資料表，不更動既有 users/sessions。

| Worker 設定 | 值 |
|---|---|
| COMPANY_AUTH_ENABLED | true（完成內網測試後才開啟） |
| COMPANY_LOGIN_URL | https://實際內網域名/login |
| COMPANY_ISSUER | urn:stock-news-calendar:company |
| COMPANY_REQUEST_KID | worker-v1 |
| COMPANY_REQUEST_PRIVATE_JWK（Secret） | worker-request-private.jwk.json 完整內容 |
| COMPANY_ASSERTION_JWKS（Secret） | company-signing-public.jwks.json 完整內容 |

APP_URL 保持 `https://ugiyo.github.io/stock-news-calendar/`。Worker 若在 Cloudflare Pages/functions 或 Dashboard 以單檔部署，使用更新後 `worker/worker-bundle.js` 並保留現有 DB binding/Google Secrets。`GET /auth/company/config` 可檢查是否配置；它不測試內網 LDAP。

## 3. 內網容器

以 `internal-auth/.env.example` 建立不進版控的 `.env`，替換所有 placeholder。公司帳號輸入短帳號，LDAP_LOGIN_TEMPLATE 轉成實際 Bind 名稱。必須設定允許群組 DN，或明確指定 LDAP_ALLOW_ALL_USERS=true。

```sh
docker build -t company-ldap-auth:1 internal-auth
# 在外網 build 後用公司既有流程匯入內網 registry。
docker run --rm --name company-ldap-auth --env-file /private/company-auth.env \
  -v /private/company-auth-secrets:/secrets:ro \
  -v /private/company-auth-data:/data \
  -p 127.0.0.1:8080:8080 company-ldap-auth:1
```

`/data` 需允許 UID 10001 寫入 SQLite；只存限流計數與已使用交易，不存密碼。内網反向代理提供 HTTPS，固定 `/login` 與 `/login/form` 路徑，只對內網/VPN 開放，轉送到 8080。禁止 request body 日誌/APM 擷取，不開啟 Flask debug 或 LDAP debug。Gunicorn 預設未啟用 access log。反向代理也應省略含簽章請求的 query string。

限流用五分鐘內每帳號/來源最多五次；反向代理部署時來源 IP 目前為代理 IP，因此須在代理層做來源限流。不要直接信任客戶端 X-Forwarded-For。K8s 先採單 Pod、同一 SQLite volume；多副本需改用共用限流/交易儲存。內網服務健康檢查 `/health` 只表示程序可運作，不表示 LDAP 可達。

密碼在請求處理期間仍短暫存在記憶體；不承諾語言執行環境可以立即抹除每份記憶體副本。

## 4. 驗證與啟用

```sh
npm ci
npm test
python3 -m pip install -r internal-auth/requirements.txt
python3 -m unittest discover -s internal-auth -p 'test_*.py' -v
npm run build
```

已提供本機測試（簽章/PKCE/過期/重放/並行 exchange/CSRF/空密碼/TLS 失敗/回報不含密碼），LDAP 與網路採 mock；不是實際公司驗證成功的證明。部署後需測正確與錯誤帳密、群組權限、公司 CA、內外網可達性與 Worker 回報。內網服務回報失敗須重新開始，不直接建立 Session。

外網使用者可繼續 Google 登入。公司登入服務未部署時，前端按鈕會提示「公司登入尚未完成部署設定」。已部署後外網無法連到內網頁，由瀏覽器顯示連線錯誤；不以瀏覽器網路探測推斷內網狀態。
