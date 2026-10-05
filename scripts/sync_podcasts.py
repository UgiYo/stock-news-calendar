"""Publish bounded RSS metadata; never fetch audio, transcripts or use AI keys."""
import os,socket,ipaddress,datetime,json,urllib.parse,urllib.request,xml.etree.ElementTree as ET,email.utils,re,pathlib
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
 root=ET.fromstring(raw);channel=root.find('channel');atom=root.tag=='{http://www.w3.org/2005/Atom}feed'
 if atom:channel=root
 if channel is None:raise ValueError('Invalid podcast RSS')
 ns='{http://www.w3.org/2005/Atom}' if atom else ''
 def value(node,*names):
  return next((node.findtext(ns+name) for name in names if node.findtext(ns+name)), '')
 rows={}
 for item in channel.findall(ns+'entry' if atom else 'item'):
  try:
   date=value(item,'published','updated') if atom else value(item,'pubDate')
   published=(datetime.datetime.fromisoformat(date.replace('Z','+00:00')) if atom else email.utils.parsedate_to_datetime(date)).astimezone(datetime.timezone.utc)
  except (ValueError,TypeError,AttributeError):continue
  if not start<=published<=now:continue
  enclosure=next((n for n in item.findall(ns+'link') if n.get('rel')=='enclosure'),None) if atom else item.find('enclosure');audio=enclosure.get('href' if atom else 'url','') if enclosure is not None else ''
  if not audio.startswith('https://'):audio=''
  transcript=item.find('{https://podcastindex.org/namespace/1.0}transcript')
  transcript_url=transcript.get('url','') if transcript is not None else ''
  if not transcript_url.startswith('https://'):transcript_url=''
  uid=value(item,'id' if atom else 'guid') or audio or value(item,'link')
  if not uid:continue
  link=(next((n.get('href','') for n in item.findall(ns+'link') if n.get('rel','alternate')=='alternate'),'') if atom else value(item,'link')) or source['spotify']
  if not link.startswith('https://'):link=source['spotify']
  rows[uid]={'id':uid,'title':clean(value(item,'title')),'published_at':published.isoformat(),'date':published.astimezone(TW).date().isoformat(),'url':link,'audio_url':audio,'description':clean(value(item,'summary','content') if atom else value(item,'description'))[:10000],'duration':item.findtext('{http://www.itunes.com/dtds/podcast-1.0.dtd}duration') or '', 'transcript_url':transcript_url}
 return {'id':source['id'],'title':clean(value(channel,'title')) or source['title'],'spotify':source['spotify'],'feed':source['feed'],'updated_at':now.isoformat(),'episodes':sorted(rows.values(),key=lambda n:n['published_at'],reverse=True)[:150]}
def public_feed(url):
 u=urllib.parse.urlparse(url);host=u.hostname or ''
 if u.scheme!='https' or not host or u.username or u.password or u.port or '.' not in host:raise ValueError('RSS must be public HTTPS')
 for address in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM):
  if not ipaddress.ip_address(address[4][0]).is_global:raise ValueError('RSS destination must be public')
 return url
class PublicRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,msg,headers,newurl):
  public_feed(newurl)
  return super().redirect_request(request,fp,code,msg,headers,newurl)
def sync_source(source):
 if source.get('shared'):public_feed(source['feed'])
 request=urllib.request.Request(source['feed'],headers={'User-Agent':'Mozilla/5.0','Accept':'application/rss+xml,application/xml'})
 opener=urllib.request.build_opener(PublicRedirect()) if source.get('shared') else urllib.request.build_opener()
 with opener.open(request,timeout=45) as response:
  raw=response.read(12000001)
  if len(raw)>12000000:raise ValueError('RSS too large')
 data=parse_feed(raw,source=source)
 if not data['episodes']:raise ValueError('RSS returned no recent episodes; keeping existing data')
 if source.get('shared'):
  admin_api('/admin/podcasts/update',data)
  print(json.dumps({'channel':source['id'],'episodes':len(data['episodes']),'updated_at':data['updated_at']}));return
 path=pathlib.Path('public/data/podcasts')/(source['id']+'.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 try:
  request=urllib.request.Request(data['episodes'][0]['audio_url'],method='HEAD',headers={'User-Agent':'Mozilla/5.0','Origin':'https://ugiyo.github.io'})
  with urllib.request.urlopen(request,timeout=20) as audio:
   print(json.dumps({'audio_status':audio.status,'audio_bytes':audio.headers.get('Content-Length'),'cors':audio.headers.get('Access-Control-Allow-Origin'),'final_audio_host':urllib.parse.urlparse(audio.url).hostname}))
 except Exception as error:print('Audio HEAD unavailable:',type(error).__name__)
 print(json.dumps({'channel':source['id'],'earliest_date':data['episodes'][-1]['date'],'counts_by_month':{month:sum(e['date'].startswith(month) for e in data['episodes']) for month in sorted({e['date'][:7] for e in data['episodes']})},'episodes':len(data['episodes']),'latest_date':data['episodes'][0]['date'],'audio_host':urllib.parse.urlparse(data['episodes'][0]['audio_url']).hostname,'transcripts':sum(bool(n['transcript_url']) for n in data['episodes'])},ensure_ascii=False))
def admin_api(path,data=None):
 base=os.environ.get('WORKER_API_URL','').rstrip('/');secret=os.environ.get('COLLECTOR_SECRET','')
 if not base or not secret:raise RuntimeError('Shared podcast sync requires collector settings')
 request=urllib.request.Request(base+path,data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None,headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json','User-Agent':'StockNewsCalendar/2.0','Accept':'application/json'})
 with urllib.request.urlopen(request,timeout=45) as response:return json.load(response)
def main():
 errors=[];sources=list(CHANNELS)
 if os.environ.get('WORKER_API_URL'):
  sources += [{**c,'spotify':c.get('spotify') or c['feed'],'shared':True} for c in admin_api('/admin/podcasts/channels')['channels']]
 for source in sources:
  try:sync_source(source)
  except Exception as error:
   print(source['id']+' import failed: '+str(error))
   if not source.get('shared'):errors.append(source['id'])
   if source.get('shared'):
    try:admin_api('/admin/podcasts/update',{'id':source['id'],'error':'RSS 更新失敗，保留先前集數'})
    except Exception:pass
 if errors:raise RuntimeError('Failed podcast channels: '+','.join(errors))
if __name__=='__main__':main()
