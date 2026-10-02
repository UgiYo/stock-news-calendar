export function createMonthCache({ttl=120000,limit=8,now=Date.now}={}){
 const entries=new Map();
 return {clear(){entries.clear();},get(key){const item=entries.get(key);if(!item)return undefined;if(now()-item.time>=ttl){entries.delete(key);return undefined;}entries.delete(key);entries.set(key,item);return item.value;},set(key,value){entries.delete(key);entries.set(key,{time:now(),value});while(entries.size>limit)entries.delete(entries.keys().next().value);}};
}
