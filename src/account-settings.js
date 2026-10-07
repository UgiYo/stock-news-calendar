export function accountSettingsWindow({email,enabled,busy,message},esc){
 return `<div class="modal-backdrop" id="account-settings-backdrop"><section class="summary-dialog account-settings-dialog" id="account-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title" tabindex="-1"><div class="modal-heading"><div><h2 id="account-settings-title">個人帳號設定</h2><small>${esc(email)}</small></div><button id="close-account-settings" aria-label="關閉個人設定">×</button></div><h3>同步設定</h3><label class="account-sync-row" for="account-sync"><span><strong>同步追蹤清單與新聞</strong><small id="account-sync-help">開啟後，同一帳號可跨裝置查看追蹤清單與新聞；關閉後，追蹤及新增新聞保存在此裝置。此設定套用於目前帳號在此裝置。</small></span><span class="account-switch"><input id="account-sync" type="checkbox" role="switch" aria-describedby="account-sync-help" ${enabled?'checked':''} ${busy?'disabled':''}><span class="account-switch-track" aria-hidden="true"></span><span class="account-switch-label">${enabled?'開啟':'關閉'}</span></span></label><p class="account-sync-note"><strong>AI 成果自動同步</strong><br>已完成成果會自動保存至目前登入帳號；使用同一 Google 帳號登入其他裝置即可查看，不受上方開關影響。API 金鑰及 AI 設定仍由各裝置獨立保存。</p><p id="account-sync-status" role="status" aria-live="polite">${esc(busy?'正在更新同步設定…':message||'')}</p></section></div>`;
}
export function bindAccountSettings(root,close){
 const dialog=root.querySelector('#account-settings-dialog');
 root.querySelector('#close-account-settings')?.addEventListener('click',close);
 root.querySelector('#account-settings-backdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)close();});
 dialog?.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();close();return;}
  if(e.key!=='Tab')return;
  const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=nodes[0],last=nodes.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 });
}
