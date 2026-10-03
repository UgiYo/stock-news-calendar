// Resolve publisher URLs in GitHub Actions; no article bodies or AI keys are stored.
import {resolveArticleURL,readArticleURL} from '../worker/index.js';
const base=process.env.WORKER_API_URL?.replace(/\/$/,'');
const secret=process.env.COLLECTOR_SECRET;
if(!base||!secret)throw Error('Missing collector configuration');
async function api(path,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});const data=await response.json();if(!response.ok)throw Error(data.error||'HTTP '+response.status);return data;}
let failures=0,resolved=0;
const {news}=await api('/admin/article-links');
for(const n of news){try{
 const url=await resolveArticleURL(n.url);
 // Verify a real article body before retaining its original URL.
 const article=await readArticleURL(url);
 await api('/admin/article-links',{id:n.id,url:article.url});
 const check=await api('/admin/article-probe',{url:article.url});
 console.log(JSON.stringify({id:n.id,title:n.title,ok:true,url:article.url,characters:check.characters}));resolved++;
}catch(e){failures++;console.log(JSON.stringify({id:n.id,title:n.title,ok:false,error:e.message}));}}
console.log(JSON.stringify({resolved,failures,total:news.length}));
// A blocked publisher must not prevent other links from being repaired.
