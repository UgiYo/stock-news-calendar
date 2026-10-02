"""Official TWSE monthly prices; shared daily bars, no user duplication."""
import datetime,time
import requests
from collect import api,TW

def number(value):
 try:return float(str(value).replace(',',''))
 except ValueError:return None

def roc_date(value):
 y,m,d=map(int,value.split('/'));return datetime.date(y+1911,m,d).isoformat()

def fetch_month(code,date):
 index=code=='TAIEX'
 endpoint='indicesReport/MI_5MINS_HIST' if index else 'exchangeReport/STOCK_DAY'
 r=requests.get('https://www.twse.com.tw/'+endpoint,params={'response':'json','date':date.strftime('%Y%m01'),'stockNo':code},headers={'User-Agent':'StockNewsCalendar/3.0'},timeout=40)
 r.raise_for_status();data=r.json()
 if data.get('stat')!='OK':raise ValueError('TWSE returned no usable monthly data')
 rows=[]
 for row in data.get('data',[]):
  o,h,l,c=(map(number,row[1:5]) if index else map(number,row[3:7]))
  if c and c>0:rows.append({'code':code,'date':roc_date(row[0]),'open':o,'high':h,'low':l,'close':c,'volume':None if index else number(row[1])})
 return rows

def main():
 now=datetime.datetime.now(TW).date();companies=api('/admin/tracked')['companies']
 codes=['TAIEX']+[c['code'] for c in companies if c['market']=='上市'];failed=[]
 for code in codes:
  try:
   saved=0
   # Five months provide both the baseline and 20-session follow-up.
   for offset in range(4,-1,-1):
    m=now.year*12+now.month-1-offset;date=datetime.date(m//12,m%12+1,1)
    if date>now:continue
    rows=fetch_month(code,date)
    for i in range(0,len(rows),20):api('/admin/prices',{'prices':rows[i:i+20]})
    saved+=len(rows);time.sleep(1)
   print('Market prices',code,saved,flush=True)
  except Exception as e:failed.append(code);print('Market prices failed',code,type(e).__name__,flush=True)
 if failed:raise SystemExit('Price update incomplete: '+','.join(failed))
if __name__=='__main__':main()
