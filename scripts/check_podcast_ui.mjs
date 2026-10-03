import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-03T00:00:00Z')});
 await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>document.querySelector('.podcast-controls p')?.textContent.includes('70 集'));
 await page.locator('[data-date="2026-10-02"]').click();await page.locator('[data-podcast-episode]').first().click();await page.locator('#podcast-episode').waitFor();await page.locator('#podcast-transcript').fill('這是一份測試逐字稿，討論聯電產業。');await page.locator('#podcast-close').click();await page.locator('[data-podcast-episode]').first().click();const draft=await page.locator('#podcast-transcript').inputValue();if(!draft.includes('測試逐字稿'))throw Error('Draft lost');await page.locator('#podcast-close').click();
 await page.locator('#podcast-import-open').click();await page.locator('#podcast-link').fill('https://open.spotify.com/show/6cMUsVRnTCrCqo4rs8LBjQ?si=example');await page.locator('#podcast-import form button').click();await page.locator('#podcast-import').waitFor({state:'detached'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile page overflows viewport');if(errors.length)throw Error(errors.join('\n'));
 await page.screenshot({path:'podcast-mobile.png',fullPage:true});console.log(JSON.stringify({draftPreserved:true,horizontalOverflow:false,pageErrors:errors.length}));
}finally{await browser.close();}
