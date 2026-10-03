import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-03T00:00:00Z')});
 let downloads=0,transcriptions=0,summaries=0;
 await page.addInitScript(()=>localStorage.setItem('stock-news-local-ai-v1',JSON.stringify({provider:'openai',endpoint:'https://api.openai.com/v1',model:'gpt-4.1-mini',key:'isolated-test-key',transport:'direct'})));
 await page.route('**/data/podcasts/zhaohua.json',route=>route.fulfill({json:{title:'兆華與股惑仔',updated_at:'2026-10-03T00:00:00Z',episodes:[{id:'fixture-episode',title:'測試節目',published_at:'2026-10-02T06:00:00Z',url:'https://open.spotify.com/show/6cMUsVRnTCrCqo4rs8LBjQ',audio_url:'https://rss.soundon.fm/test.mp3',description:'Test show notes'}]}}));
 await page.route('https://rss.soundon.fm/test.mp3',route=>{downloads++;return route.fulfill({body:'isolated fake audio',contentType:'audio/mpeg',headers:{'Access-Control-Allow-Origin':'*'}});});
 await page.route('https://api.openai.com/**',route=>{if(route.request().url().endsWith('/audio/transcriptions')){transcriptions++;return route.fulfill({json:{text:'逐字稿討論聯電營收與市場觀點。'.repeat(20)}});}summaries++;return route.fulfill({json:{choices:[{message:{content:'本集重點：聯電營收與市場觀點'}}]}});});

 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>document.querySelector('.podcast-controls p')?.textContent.includes('1 集'));
 await page.locator('[data-date="2026-10-02"]').click();await page.locator('[data-podcast-episode]').first().click();await page.locator('#podcast-episode').waitFor();await page.locator('#podcast-one-click').click();await page.waitForFunction(()=>document.querySelector('#podcast-result')?.textContent.includes('本集重點'));await page.locator('#podcast-one-click').click();await page.waitForFunction(()=>document.querySelector('#podcast-status')?.textContent.includes('本集重點已完成'));if(downloads!==1||transcriptions!==1||summaries!==2)throw Error('One click must reuse existing transcript');await page.locator('#podcast-transcript').fill('這是一份測試逐字稿，討論聯電產業。');await page.locator('#podcast-close').click();await page.locator('[data-podcast-episode]').first().click();const draft=await page.locator('#podcast-transcript').inputValue();if(!draft.includes('測試逐字稿'))throw Error('Draft lost');await page.locator('#podcast-close').click();
 await page.locator('#podcast-import-open').click();await page.locator('#podcast-link').fill('https://open.spotify.com/show/6cMUsVRnTCrCqo4rs8LBjQ?si=example');await page.locator('#podcast-import form button').click();await page.locator('#podcast-import').waitFor({state:'detached'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile page overflows viewport');if(errors.length)throw Error(errors.join('\n'));
 await page.screenshot({path:'podcast-mobile.png',fullPage:true});console.log(JSON.stringify({draftPreserved:true,horizontalOverflow:false,pageErrors:errors.length,downloads,transcriptions,summaries}));
}finally{await browser.close();}
