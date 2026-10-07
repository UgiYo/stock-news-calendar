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
export function trackedPublicReports(companies=[],selected='',reports=publicBrokerReports){
 const codes=new Set(companies.map(c=>String(c.code)));
 const seen=new Set();return reports.filter(r=>codes.has(String(r.code))&&(!selected||String(r.code)===String(selected))&&/^https:\/\//.test(r.url)&&!seen.has(r.id)&&seen.add(r.id)).sort((a,b)=>b.date.localeCompare(a.date));
}
