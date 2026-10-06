import test from 'node:test';import assert from 'node:assert/strict';
import {renderMarkdown,markdownSource} from '../src/markdown-preview.js';
test('renders headings, lists, emphasis and GFM tables',()=>{const html=renderMarkdown('# 標題\n\n- **重點**\n\n|公司|方向|\n|---|---|\n|台積電|上升|');assert.match(html,/<h1>標題/);assert.match(html,/<strong>重點/);assert.match(html,/<ul>/);assert.match(html,/markdown-table-scroll/);assert.match(html,/<table>/);});
test('AI output cannot inject HTML or executable links or remote images',()=>{const html=renderMarkdown('<script>alert(1)</script>\n\n[點擊](javascript:alert%281%29)\n\n![圖](https://tracker.example/image)');assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));});
test('raw markdown is preserved for saving and copying',()=>{assert.equal(markdownSource({dataset:{markdown:'# 原文'},textContent:'原文'}),'# 原文');});
