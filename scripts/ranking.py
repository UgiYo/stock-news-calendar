"""Daily common-stock turnover ranking, aligned TWSE/TPEx dates."""
import datetime,json,re,time,urllib.request,math
from collect import api
INDUSTRIES={'01':'水泥','02':'食品','03':'塑膠','04':'紡織纖維','05':'電機機械','06':'電器電纜','08':'玻璃陶瓷','09':'造紙','10':'鋼鐵','11':'橡膠','12':'汽車','14':'建材營造','15':'航運','16':'觀光餐旅','17':'金融保險','18':'貿易百貨','19':'綜合','20':'其他','21':'化學','22':'生技醫療','23':'油電燃氣','24':'半導體','25':'電腦及週邊設備','26':'光電','27':'通信網路','28':'電子零組件','29':'電子通路','30':'資訊服務','31':'其他電子','32':'文化創意','33':'農業科技','34':'電子商務','35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活'}
def fetch(url):
 for attempt in range(3):
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'StockNewsCalendar/3.0'}),timeout=40) as r:return json.load(r)
  except Exception:
   if attempt==2:raise
   time.sleep(2*(attempt+1))
def iso_date(value):
 text=re.sub(r'\D','',str(value));y=int(text[:-4]);return datetime.date(y+1911 if y<1911 else y,int(text[-4:-2]),int(text[-2:])).isoformat()
def normalize(quotes,catalog,market):
 lookup={str(r.get('公司代號',r.get('SecuritiesCompanyCode',''))):r for r in catalog};rows=[]
 for r in quotes:
  code=str(r.get('Code',r.get('SecuritiesCompanyCode','')))
  if not re.fullmatch(r'[1-9]\d{3}',code) or code not in lookup:continue
  c=lookup[code];industry=str(c.get('產業別',c.get('SecuritiesIndustryCode',''))).strip().zfill(2)
  amount=float(str(r.get('TradeValue',r.get('TransactionAmount',0))).replace(',',''))
  if amount<0:raise ValueError('Negative turnover')
  def numeric(value):
   try:return float(str(value).replace(',',''))
   except (ValueError,TypeError):return None
  close=numeric(r.get('ClosingPrice',r.get('Close')))
  shares=numeric(c.get('已發行普通股數或TDR原股發行股數',c.get('IssueShares',r.get('Capitals'))))
  market_cap=close*shares if close and shares and math.isfinite(close) and math.isfinite(shares) and close>0 and shares>0 else None
  rows.append({'code':code,'name':c.get('公司簡稱',c.get('CompanyAbbreviation','')),'market':market,'tag':INDUSTRIES.get(industry,'產業 '+industry),'amount':amount,'marketCap':market_cap})
 if len(rows)<100:raise ValueError('Incomplete market quote data')
 return rows

def main():
 tq=fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');oq=fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes')
 tc=fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');oc=fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O')
 td={iso_date(r['Date']) for r in tq};od={iso_date(r['Date']) for r in oq}
 if len(td)!=1 or len(od)!=1:raise ValueError('Mixed dates from official source')
 date=next(iter(od))
 if td!=od:
  # TWSE OpenAPI can lag the official after-trading monthly site.
  result=fetch('https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALLBUT0999&date='+date.replace('-',''))
  if result.get('stat')!='OK' or iso_date(result.get('date',''))!=date:raise ValueError('Markets not aligned; preserving previous ranking')
  table=next((t for t in result.get('tables',[]) if '證券代號' in t.get('fields',[]) and '成交金額' in t.get('fields',[])),None)
  if not table:raise ValueError('Missing TWSE turnover table')
  tq=[{'Code':dict(zip(table['fields'],row))['證券代號'],'TradeValue':dict(zip(table['fields'],row))['成交金額'],'ClosingPrice':dict(zip(table['fields'],row)).get('收盤價')} for row in table['data']]
 rows=normalize(tq,tc,'上市')+normalize(oq,oc,'上櫃');rows.sort(key=lambda r:(-r['amount'],r['code']))
 # Use the official index trading calendar, never infer yesterday from a saved snapshot.
 from market_prices import fetch_month
 d=datetime.date.fromisoformat(date);days=fetch_month('TAIEX',d)
 previous=[r['date'] for r in days if r['date']<date]
 if not previous:
  days=fetch_month('TAIEX',d.replace(day=1)-datetime.timedelta(days=1));previous=[r['date'] for r in days if r['date']<date]
 if not previous:raise ValueError('Cannot establish previous trading date')
 api('/admin/ranking',{'date':date,'previousDate':max(previous),'stocks':rows});print('Market caps',sum(r.get('marketCap') is not None for r in rows),'of',len(rows),flush=True);print('Turnover ranking',date,len(rows),'top ten',','.join(r['code'] for r in rows[:10]),flush=True)
if __name__=='__main__':main()

def historical_quotes(date,market):
 if market=='上市':
  result=fetch('https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALLBUT0999&date='+date.replace('-',''))
  code_field,amount_field='證券代號','成交金額'
 else:
  result=fetch('https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?response=json&id=&date='+date.replace('-','%2F'))
  code_field,amount_field='代號','成交金額(元)'
 if iso_date(result.get('date',''))!=date:raise ValueError('Historical source date mismatch')
 table=next((t for t in result.get('tables',[]) if code_field in t.get('fields',[]) and amount_field in t.get('fields',[])),None)
 if not table or not table.get('data'):raise ValueError('Missing historical turnover table')
 return [{'Code':dict(zip(table['fields'],row))[code_field],'TradeValue':dict(zip(table['fields'],row))[amount_field]} for row in table['data']]

def trading_dates(month):
 result=fetch('https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=json&date='+month.strftime('%Y%m01'))
 if result.get('stat')!='OK':raise ValueError('Missing official trading calendar')
 dates=sorted({iso_date(row[0]) for row in result.get('data',[])})
 if not dates or any(d[:7]!=month.strftime('%Y-%m') for d in dates):raise ValueError('Invalid trading calendar')
 return dates
