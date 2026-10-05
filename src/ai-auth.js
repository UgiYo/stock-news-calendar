import {api} from './api.js';
export async function requireAISession({storage=globalThis.localStorage,request=api}={}){
 const token=storage?.getItem('stock-news-session');
 if(!token)throw Error('請先登入，再使用 AI 生成或轉錄。');
 const result=await request('/me');
 if(!result.user?.id||storage.getItem('stock-news-session')!==token)throw Error('登入狀態已變更，請重新登入後再使用 AI。');
 return result.user;
}
export function lockGuestAI(wrap,selectors,status){
 if(globalThis.localStorage?.getItem('stock-news-session'))return;
 for(const selector of selectors)wrap.querySelectorAll(selector).forEach(el=>{el.disabled=true;el.title='請先登入再使用 AI';});
 if(status)status.textContent='請先登入，再使用 AI 生成或轉錄。';
}
