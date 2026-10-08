export const THEME_KEY='stock-news-theme';
export function readTheme(storage=globalThis.localStorage,media=globalThis.matchMedia?.('(prefers-color-scheme: dark)')){
 try{const saved=storage?.getItem(THEME_KEY);if(saved==='dark'||saved==='light')return saved;}catch{}
 return media?.matches?'dark':'light';
}
export function applyTheme(theme,{document=globalThis.document,storage=globalThis.localStorage,persist=true}={}){
 const selected=theme==='dark'?'dark':'light';
 document.documentElement.dataset.theme=selected;
 document.documentElement.style.colorScheme=selected;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',selected==='dark'?'#0c1520':'#112b42');
 if(persist)try{storage?.setItem(THEME_KEY,selected);}catch{}
 return selected;
}
export function themeControl(theme=globalThis.document?.documentElement.dataset.theme){
 const dark=theme==='dark',next=dark?'淺色':'深色';
 return `<button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="${dark}" aria-label="目前為${dark?'深色':'淺色'}主題，切換至${next}主題" title="切換至${next}主題"><span data-theme-icon aria-hidden="true">${dark?'☾':'☀'}</span><span data-theme-label>${dark?'深色':'淺色'}</span></button><span id="theme-status" class="visually-hidden" role="status" aria-live="polite"></span>`;
}
export function updateThemeControl(document=globalThis.document,announce=false){
 const dark=document.documentElement.dataset.theme==='dark',button=document.querySelector('#theme-toggle');if(!button)return;
 button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',`目前為${dark?'深色':'淺色'}主題，切換至${dark?'淺色':'深色'}主題`);button.title=`切換至${dark?'淺色':'深色'}主題`;
 button.querySelector('[data-theme-icon]').textContent=dark?'☾':'☀';button.querySelector('[data-theme-label]').textContent=dark?'深色':'淺色';
 if(announce)document.querySelector('#theme-status').textContent=`已切換為${dark?'深色':'淺色'}主題`;
}
export function bindThemeControl(document=globalThis.document){
 const button=document.querySelector('#theme-toggle');if(button)button.onclick=()=>{applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark',{document});updateThemeControl(document,true);};
}
export function installThemeSync(window=globalThis.window){
 const media=window.matchMedia?.('(prefers-color-scheme: dark)');
 const refresh=()=>{applyTheme(readTheme(window.localStorage,media),{document:window.document,persist:false});updateThemeControl(window.document);};
 window.addEventListener('storage',event=>{if(event.key===THEME_KEY||event.key===null)refresh();});
 media?.addEventListener?.('change',()=>{let saved;try{saved=window.localStorage.getItem(THEME_KEY);}catch{}if(saved!=='light'&&saved!=='dark')refresh();});
 refresh();
}
