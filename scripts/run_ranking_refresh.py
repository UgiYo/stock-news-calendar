"""Run the shared turnover update and report its result to the website."""
import os
from collect import api
from ranking import main

def run():
    request_id=os.environ.get('RANKING_REFRESH_ID','')
    def report(status,**fields):
        if request_id:
            api('/admin/ranking-refresh',{'id':request_id,'status':status,**fields})
    report('running')
    try:
        date=main()
    except Exception as error:
        report('failed',error='官方成交資料更新失敗，請稍後重試。')
        raise
    report('done',data_date=date)

if __name__=='__main__':
    run()
