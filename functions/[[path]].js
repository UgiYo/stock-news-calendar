import worker from '../worker/index.js';

/** Route API requests on the Cloudflare Pages API project through the shared module Worker. */
export async function onRequest({request,env}){
 return worker.fetch(request,env);
}
