export const CHATGPT_ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], article:has([data-testid*="assistant"])';
export const CHATGPT_COMPOSER_SELECTOR =
  '#prompt-textarea, [data-testid="prompt-textarea"], textarea[placeholder*="Message"], [contenteditable="true"][role="textbox"]';
export const CHATGPT_SEND_SELECTOR =
  '[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]';
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
  return `async page => {const c=${config};const allowed=u=>{try{return c.allowedOrigins.includes(new URL(u).origin)}catch{return false}};let target=page.context().pages().find(p=>allowed(p.url()));if(!target){target=await page.context().newPage();await target.goto(c.url)}let invalid=false;const navigationGuard=frame=>{if(frame===target.mainFrame()&&!allowed(frame.url()))invalid=true};target.on('framenavigated',navigationGuard);const guard=()=>{if(invalid||!allowed(target.url())){invalid=true;throw new Error('ORIGIN_DENIED')}};const step=async action=>{guard();try{const value=await action();guard();return value}catch(error){guard();throw error}};const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));const pollValue=async(predicate,timeout)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){guard();const value=await predicate();guard();if(value!==undefined)return value;await delay(50);guard()}throw new Error('BRIDGE_TIMEOUT')};const result=v=>'CHATBRIDGE_RESULT_'+btoa(unescape(encodeURIComponent(JSON.stringify(v))));try{guard();const root=await step(()=>target.$('html'));if(!root)throw new Error('CHATGPT_DOCUMENT_MISSING');if(c.operation.kind==='ensure')return result({ok:true});if(c.operation.kind==='login'){const composer=await step(()=>root.$(c.selectors.composer));return result({value:composer?await step(()=>composer.isVisible()):false})}if(c.operation.kind==='send'){const before=(await step(()=>root.$$(c.selectors.assistant))).length;const composer=await pollValue(async()=>{const item=await step(()=>root.$(c.selectors.composer));return item&&await step(()=>item.isVisible())?item:undefined},10000);await step(()=>composer.fill(c.operation.message));const send=await step(()=>root.$(c.selectors.send));if(send&&await step(()=>send.isVisible()))await step(()=>send.click());else await step(()=>composer.press('Enter'));return result({value:before})}const deadline=Date.now()+c.operation.timeoutMs;const item=await pollValue(async()=>{const items=await step(()=>root.$$(c.selectors.assistant));return items.length>c.operation.afterCount?items[c.operation.afterCount]:undefined},c.operation.timeoutMs);await pollValue(async()=>await step(()=>item.isVisible())?true:undefined,Math.max(1,deadline-Date.now()));await pollValue(async()=>{const streaming=await step(()=>item.getAttribute('data-message-streaming'))==='true'||Boolean(await step(()=>item.$(c.selectors.streaming)));const stopped=Boolean(await step(()=>root.$(c.selectors.stop)));const text=await step(()=>item.textContent());return!streaming&&!stopped&&(text?.trim().length??0)>0?true:undefined},Math.max(1,deadline-Date.now()));return result({value:(await step(()=>item.innerText())).trim()})}finally{target.off('framenavigated',navigationGuard)}}`;
}
