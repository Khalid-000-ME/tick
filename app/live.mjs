import {chromium,devices} from 'playwright';
const U=process.argv[2]||'https://tick-predict.vercel.app/';
const b=await chromium.launch();
for (const [name,opts] of [['desktop',{viewport:{width:1280,height:800}}],['phone',{...devices['Pixel 7']}]]) {
  const ctx=await b.newContext(opts);const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,200)));p.on('console',m=>{if(m.type()==='error')errs.push('C: '+m.text().slice(0,160));});
  await p.goto(U,{waitUntil:'load'});await p.waitForTimeout(6000);
  const y0=await p.evaluate(()=>scrollY);
  if(name==='phone'){await p.touchscreen.tap(200,300);} 
  await p.mouse.move(400,400);await p.mouse.wheel(0,1500);await p.waitForTimeout(1200);
  const y1=await p.evaluate(()=>scrollY);
  const st=await p.evaluate(()=>({bodyOverflow:getComputedStyle(document.body).overflow,htmlOverflow:getComputedStyle(document.documentElement).overflow,height:document.documentElement.scrollHeight,dialogs:document.querySelectorAll('.auth-backdrop').length,pe:getComputedStyle(document.body).pointerEvents}));
  await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(500);
  let clicked='n/a';
  try{await p.locator('.landing-primary').first().click({timeout:5000});await p.waitForTimeout(1200);clicked=(await p.locator('.auth-panel').count())?'dialog opened':'no dialog';}catch(e){clicked='click failed: '+e.message.split('\n')[0];}
  console.log(name,JSON.stringify({scrollBefore:y0,scrollAfterWheel:y1,...st,signupClick:clicked}));
  console.log(errs.slice(0,6));
  await ctx.close();
}
await b.close();
