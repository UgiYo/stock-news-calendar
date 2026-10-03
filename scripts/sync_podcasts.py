"""Publish bounded RSS metadata; never fetch audio, transcripts or use AI keys."""
import datetime,json,urllib.parse,urllib.request,xml.etree.ElementTree as ET,email.utils,re,pathlib
FEED='https://feeds.soundon.fm/podcasts/91be014b-9f55-4bf3-a910-b232eda82d11.xml'
SPOTIFY='https://open.spotify.com/show/6cMUsVRnTCrCqo4rs8LBjQ'
CHANNELS=[{'id':'zhaohua','title':'兆華與股惑仔','feed':FEED,'spotify':SPOTIFY},{'id':'gooaye','title':'Gooaye 股癌','feed':'https://feeds.soundon.fm/podcasts/954689a5-3096-43a4-a80b-7810b219cef3.xml','spotify':'https://open.spotify.com/show/1zWxx5pKk0XBEzMupVC7UZ'}]
TW=datetime.timezone(datetime.timedelta(hours=8))
def clean(value):
 import html
 return html.unescape(re.sub('<[^>]+>',' ',value or '')).strip()
def parse_feed(raw,now=None,source=None):
 source=source or CHANNELS[0]
 now=now or datetime.datetime.now(datetime.timezone.utc);start=now-datetime.timedelta(days=100)
 root=ET.fromstring(raw);channel=root.find('channel')
 if channel is None:raise ValueError('Invalid podcast RSS')
 rows={}
 for item in channel.findall('item'):
  try:published=email.utils.parsedate_to_datetime(item.findtext('pubDate')).astimezone(datetime.timezone.utc)
  except (ValueError,TypeError,AttributeError):continue
  if not start<=published<=now:continue
  enclosure=item.find('enclosure');audio=enclosure.get('url','') if enclosure is not None else ''
  if not audio.startswith('https://'):audio=''
  transcript=item.find('{https://podcastindex.org/namespace/1.0}transcript')
  transcript_url=transcript.get('url','') if transcript is not None else ''
  if not transcript_url.startswith('https://'):transcript_url=''
  uid=item.findtext('guid') or audio or item.findtext('link')
  if not uid:continue
  link=item.findtext('link') or source['spotify']
  if not link.startswith('https://'):link=source['spotify']
  rows[uid]={'id':uid,'title':clean(item.findtext('title')),'published_at':published.isoformat(),'date':published.astimezone(TW).date().isoformat(),'url':link,'audio_url':audio,'description':clean(item.findtext('description'))[:10000],'duration':item.findtext('{http://www.itunes.com/dtds/podcast-1.0.dtd}duration') or '', 'transcript_url':transcript_url}
 return {'id':source['id'],'title':clean(channel.findtext('title')) or source['title'],'spotify':source['spotify'],'feed':source['feed'],'updated_at':now.isoformat(),'episodes':sorted(rows.values(),key=lambda n:n['published_at'],reverse=True)[:150]}
def sync_source(source):
 request=urllib.request.Request(source['feed'],headers={'User-Agent':'Mozilla/5.0','Accept':'application/rss+xml,application/xml'})
 with urllib.request.urlopen(request,timeout=45) as response:
  raw=response.read(12000001)
  if len(raw)>12000000:raise ValueError('RSS too large')
 data=parse_feed(raw,source=source)
 if not data['episodes']:raise ValueError('RSS returned no recent episodes; keeping existing data')
 path=pathlib.Path('public/data/podcasts')/(source['id']+'.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 try:
  request=urllib.request.Request(data['episodes'][0]['audio_url'],method='HEAD',headers={'User-Agent':'Mozilla/5.0','Origin':'https://ugiyo.github.io'})
  with urllib.request.urlopen(request,timeout=20) as audio:
   print(json.dumps({'audio_status':audio.status,'audio_bytes':audio.headers.get('Content-Length'),'cors':audio.headers.get('Access-Control-Allow-Origin'),'final_audio_host':urllib.parse.urlparse(audio.url).hostname}))
 except Exception as error:print('Audio HEAD unavailable:',type(error).__name__)
 print(json.dumps({'channel':source['id'],'earliest_date':data['episodes'][-1]['date'],'counts_by_month':{month:sum(e['date'].startswith(month) for e in data['episodes']) for month in sorted({e['date'][:7] for e in data['episodes']})},'episodes':len(data['episodes']),'latest_date':data['episodes'][0]['date'],'audio_host':urllib.parse.urlparse(data['episodes'][0]['audio_url']).hostname,'transcripts':sum(bool(n['transcript_url']) for n in data['episodes'])},ensure_ascii=False))
def main():
 errors=[]
 for source in CHANNELS:
  try:sync_source(source)
  except Exception as error:
   print(source['id']+' import failed: '+str(error));errors.append(source['id'])
 if errors:raise RuntimeError('Failed podcast channels: '+','.join(errors))
if __name__=='__main__':main()
