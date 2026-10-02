"""Backfill a completed calendar month plus the preceding trading-day baseline."""
import datetime,os,re,time
from collect import api,TW
from ranking import fetch,normalize,historical_quotes,trading_dates

def target_month(value,today):
 if not re.fullmatch(r'\d{4}-\d{2}',value):raise ValueError('Month must be YYYY-MM')
 month=datetime.date.fromisoformat(value+'-01')
 if month>=today.replace(day=1):raise ValueError('Choose a completed month')
 if month<today.replace(day=1)-datetime.timedelta(days=62):raise ValueError('Choose one of the preceding two months (60-session retention)')
 return month

def main():
 today=datetime.datetime.now(TW).date();default=(today.replace(day=1)-datetime.timedelta(days=1)).strftime('%Y-%m');month=target_month(os.environ.get('BACKFILL_MONTH') or default,today)
 # Wait for the automatically deployed Worker update before importing.
 for attempt in range(30):
  try:existing=set(api('/admin/ranking-dates')['dates']);break
  except Exception:
   if attempt==29:raise
   print('Waiting for ranking backend deployment',attempt+1,flush=True);time.sleep(10)
 dates=trading_dates(month);previous=trading_dates(month-datetime.timedelta(days=1));plan=[previous[-1]]+dates;prior={dates[0]:previous[-1],previous[-1]:previous[-2]}
 prior.update({date:plan[i-1] for i,date in enumerate(plan) if i>0})
 tc=fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');oc=fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O');failed=[];done=[]
 for date in plan:
  if date in existing:print('Already saved',date,flush=True);done.append(date);continue
  for attempt in range(3):
   try:
    rows=normalize(historical_quotes(date,'上市'),tc,'上市')+normalize(historical_quotes(date,'上櫃'),oc,'上櫃');rows.sort(key=lambda r:(-r['amount'],r['code']))
    api('/admin/ranking',{'date':date,'previousDate':prior[date],'stocks':rows});done.append(date);print('Backfilled',date,len(rows),'top ten',','.join(r['code'] for r in rows[:10]),flush=True);break
   except Exception as e:
    print('Backfill attempt failed',date,attempt+1,type(e).__name__,flush=True)
    if attempt==2:failed.append(date)
    else:time.sleep(5*(attempt+1))
  time.sleep(2)
 print('Backfill result',month.strftime('%Y-%m'),'expected',len(plan),'saved',len(done),'failed',','.join(failed) or 'none',flush=True)
 if failed:raise SystemExit('Incomplete backfill: '+','.join(failed))
if __name__=='__main__':main()
