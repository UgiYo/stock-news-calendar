import sys,unittest
from unittest.mock import Mock,patch
sys.path.insert(0,'scripts')
with patch.dict(sys.modules,{'collect':Mock()}):
 import ranking
class MarketCapsTests(unittest.TestCase):
 def test_market_cap_uses_actual_issue_shares_not_assumed_par_value(self):
  catalog=[{'公司代號':str(1000+i),'公司簡稱':'公司','產業別':'28','已發行普通股數或TDR原股發行股數':'2,000','實收資本額':'999999'} for i in range(101)]
  quotes=[{'Code':str(1000+i),'TradeValue':'100','ClosingPrice':'3.5'} for i in range(101)]
  self.assertEqual(ranking.normalize(quotes,catalog,'上市')[0]['marketCap'],7000)
 def test_missing_close_does_not_fabricate_market_cap(self):
  catalog=[{'SecuritiesCompanyCode':str(1000+i),'CompanyAbbreviation':'公司','SecuritiesIndustryCode':'28','IssueShares':'2000'} for i in range(101)]
  quotes=[{'SecuritiesCompanyCode':str(1000+i),'TransactionAmount':'100','Close':'--'} for i in range(101)]
  self.assertIsNone(ranking.normalize(quotes,catalog,'上櫃')[0]['marketCap'])
if __name__=='__main__':unittest.main()
