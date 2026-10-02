"""Official TWSE monthly prices; shared daily bars, no user duplication."""
import datetime,time
import requests
from collect import api,TW

def number(value):
 try:return float(str(value).replace(',',''))
 except ValueError:return None

def roc_date(value):
 y,m,d=map(int,value.split('/'));return datetime.date(y+1911,m,d).isoformat()

def fetch_month(code,date,market='上市'):
 index=code=='TAIEX';otc=market=='上櫃' and not index
 url='https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock' if otc else 'https://www.twse.com.tw/'+('indicesReport/MI_5MINS_HIST' if index else 'exchangeReport/STOCK_DAY')
 params={'response':'json','date':date.strftime('%Y/%m/01'),'code':code} if otc else {'response':'json','date':date.strftime('%Y%m01'),'stockNo':code}
 for attempt in range(3):
  try:
   r=requests.get(url,params=params,headers={'User-Agent':'StockNewsCalendar/3.0'},timeout=40);r.raise_for_status();data=r.json();break
  except (requests.RequestException,ValueError):
   if attempt==2:raise
   time.sleep(2*(attempt+1))
 if otc:
  tables=data.get('tables',[])
  if not tables:raise ValueError('Missing TPEx monthly table')
  records=tables[0].get('data',[])
 else:
  if data.get('stat')!='OK':
   if '沒有符合條件' in str(data.get('stat','')):return []
   raise ValueError('TWSE returned no usable monthly data')
  records=data.get('data',[])
 rows=[]
 for row in records:
  o,h,l,c=(map(number,row[1:5]) if index else map(number,row[3:7]))
  date_key=roc_date(row[0])
  if date_key[:7]!=date.strftime('%Y-%m'):raise ValueError('Price month mismatch')
  if all(v is not None and v>0 for v in (o,h,l,c)) and l<=min(o,c)<=max(o,c)<=h:
   volume=None if index else number(row[1])
   if otc and volume is not None:volume*=1000 # TPEx monthly table: thousand shares.
   rows.append({'code':code,'date':date_key,'open':o,'high':h,'low':l,'close':c,'volume':volume})
 return rows

def main():
 from concurrent.futures import ThreadPoolExecutor
 now=datetime.datetime.now(TW).date();companies=api('/admin/chart-codes')['companies'];failed=[]
 companies=[{'code':'TAIEX','market':'上市'}]+companies
 def update(c):
  code=c['code'];saved=0
  try:
   last=datetime.date.fromisoformat(c['last_price_date'])-datetime.timedelta(days=7) if c.get('last_price_date') else None
   for offset in range(5):
    m=now.year*12+now.month-1-offset;date=datetime.date(m//12,m%12+1,1)
    if last and date<last.replace(day=1):continue
    rows=fetch_month(code,date,c['market'])
    for i in range(0,len(rows),20):api('/admin/prices',{'prices':rows[i:i+20]})
    saved+=len(rows);print('Price month',code,date.strftime('%Y-%m'),len(rows),flush=True);time.sleep(1)
   if not saved:raise ValueError('No usable prices')
   print('Market prices',code,saved,flush=True);return None
  except Exception as e:print('Market prices failed',code,type(e).__name__,flush=True);return code
 with ThreadPoolExecutor(max_workers=2) as pool:failed=[code for code in pool.map(update,companies) if code]
 if failed:raise SystemExit('Price update incomplete: '+','.join(failed))
if __name__=='__main__':main()
