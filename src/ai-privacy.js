// Company gateway credentials and content must never enter cloud AI jobs.
export const companyMode=config=>config?.provider==='litellm';
export function assertCloudConfig(config,input={}){
 if(companyMode(config)||config?.transport==='python'||input.local_only)throw Error('公司 LiteLLM／本機資料禁止送到雲端背景任務。請使用直連或本機 Python。');
 let u;try{u=new URL(config?.endpoint);}catch{throw Error('AI 端點不正確。');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!((config.provider==='openai'&&u.hostname==='api.openai.com')||(config.provider==='azure'&&u.hostname.endsWith('.openai.azure.com'))))throw Error('雲端背景僅支援公開 OpenAI／Azure 端點。');
}
export function configureCloudOption(root,config){
 const checkbox=root.querySelector('[data-cloud-ai]'),help=root.querySelector('.cloud-ai-help');
 const local=companyMode(config)||config?.transport==='python';
 if(checkbox){checkbox.disabled=local;if(local)checkbox.checked=false;checkbox.closest('label').hidden=local;}
 if(help&&local)help.textContent=companyMode(config)?(config.transport==='python'?'公司本機背景：任務與成果保存在公司電腦，Key 只留記憶體。排入後可關閉網頁；電腦與工具需持續運作。':'公司直連：Key、逐字稿與摘要不送到 Cloudflare／GitHub。沿用目前 LiteLLM 連線，不需安裝工具；請保持網頁開啟。'):'本機模式不提供雲端背景上傳。';
}
