import {monthCells} from './utils.js';
export function tradingCalendarCells(year,month,dates){
 const available=new Set(dates);return monthCells(year,month).map(c=>({...c,enabled:available.has(c.key)}));
}
export function renderTradingDateCalendar(host,dates,selected,onDate){
 const available=[...new Set(dates.filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
 const initial=selected||available.at(-1)||new Date().toISOString().slice(0,10);
 let [year,month]=initial.split('-').map(Number);month--;
 const draw=(open=false)=>{
  const key=`${year}-${String(month+1).padStart(2,'0')}`,first=available[0]?.slice(0,7),last=available.at(-1)?.slice(0,7);
  host.innerHTML=`<details class="trading-date-calendar" ${open?'open':''}><summary>交易日期 <strong>${selected||'尚無資料'}</strong> ▾</summary><div class="trading-calendar-panel"><div class="trading-calendar-heading"><button data-calendar-prev aria-label="上一月" ${!first||key<=first?'disabled':''}>‹</button><strong>${year} 年 ${month+1} 月</strong><button data-calendar-next aria-label="下一月" ${!last||key>=last?'disabled':''}>›</button></div><div class="trading-calendar-weekdays">${['日','一','二','三','四','五','六'].map(d=>`<span>${d}</span>`).join('')}</div><div class="trading-calendar-days">${tradingCalendarCells(year,month,available).map(c=>`<button data-calendar-date="${c.key}" ${c.enabled?'':'disabled'} class="${c.current?'':'outside-month'} ${c.key===selected?'selected':''}" aria-label="${c.key}${c.enabled?'，有成交資料':'，無成交資料'}" ${c.key===selected?'aria-current="date"':''}>${c.number}</button>`).join('')}</div><small>灰色日期沒有對應成交資料，無法選擇。</small></div></details>`;
  host.querySelector('[data-calendar-prev]').onclick=()=>{if(month===0){year--;month=11;}else month--;draw(true);host.querySelector('[data-calendar-prev]').focus();};
  host.querySelector('[data-calendar-next]').onclick=()=>{if(month===11){year++;month=0;}else month++;draw(true);host.querySelector('[data-calendar-next]').focus();};
  host.querySelectorAll('[data-calendar-date]:not(:disabled)').forEach(b=>b.onclick=()=>{host.querySelector('details').open=false;onDate(b.dataset.calendarDate);});
  host.querySelector('details').onkeydown=e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary').focus();}};
 };draw();
}
