const initialized=new WeakMap();
export async function ensureD1Index(db,name,statement){let rows=initialized.get(db);if(!rows){rows=new Map();initialized.set(db,rows);}if(!rows.has(name)){const promise=db.prepare(statement).bind().run().catch(error=>{rows.delete(name);throw error;});rows.set(name,promise);}await rows.get(name);}
export function d1QuotaError(error,now=Date.now()){
 const message=String(error?.message||error);const kind=/daily (?:row |rows )?(?:read|reading) limit|daily.*(?:rows? read|read.*quota)/i.test(message)?'read':/daily (?:row |rows )?(?:write|written) limit|daily.*(?:rows? writ|write.*quota)/i.test(message)?'write':null;
 if(!kind)return null;const reset=Math.floor(now/86400000)*86400000+86400000;
 return {error:`D1 每日${kind==='read'?'讀取':'寫入'}配額已用完；台灣時間早上 8 點重置。資料仍保留，請於重置後再試。`,code:kind==='read'?'D1_READ_QUOTA':'D1_WRITE_QUOTA',reset_at:new Date(reset).toISOString(),retry_after:Math.ceil((reset-now)/1000)};
}
