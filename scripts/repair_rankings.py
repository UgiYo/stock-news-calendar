"""Audit saved trading-day links and repair missing official snapshots."""
import datetime
from collect import api
from ranking import fetch, normalize, historical_quotes, trading_dates

def repair():
    snapshots=api('/admin/ranking-audit')['snapshots']
    if not snapshots:
        print('No saved rankings to repair',flush=True)
        return
    saved={r['date']:r for r in snapshots}; calendars={}
    def previous(date):
        month=datetime.date.fromisoformat(date).replace(day=1)
        for _ in range(3):
            key=month.isoformat()
            if key not in calendars: calendars[key]=trading_dates(month)
            candidates=[d for d in calendars[key] if d<date]
            if candidates:return max(candidates)
            month=(month-datetime.timedelta(days=1)).replace(day=1)
        raise ValueError('No official previous trading date for '+date)
    catalogs=None
    def restore(date):
        nonlocal catalogs
        if catalogs is None:
            catalogs=(fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'),fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'))
        rows=normalize(historical_quotes(date,'上市'),catalogs[0],'上市')+normalize(historical_quotes(date,'上櫃'),catalogs[1],'上櫃')
        rows.sort(key=lambda r:(-r['amount'],r['code']))
        prior=previous(date)
        api('/admin/ranking',{'date':date,'previousDate':prior,'stocks':rows})
        saved[date]={'date':date,'previousDate':prior}
        print('Restored',date,'previousDate',prior,'stocks',len(rows),flush=True)
    # Keep within the backend retention window; do not endlessly extend its oldest baseline.
    targets=sorted(saved)[-30:]
    for date in targets:
        prior=previous(date)
        print('Audit',date,'stored',saved[date].get('previousDate'),'official',prior,'baselineSaved',prior in saved,flush=True)
        if prior not in saved:restore(prior)
        if saved[date].get('previousDate')!=prior:
            api('/admin/ranking-link',{'date':date,'previousDate':prior})
    final={r['date']:r for r in api('/admin/ranking-audit')['snapshots']}
    for date in targets:
        prior=previous(date)
        if final[date].get('previousDate')!=prior or prior not in final:raise ValueError('Verification failed for '+date)
        print('Verified',date,'compared with',prior,flush=True)

if __name__=='__main__':repair()
