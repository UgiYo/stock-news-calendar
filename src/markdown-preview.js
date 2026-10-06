import {Marked} from 'marked';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parser=new Marked({gfm:true,breaks:true,renderer:{
 html({text}){return esc(text);},
 image({text}){return esc(text);},
 link({href,tokens}){const label=this.parser.parseInline(tokens);try{const u=new URL(href);if(!['https:','http:','mailto:'].includes(u.protocol))return label;return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;}catch{return label;}}
}});
// Use the standard table renderer inside a scrollable wrapper.
import {Renderer} from 'marked';
parser.use({renderer:{table(token){return '<div class="markdown-table-scroll">'+Renderer.prototype.table.call(this,token)+'</div>';}}});
export function renderMarkdown(text){return parser.parse(String(text||''),{async:false});}
export function markdownSource(element){return element.dataset.markdown??element.textContent;}
export function showMarkdown(element,text,{decorate}={}){
 const source=String(text||'');element.dataset.markdown=source;element.classList.add('markdown-preview');
 if(!source){element.replaceChildren();if(decorate){const body=document.createElement('div');body.className='markdown-body';element.append(body);decorate(body);}return;}
 element.innerHTML='<div class="markdown-controls"><button type="button" data-md-preview aria-pressed="true">預覽</button><button type="button" data-md-source aria-pressed="false">Markdown 原文</button><button type="button" data-md-copy>複製 Markdown</button><span data-md-status role="status"></span></div><div data-md-body class="markdown-body"></div>';
 const body=element.querySelector('[data-md-body]');body.innerHTML=renderMarkdown(source);decorate?.(body);
 const mode=preview=>{element.querySelector('[data-md-preview]').setAttribute('aria-pressed',String(preview));element.querySelector('[data-md-source]').setAttribute('aria-pressed',String(!preview));if(preview){body.innerHTML=renderMarkdown(source);decorate?.(body);}else{body.replaceChildren();const pre=document.createElement('pre');pre.textContent=source;body.append(pre);}};
 element.querySelector('[data-md-preview]').onclick=()=>mode(true);element.querySelector('[data-md-source]').onclick=()=>mode(false);
 element.querySelector('[data-md-copy]').onclick=async()=>{const status=element.querySelector('[data-md-status]');try{await navigator.clipboard.writeText(source);status.textContent='已複製';}catch{mode(false);status.textContent='請選取原文並複製';}};
}
