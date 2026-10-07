const brokers=[['摩根士丹利',['摩根士丹利','摩根史丹利','大摩']],['摩根大通',['摩根大通','小摩']],['高盛',['高盛']],['瑞銀',['瑞銀','UBS']],['美銀',['美銀','美國銀行']],['花旗',['花旗']],['野村',['野村']],['麥格理',['麥格理']],['里昂',['里昂']],['匯豐',['匯豐']],['元大投顧',['元大投顧','元大證券']],['凱基投顧',['凱基投顧','凱基證券']],['群益投顧',['群益投顧','群益證券']],['國泰投顧',['國泰投顧','國泰證券']],['富邦投顧',['富邦投顧','富邦證券']],['中信投顧',['中信投顧','中信證券']],['永豐金投顧',['永豐金投顧','永豐投顧','永豐金證券']],['統一投顧',['統一投顧','統一證券']],['兆豐投顧',['兆豐投顧','兆豐證券']],['台新投顧',['台新投顧','台新證券']]];
export function brokerReports(news=[]){
 const reports=[],seen=new Set();
 for(const n of news){const text=[n.title,n.article_summary||''].join('\n').normalize('NFKC'),segments=text.split(/[。\n；;]/).filter(Boolean);
 for(const segment of segments){
 if(!/目標價|目標價格|合理價|評等|評級|買進|買入|優於大盤|報告|投顧/.test(segment))continue;
 const names=brokers.filter(([,aliases])=>aliases.some(a=>segment.toLowerCase().includes(a.toLowerCase()))).map(([name])=>name);
 if(!names.length&&!/外資|券商|投顧/.test(segment))continue;
 const price=segment.match(/(?:目標價(?:格)?|合理價)(?:由|從)\s*([\d,]+(?:\.\d+)?)\s*元?\s*(?:調高|上調|調升|提高|調降|下調|降至|升至|調整|至|到)[^\d]{0,10}([\d,]+(?:\.\d+)?)\s*(美元|港元|元)?/);
 const single=segment.match(/(?:目標价|目標價(?:格)?|合理價)(?:維持|調高|上調|調升|提高|調降|下調|調整|上看|升至|至|為|到|在|達|看好|給予|：|:|\s){0,10}\s*([\d,]+(?:\.\d+)?)\s*(美元|港元|元)?/);
 const currencies=price?.[3]||single?.[2]||'';
 const ambiguous=names.length>1;
 const target=ambiguous?null:price?Number(price[2].replaceAll(',','')):single?Number(single[1].replaceAll(',','')):null;
 const previous=ambiguous?null:price?Number(price[1].replaceAll(',','')):null;
 const rating=segment.match(/(?:評等|評級|評價|維持|給予|重申|調升至|調降至)[「『"“\s：:]*(買進|買入|增持|優於大盤|優於市場|中立|持有|減持|賣出|劣於大盤)/)?.[1]||'未明示';
 for(const broker of names.length?names:['未具名外資／券商']){
 const key=[n.company_code,n.news_date,n.url,broker,target].join(':');if(seen.has(key))continue;seen.add(key);
 reports.push({code:n.company_code,broker,target:target>0?target:null,previous:previous>0?previous:null,currency:currencies,rating,date:n.news_date||String(n.published_at||'').slice(0,10),url:n.article_url||n.url,title:n.title,evidence:segment.trim(),basis:'新聞轉述',note:ambiguous?'同段有多家券商，目標價歸屬待確認':target&&!currencies?'原文未明示幣別':'',reportDate:'未明示（以下為新聞日期）'});
 }
 }
 }
 return reports.sort((a,b)=>b.date.localeCompare(a.date));
}
