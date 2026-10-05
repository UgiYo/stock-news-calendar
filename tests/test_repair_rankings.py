import os,sys,unittest
from unittest.mock import patch, Mock
os.environ.setdefault('WORKER_API_URL','https://example.com')
os.environ.setdefault('COLLECTOR_SECRET','test')
sys.path.insert(0,'scripts')
with patch.dict(sys.modules,{'collect':Mock()}):
    import repair_rankings as m

class RepairTests(unittest.TestCase):
    def test_missing_baseline_and_wrong_link_are_repaired(self):
        saved={'2026-10-02':{'date':'2026-10-02','previousDate':'2026-09-30'}}
        writes=[]
        def api(path,body=None):
            if body is None:return {'snapshots':list(saved.values())}
            writes.append((path,body));saved[body['date']]=body
            return {'ok':True}
        with patch.object(m,'api',side_effect=api),patch.object(m,'trading_dates',return_value=['2026-09-30','2026-10-01','2026-10-02']),patch.object(m,'fetch',return_value=[]),patch.object(m,'historical_quotes',return_value=[]),patch.object(m,'normalize',return_value=[]):
            m.repair()
        self.assertEqual(saved['2026-10-02']['previousDate'],'2026-10-01')
        self.assertEqual(saved['2026-10-01']['previousDate'],'2026-09-30')
        self.assertEqual([p for p,b in writes],['/admin/ranking','/admin/ranking-link'])

if __name__=='__main__':unittest.main()
