export function createRankingRefresher({request,reload,owner,onChange,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const state={busy:false,message:''};
 const publish=message=>{state.message=message;onChange();};
 let version=0,activeOwner;
 async function run(start){
  const who=owner();if(!who||state.busy&&activeOwner===who)return;
  const current=++version;activeOwner=who;state.busy=true;
  const valid=()=>current===version&&owner()===who;
  publish(start?'正在啟動成交值更新…':'正在確認成交值更新進度…');
  try{
   let result=await request('/ranking-refresh',start?{body:{}}:undefined);
   if(!valid())return;
   if(!result.job){state.message='';return;}
   const id=result.job.id;
   for(let i=0;i<300;i++){
    const job=result.job;
    if(job.status==='failed')throw Error(job.error||'成交值更新失敗，請重試。');
    if(job.status==='done'){
     publish('成交值已更新，正在載入排行榜…');
     await reload();if(!valid())return;
     publish(`成交值更新完成，資料日期：${job.data_date||'請見排行榜'}。`);return;
    }
    publish(job.status==='running'?'正在取得官方收盤資料並更新排行…':'成交值更新已排入，等待處理…');
    await wait(5000);if(!valid())return;
    result=await request('/ranking-refresh?id='+encodeURIComponent(id));if(!valid())return;
   }
   throw Error('更新仍在處理中，稍後返回排行榜可繼續查看進度。');
  }catch(error){if(valid())publish(error.message||'成交值更新失敗，請重試。');}
  finally{if(current===version){state.busy=false;if(owner()!==who)state.message='';onChange();}}
 }
 return {state,start:()=>run(true),resume:()=>run(false)};
}
