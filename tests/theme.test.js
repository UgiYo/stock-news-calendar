import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {THEME_KEY,readTheme,applyTheme,themeControl,bindThemeControl,updateThemeControl} from '../src/theme.js';
const storage=value=>({getItem:()=>value,setItem:(key,next)=>{assert.equal(key,THEME_KEY);value=next;}});
test('saved theme wins over device preference and invalid settings fall back to the device',()=>{
 assert.equal(readTheme(storage('light'),{matches:true}),'light');assert.equal(readTheme(storage('dark'),{matches:false}),'dark');
 assert.equal(readTheme(storage('invalid'),{matches:true}),'dark');assert.equal(readTheme(storage(null),{matches:false}),'light');
 assert.equal(readTheme({getItem(){throw Error('blocked');}},{matches:true}),'dark');
});
test('applying a theme preserves open dialogs and drafts and survives unavailable storage',()=>{
 const {document}=parseHTML('<html><head><meta name="theme-color"></head><body><dialog open><textarea>保留草稿</textarea></dialog></body></html>');const dialog=document.querySelector('dialog');
 applyTheme('dark',{document,storage:storage(null)});assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(document.documentElement.style.colorScheme,'dark');assert.equal(document.querySelector('meta').getAttribute('content'),'#0c1520');
 applyTheme('light',{document,storage:{setItem(){throw Error('blocked');}}});assert.equal(document.documentElement.dataset.theme,'light');assert.strictEqual(document.querySelector('dialog'),dialog);assert.ok(dialog.hasAttribute('open'));assert.equal(document.querySelector('textarea').value,'保留草稿');
});
test('button shows current state, accessible next action, and announces the completed switch',()=>{
 const {document}=parseHTML(`<html data-theme="light"><body>${themeControl('light')}</body></html>`);const button=document.querySelector('#theme-toggle');
 bindThemeControl(document);button.onclick();assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(button.getAttribute('aria-pressed'),'true');assert.match(button.getAttribute('aria-label'),/目前為深色.*切換至淺色/);assert.match(document.querySelector('#theme-status').textContent,/已切換為深色/);
 applyTheme('light',{document,persist:false});updateThemeControl(document);assert.equal(button.querySelector('[data-theme-label]').textContent,'淺色');
});

test('other tabs and device preference changes synchronize without overriding a manual choice',async()=>{
 const {installThemeSync}=await import('../src/theme.js');const {document}=parseHTML(`<html><head><meta name="theme-color"></head><body>${themeControl('light')}</body></html>`);
 let saved=null,handlers={},mediaHandler;const media={matches:false,addEventListener(name,handler){mediaHandler=handler;}};
 const window={document,localStorage:{getItem:()=>saved},matchMedia:()=>media,addEventListener(name,handler){handlers[name]=handler;}};
 installThemeSync(window);assert.equal(document.documentElement.dataset.theme,'light');media.matches=true;mediaHandler();assert.equal(document.documentElement.dataset.theme,'dark');
 saved='light';handlers.storage({key:THEME_KEY});assert.equal(document.documentElement.dataset.theme,'light');mediaHandler();assert.equal(document.documentElement.dataset.theme,'light');
});
