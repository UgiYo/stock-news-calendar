// Original reports verified on official broker sites; source files remain at the publisher.
export const publicBrokerReports=[
  {
    "id": "sinopac-2327-20230421",
    "code": "2327",
    "broker": "永豐投顧",
    "date": "2023-04-21",
    "title": "國巨：庫存高、能見度低",
    "rating": "中立",
    "target": null,
    "url": "https://www.sinotrade.com.tw/UploadFiles/2023/202304/a9b10f41-cf2e-48b9-9b92-15ae0c4eb7c3.PDF",
    "page": 1,
    "type": "公開原始研究報告",
    "verifiedAt": "2026-10-07",
    "note": "歷史報告；原始報告未列目標價，價格基準未經分割或除權息調整。"
  },
  {
    "id": "sinopac-2327-20230315",
    "code": "2327",
    "broker": "永豐投顧",
    "date": "2023-03-15",
    "title": "國巨：停、看、聽",
    "rating": "中立",
    "target": null,
    "url": "https://www.sinotrade.com.tw/UploadFiles/2023/202303/2b639812-e0db-4250-a8dc-e281049777ae.PDF",
    "page": 1,
    "type": "公開原始研究報告",
    "verifiedAt": "2026-10-07",
    "note": "歷史報告；原始報告未列目標價，價格基準未經分割或除權息調整。"
  }
];
// Only publishers already verified for this original-report catalog are accepted.
const publisherHosts={'永豐投顧':['www.sinotrade.com.tw']};
const explicitRatings=new Set(['買進','買入','增持','優於大盤','優於市場','中立','持有','減持','賣出','劣於大盤','逢低買進','區間操作','Buy','Neutral','Hold','Sell','Outperform','Underperform','Overweight','Equal Weight','Underweight']);
export function eligibleBrokerReport(report){
 try{const u=new URL(report.url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&publisherHosts[report.broker]?.includes(u.hostname)&&report.type==='公開原始研究報告'&&/^\d{4}-\d{2}-\d{2}$/.test(report.verifiedAt||'')&&(explicitRatings.has(String(report.rating||'').trim())||(typeof report.target==='number'&&Number.isFinite(report.target)&&report.target>0));}catch{return false;}
}
export function trackedPublicReports(companies=[],selected='',reports=publicBrokerReports){
 const codes=new Set(companies.map(c=>String(c.code)));
 const seen=new Set();return reports.filter(r=>codes.has(String(r.code))&&(!selected||String(r.code)===String(selected))&&eligibleBrokerReport(r)&&!seen.has(r.id)&&seen.add(r.id)).sort((a,b)=>b.date.localeCompare(a.date));
}
