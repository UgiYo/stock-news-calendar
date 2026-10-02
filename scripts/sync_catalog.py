"""Sync official listed/OTC companies; never remove historical companies/news."""
import json,os,urllib.request
BASE=os.environ['SUPABASE_URL'].rstrip('/')
KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
def request(url,body=None):
 data=None if body is None else json.dumps(body,ensure_ascii=False).encode()
 headers={'User-Agent':'StockNewsCalendar/1.0'}
 if url.startswith(BASE):headers.update({'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'})
 with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers),timeout=60) as r:return json.loads(r.read()) if body is None else None
sources=[('https://openapi.twse.com.tw/v1/opendata/t187ap03_L','上市'),('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','上櫃')]
for url,market in sources:
 rows=request(url)
 companies=[{'code':str(r['公司代號']).strip(),'name':r['公司簡稱'].strip(),'full_name':r['公司名稱'].strip(),'market':market} for r in rows]
 if len(companies)<100:raise RuntimeError('公司名錄回應異常，停止更新')
 for i in range(0,len(companies),200):request(BASE+'/rest/v1/companies?on_conflict=code',companies[i:i+200])
 print(market,len(companies))
