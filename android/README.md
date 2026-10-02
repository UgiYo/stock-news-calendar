# 股聞日曆 Android 測試版

Package: `com.ugiyo.newscalendar`, version 0.1.0, Android 6.0+。

這是一個使用 Android Custom Tabs 開啟現有網站的可安裝 App。它會顯示瀏覽器工具列，登入與追蹤功能沿用網站；不是原生重寫的新聞介面，也不支援離線新聞或推播。瀏覽器負責網路及 Google OAuth，不需要新增 Android OAuth client。網站與後端更新會直接反映到 App。

## 取得 APK

GitHub → Actions → Build Android APK → 最新成功紀錄 → Artifacts → news-calendar-android-test。下載 ZIP 並解壓縮，安裝 app-debug.apk。需要登入 GitHub 才能下載 Actions artifact。

手機首次安裝時，依 Android 提示允許目前用來開啟 APK 的檔案管理員或瀏覽器安裝應用程式。測試：啟動、Google 登入、搜尋預覽、追蹤、立即更新、返回 App、重新啟動後登入狀態、分享網站。

若下載後無法覆蓋安裝，可能是 Actions 測試簽章快取失效，需移除舊 App 後安裝。此 APK 只作安裝測試；正式發布應建立並妥善保存專用簽章金鑰。

## 發布界線

目前不會自動發布 Google Play，也不建立公開 GitHub Release。Actions 提供 30 天保存的測試 APK。對外提供 APK 前，應改用固定正式簽章；上架 Play 另外需要開發者帳號、AAB、商店素材、隱私權政策與資料安全申報，並評估瀏覽器型 App 是否滿足商店功能政策。

## 本地建置（可選）

需要 JDK 17、Gradle 8.11.1、Android SDK 35；在 android 目錄執行 `gradle assembleDebug lintDebug`。公司電腦不用安裝這些工具，GitHub Actions 負責建置。
