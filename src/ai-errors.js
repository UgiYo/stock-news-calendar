export function connectionDiagnostic(config,stage){
 let host='網址無效';try{host=new URL(config.transport==='python'?config.bridge:config.endpoint).hostname;}catch{}
 const label=config.transport==='python'?'本機 Python':({openai:'OpenAI',azure:'Azure OpenAI',litellm:'LiteLLM'}[config.provider]||'AI 服務');
 const online=typeof navigator!=='undefined'&&navigator.onLine===false?'裝置回報離線':'離線狀態未確認';
 const visibility=typeof document!=='undefined'?document.visibilityState:'未記錄';
 const publicEndpoint=config.provider==='openai'||config.provider==='azure'&&host.endsWith('.openai.azure.com');
 const advice=config.transport==='python'?'請確認工具正在運作、配對碼及瀏覽器本機網路權限。':publicEndpoint?'請檢查網路並保持頁面在前景；長節目可選擇雲端背景處理。':'請確認服務網址、公司網路／VPN、HTTPS 憑證與 CORS。';
 return `${stage}連線失敗（${label}／${host}；${online}；頁面 ${visibility}）。瀏覽器未提供 HTTP 狀態，尚無法判定是網路、CORS、服務中斷或瀏覽器暫停。${advice}`;
}
