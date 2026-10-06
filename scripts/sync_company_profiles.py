"""Collect public company facts from a non-edge runtime; Worker validates identity."""
import sys,time
from urllib.parse import urlparse
import requests
from collect import api

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
    codes=list(dict.fromkeys(['2330','3026']+queued+ [c['code'] for c in api('/admin/chart-codes')['companies']]))[:100]
    failed=[]
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
            result=api('/admin/company-profiles',{'code':code,'html':response.text})
            print('Verified profile',code,'metrics',result['metrics'],flush=True)
        except Exception as e:
            failed.append(code)
            api('/admin/company-profiles',{'code':code,'error':'Public source collection failed: '+type(e).__name__})
            print('Profile failed',code,type(e).__name__,flush=True)
    if any(c in failed for c in queued+['2330','3026']):raise SystemExit('Requested profiles failed: '+','.join(failed))
if __name__=='__main__':main()
