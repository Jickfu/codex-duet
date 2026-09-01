export const CHATGPT_ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], article:has([data-testid*="assistant"])';
export const CHATGPT_COMPOSER_SELECTOR =
  '#prompt-textarea, [data-testid="prompt-textarea"], textarea[placeholder*="Message"], [contenteditable="true"][role="textbox"]';
export const CHATGPT_SEND_SELECTOR = '[data-testid="send-button"]';
export const CHATGPT_STOP_SELECTOR =
  '[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]';
export const CHATGPT_STREAMING_SELECTOR = '[data-streaming="true"], .result-streaming';

export type CliOperation =
  | { kind: 'ensure' | 'login' }
  | { kind: 'send'; message: string }
  | { kind: 'wait'; afterCount: number; timeoutMs: number };
export function buildCliOperation(
  operation: CliOperation,
  url: string,
  allowedOrigins: readonly string[],
): string {
  const config = JSON.stringify({
    operation,
    url,
    allowedOrigins,
    selectors: {
      assistant: CHATGPT_ASSISTANT_SELECTOR,
      composer: CHATGPT_COMPOSER_SELECTOR,
      send: CHATGPT_SEND_SELECTOR,
      stop: CHATGPT_STOP_SELECTOR,
      streaming: CHATGPT_STREAMING_SELECTOR,
    },
  });
  return `async page => {const c=${config};const allowed=u=>{try{return c.allowedOrigins.includes(new URL(u).origin)}catch{return false}};let target=page.context().pages().find(p=>allowed(p.url()));if(!target){target=await page.context().newPage();await target.goto(c.url)}const guard=()=>{if(!allowed(target.url()))throw new Error('ORIGIN_DENIED')};const result=v=>'CHATBRIDGE_RESULT_'+btoa(unescape(encodeURIComponent(JSON.stringify(v))));let rejectNavigation;const abort=new Promise((_,reject)=>{rejectNavigation=reject});const navigationGuard=frame=>{if(frame===target.mainFrame()&&!allowed(frame.url()))rejectNavigation(new Error('ORIGIN_DENIED'))};target.on('framenavigated',navigationGuard);const work=async()=>{guard();if(c.operation.kind==='ensure')return result({ok:true});const composer=target.locator(c.selectors.composer).first();if(c.operation.kind==='login'){const value=await composer.isVisible();guard();return result({value})}if(c.operation.kind==='send'){const before=await target.locator(c.selectors.assistant).count();guard();await composer.fill(c.operation.message);guard();const send=target.locator(c.selectors.send).or(target.getByRole('button',{name:/send|发送/i})).first();if(await send.isVisible())await send.click();else await composer.press('Enter');guard();return result({value:before})}await target.waitForFunction(({selector,count,origins})=>{if(!origins.includes(location.origin))throw new Error('ORIGIN_DENIED');return document.querySelectorAll(selector).length>count},{selector:c.selectors.assistant,count:c.operation.afterCount,origins:c.allowedOrigins},{timeout:c.operation.timeoutMs});guard();const item=target.locator(c.selectors.assistant).nth(c.operation.afterCount);await item.waitFor({state:'visible',timeout:c.operation.timeoutMs});await target.waitForFunction(({index,s,origins})=>{if(!origins.includes(location.origin))throw new Error('ORIGIN_DENIED');const el=document.querySelectorAll(s.assistant)[index];return !!el&&el.getAttribute('data-message-streaming')!=='true'&&!el.querySelector(s.streaming)&&!document.querySelector(s.stop)&&(el.textContent?.trim().length??0)>0},{index:c.operation.afterCount,s:c.selectors,origins:c.allowedOrigins},{timeout:c.operation.timeoutMs,polling:100});guard();return result({value:(await item.innerText()).trim()})};try{return await Promise.race([work(),abort])}finally{target.off('framenavigated',navigationGuard)}}`;
}
