import unittest,datetime,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from sync_podcasts import parse_feed,CHANNELS
class FeedTest(unittest.TestCase):
 def test_shared_dates_dedup_and_no_description_as_transcript(self):
  item='<item><guid>same</guid><title>EP1</title><pubDate>Thu, 01 Oct 2026 16:05:00 GMT</pubDate><description>&lt;p&gt;show notes&lt;/p&gt;</description><enclosure url="https://rss.soundon.fm/a.mp3" type="audio/mpeg" /></item>'
  data=parse_feed(('<rss><channel><title>兆華</title>'+item+item+'<item><guid>bad</guid><pubDate>bad</pubDate></item></channel></rss>').encode(),datetime.datetime(2026,10,3,tzinfo=datetime.timezone.utc))
  self.assertEqual(len(data['episodes']),1);ep=data['episodes'][0];self.assertEqual(ep['date'],'2026-10-02');self.assertEqual(ep['description'],'show notes');self.assertEqual(ep['transcript_url'],'');self.assertNotIn('transcript',ep)
 def test_second_source_metadata(self):
  raw=b'<rss><channel><title>Gooaye</title><item><guid>ep</guid><title>EP</title><pubDate>Thu, 01 Oct 2026 16:05:00 GMT</pubDate></item></channel></rss>'
  data=parse_feed(raw,datetime.datetime(2026,10,3,tzinfo=datetime.timezone.utc),CHANNELS[1]);self.assertEqual(data['id'],'gooaye');self.assertEqual(data['episodes'][0]['url'],CHANNELS[1]['spotify']);self.assertEqual(data['feed'],CHANNELS[1]['feed'])
if __name__=='__main__' :unittest.main()
