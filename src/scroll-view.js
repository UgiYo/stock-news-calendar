const rowKey=node=>node?.closest?.('[data-result],[data-notification-id]')?.getAttribute('data-result')||node?.closest?.('[data-notification-id]')?.getAttribute('data-notification-id')||'';
const detailLabel=node=>(node.querySelector('summary')?.textContent||'').replace(/\d+/g,'#');
const rows=container=>[...container.querySelectorAll('[data-result],[data-notification-id]')];
export function captureScrollView(container){
 const top=container.scrollTop||0,left=container.scrollLeft||0,rect=container.getBoundingClientRect?.();
 const anchor=rect&&rows(container).find(node=>{const r=node.getBoundingClientRect();return r.bottom>rect.top&&r.top<rect.bottom;});
 const details=[...container.querySelectorAll('details')].map(node=>({key:rowKey(node),label:detailLabel(node),open:node.open}));
 const active=container.contains(container.ownerDocument.activeElement)?container.ownerDocument.activeElement:null;
 return {top,left,anchor:anchor?{key:rowKey(anchor),offset:anchor.getBoundingClientRect().top-rect.top}:null,details,focus:active?{key:rowKey(active),id:active.id,tag:active.tagName,attrs:[...active.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])}:null};
}
export function restoreScrollView(container,view){
 if(!view)return;
 for(const node of container.querySelectorAll('details')){const key=rowKey(node),label=detailLabel(node),saved=view.details.find(d=>d.key===key&&d.label===label);if(saved)node.open=saved.open;}
 const f=view.focus;if(f){const target=[...container.querySelectorAll('button,input,textarea,select,a')].find(node=>rowKey(node)===f.key&&(f.id?node.id===f.id:node.tagName===f.tag&&f.attrs.length&&f.attrs.every(([name,value])=>node.getAttribute(name)===value)));target?.focus({preventScroll:true});}
 container.scrollTop=view.top;container.scrollLeft=view.left;
 const anchor=view.anchor&&rows(container).find(node=>rowKey(node)===view.anchor.key);
 if(anchor)container.scrollTop+=anchor.getBoundingClientRect().top-container.getBoundingClientRect().top-view.anchor.offset;
}
export function scrollWithin(container,node){if(node){const target=node.getBoundingClientRect?.(),rect=container.getBoundingClientRect?.();container.scrollTop+=target&&rect?target.top-rect.top:node.offsetTop||0;}}
export function capturePageScroll(){return {left:globalThis.window?.scrollX||0,top:globalThis.window?.scrollY||0};}
export function restorePageScroll(view){if(view&&globalThis.window?.scrollTo&&(window.scrollX!==view.left||window.scrollY!==view.top))window.scrollTo({left:view.left,top:view.top,behavior:'instant'});}
