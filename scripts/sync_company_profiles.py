"""Collect public company facts from a non-edge runtime; Worker validates identity."""
import csv,io,json,os,re,sys,time
from urllib.parse import urlparse
import requests
from collect import api

def official_profiles(codes):
    from sync_catalog import SOURCES
    facts={}
    for primary,fallback,market in SOURCES:
        try:
            try:
                r=requests.get(primary,timeout=12);r.raise_for_status();rows=r.json()
                if not isinstance(rows,list):raise ValueError('Invalid catalog')
            except Exception:
                r=requests.get(fallback,timeout=12);r.raise_for_status();r.encoding='utf-8-sig';rows=list(csv.DictReader(io.StringIO(r.text)))
            for row in rows:
                def get(*keys):return next((str(row[k]).strip() for k in keys if row.get(k) is not None),'')
                code=get('公司代號','SecuritiesCompanyCode','CompanyCode')
                if not re.fullmatch(r'[1-9]\d{3}',code):continue
                name=get('公司簡稱','CompanyAbbreviation');full=get('公司名稱','CompanyName')
                business=get('主要經營業務','PrincipalActivities','MainBusiness')
                metrics=[]
                for label,keys in [('實收資本額（元）',('實收資本額','PaidinCapital')),('已發行普通股數（股）',('已發行普通股數或TDR原股發行股數','IssueShares'))]:
                    value=get(*keys).replace(',','')
                    if re.fullmatch(r'\d+(?:\.\d+)?',value):metrics.append({'label':label,'value':value})
                facts[code]={'name':name,'full_name':full,'introduction':business or full+'；交易所產業代碼 '+get('產業別','SecuritiesIndustryCode'),'metrics':metrics}
            if all(code in facts for code in codes):break
        except Exception as e:print('Official catalog failed',market,type(e).__name__,flush=True)
    return facts

def main():
    for attempt in range(30):
        try:
            queued=api('/admin/company-profiles')['codes']
            break
        except requests.RequestException:
            if attempt==29:raise
            time.sleep(5)
    try:print('Edge source diagnostic',api('/admin/company-profile-probe?code=2330'),flush=True)
    except requests.RequestException:print('Edge diagnostic unavailable; continuing collection',flush=True)
    daily=[c['code'] for c in api('/admin/chart-codes')['companies']] if os.environ.get('PROFILE_MODE')=='schedule' else []
    codes=list(dict.fromkeys(['2330','3026']+queued+daily))[:100]
    failed=[]
    official=official_profiles(codes)
    for code in codes:
        try:
            target='https://statementdog.com/analysis/'+code
            for _ in range(3):
                response=requests.get(target,headers={'User-Agent':'Mozilla/5.0','Accept':'text/html'},timeout=25,allow_redirects=False)
                if response.status_code not in [301,302,303,307,308]:break
                from urllib.parse import urljoin
                target=urljoin(target,response.headers.get('Location',''))
                parsed=urlparse(target)
                if parsed.scheme!='https' or parsed.hostname not in ['statementdog.com','www.statementdog.com'] or parsed.username or parsed.password or parsed.port:raise ValueError('Invalid source redirect')
            response.raise_for_status()
            response.encoding='utf-8'
            if len(response.content)>2000000:raise ValueError('Page too large')
            html=response.text
            if response.status_code==202 or '<h1' not in html:raise ValueError('Source intermediate page')
            result=api('/admin/company-profiles',{'code':code,'html':html})
            print('Verified profile',code,'metrics',result['metrics'],flush=True)
        except Exception as e:
            if code in official:
                try:
                    result=api('/admin/company-profiles',{'code':code,'official':official[code]})
                    print('Verified official fallback',code,'metrics',result['metrics'],flush=True)
                    continue
                except Exception as fallback_error:print('Official upload failed',code,type(fallback_error).__name__,flush=True)
            failed.append(code)
            api('/admin/company-profiles',{'code':code,'error':'Public source collection failed: '+type(e).__name__})
            print('Profile failed',code,type(e).__name__,getattr(getattr(e,'response',None),'status_code',None),flush=True)
    if any(c in failed for c in queued+['2330','3026']):raise SystemExit('Requested profiles failed: '+','.join(failed))
if __name__=='__main__':main()
