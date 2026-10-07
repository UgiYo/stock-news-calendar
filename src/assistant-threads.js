const prefix='stock-site-assistant-threads-v1:';
export function readAssistantThreads(owner,storage=globalThis.localStorage){try{const rows=JSON.parse(storage?.getItem(prefix+owner)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&typeof r.id==='string'&&Array.isArray(r.turns)):[];}catch{return [];}}
export function saveAssistantThreads(owner,threads,storage=globalThis.localStorage){storage.setItem(prefix+owner,JSON.stringify(threads));}
