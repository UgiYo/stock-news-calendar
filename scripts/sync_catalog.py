"""Normalize TWSE Chinese and TPEx English company fields before D1 upload."""
import csv,io,json,os,re,time,urllib.request
SOURCES=[('https://openapi.twse.com.tw/v1/opendata/t187ap03_L','https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv','上市'),('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O','https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv','上櫃')]
def normalize(rows,market):
 if not isinstance(rows,list) or not rows:raise ValueError('公司名錄不是有效資料陣列')
 aliases={'code':('公司代號','SecuritiesCompanyCode','CompanyCode'),'name':('公司簡稱','CompanyAbbreviation'),'full_name':('公司名稱','CompanyName')}
 companies=[]
 for row in rows:
  if not isinstance(row,dict):raise ValueError('公司名錄資料格式錯誤')
  clean={str(k).lstrip('\ufeff').strip():v for k,v in row.items()};record={'market':market}
  for field,keys in aliases.items():
   value=next((str(clean[k]).strip() for k in keys if clean.get(k) is not None and str(clean[k]).strip()),None)
   if value is None:raise ValueError(f'{market}公司名錄缺少 {field}，收到欄位：'+','.join(clean.keys()))
   record[field]=value
  # Only ordinary company numeric codes supported by this application.
  if re.fullmatch(r'\d{4,6}',record['code']):companies.append(record)
 if len(companies)<100:raise ValueError('公司名錄筆數異常，停止更新')
 return companies

def fetch_text(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'StockNewsCalendar/2.0'}),timeout=30) as r:return r.read().decode('utf-8-sig')
  except Exception:
   if attempt==2:raise
   time.sleep(attempt+1)

def main():
 base=os.environ['WORKER_API_URL'].rstrip('/');key=os.environ['COLLECTOR_SECRET'];failed=[]
 for url,fallback,market in SOURCES:
  try:
   try:companies=normalize(json.loads(fetch_text(url)),market)
   except Exception as e:
    print(market,'JSON source failed:',type(e).__name__,'; trying official CSV')
    companies=normalize(list(csv.DictReader(io.StringIO(fetch_text(fallback)))),market)
   for i in range(0,len(companies),100):
    body=json.dumps({'companies':companies[i:i+100]},ensure_ascii=False).encode()
    req=urllib.request.Request(base+'/admin/companies',data=body,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as r:r.read()
   print(market,len(companies))
  except Exception as e:
   failed.append(market);print(market,'sync failed:',str(e))
 if failed:raise SystemExit('Failed company catalogs: '+','.join(failed))
if __name__=='__main__':main()
