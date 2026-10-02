// Local real Worker/D1 test. Uses a deliberately invalid provider key; does not
// generate paid replies. HTTP-contract fixtures below are explicitly marked.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],checks=[],tag=Date.now().toString(36);
await fs.mkdir('work',{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const check=name=>{checks.push(name);console.log('PASS '+name);};
async function api(path,body){return page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{path,body});}
try{
 await page.goto(base);await page.locator('[data-act=auth][data-mode=register]').click();
 await page.locator('[name=username]').fill('NY'+tag);await page.locator('[name=password]').fill('NyanQA_'+tag+'!');
 await page.locator('#authForm button[type=submit]').click();await page.locator('.social-rail').waitFor({timeout:20000});
 await page.locator('.social-rail [data-page="/nyan"]').click();await page.locator('[data-act=nyan-check]').waitFor();
 await page.locator('[data-act=nyan-check]').click();await page.getByText('请先保存 API 地址、密钥和模型名称',{exact:false}).waitFor();
 check('real connection checker requires saved config');
 const before=(await api('/api/me')).data.state;
 const c=await api('/api/command',{type:'settings',baseUrl:'https://apihub.agnes-ai.com/v1',model:'agnes-2.5-flash',apiKey:'invalid-test-only-'+tag,opId:crypto.randomUUID()});
 assert.equal(c.status,200);assert.equal(c.data.state.apiConfig.hasKey,true);
 await page.locator('[data-act=nyan-check]').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.chat-error,.connect-banner')].some(e=>/DNS_CHECK_FAILED|API_HTTP_401|API_HTTP_403|API_TIMEOUT|API_CONNECT_FAILED/.test(e.textContent)),null,{timeout:45000});
 assert.equal((await api('/api/nyan')).data.turns.length,0);
 check('real checker reports network/auth stage without creating a chat turn');
 await page.locator('#nyanText').fill('这是网络诊断测试消息');
 await page.locator('#nyanConsent').check();await page.locator('#nyanForm button[type=submit]').click();
 await page.locator('[data-act=nyan-retry]').waitFor({timeout:120000});
 assert.equal(await page.locator('#nyanText').inputValue(),'这是网络诊断测试消息');
 let turns=(await api('/api/nyan')).data.turns;assert.equal(turns.length,1);assert.equal(turns[0].status,'failed');assert(/\[(DNS_|API_)/.test(turns[0].error));
 assert(!JSON.stringify(turns).includes('invalid-test-only'));
 check('real failed chat keeps draft, writes safe stage error and offers retry');
 const id=turns[0].op_id;await page.locator('[data-act=nyan-retry]').click();
 await page.waitForFunction(()=>document.querySelector('[data-act=nyan-retry]')?.disabled===false,null,{timeout:120000});
 turns=(await api('/api/nyan')).data.turns;assert.equal(turns.length,1);assert.equal(turns[0].op_id,id);
 check('real explicit retry reuses stored turn without duplicate messages');
 const after=(await api('/api/me')).data.state;assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.cats.map(c=>c.id),before.cats.map(c=>c.id));
 // HTTP fixture is UI-only: no claim of successful real model generation.
 await page.route('**/api/nyan/check',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,code:'CONNECTION_OK',endpoint:'https://api.example.com/v1/chat/completions',model:'fixture-only',message:'测试夹具：仅确认 UI 渲染',elapsedMs:120})}));
 await page.locator('[data-act=nyan-check]').click();await page.getByText('CONNECTION_OK',{exact:true}).waitFor();check('UI-only successful diagnostic fixture renders');
 await page.screenshot({path:'work/nyan-diagnostics-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'work/nyan-diagnostics-mobile.png',fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);check('mobile diagnostic text fits; no browser exceptions');
 await fs.writeFile('work/nyan-diagnostics-report.json',JSON.stringify({at:new Date().toISOString(),base,checks,errors,providerGenerationTested:false},null,2));
}catch(e){await page.screenshot({path:'work/nyan-ui-failure.png',fullPage:true}).catch(()=>{});throw e;}
finally{await browser.close();}
