export const CHATGPT_ASSISTANT_SELECTOR =
  '[data-message-author-role="assistant"], article:has([data-testid*="assistant"])';
export const CHATGPT_COMPOSER_SELECTOR =
  '#prompt-textarea, [data-testid="prompt-textarea"], textarea[placeholder*="Message"], [contenteditable="true"][role="textbox"]';
export const CHATGPT_SEND_SELECTOR =
  '[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]';
export const CHATGPT_STOP_SELECTOR =
  '[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]';
export const CHATGPT_STREAMING_SELECTOR = '[data-streaming="true"], .result-streaming';
export const CHATGPT_MESSAGE_SELECTOR = '[data-message-author-role]';
export const CHATGPT_USER_SELECTOR = '[data-message-author-role="user"][data-message-id]';

export type CliOperation =
  | { kind: 'ensure' | 'login' | 'prepare'; conversationUrl?: string }
  | {
      kind: 'commit';
      message: string;
      conversationUrl: string;
      previousUserMessageId?: string;
      previousAssistantMessageId?: string;
    }
  | {
      kind: 'recover';
      conversationUrl: string;
      previousUserMessageId?: string;
      previousAssistantMessageId?: string;
    }
  | {
      kind: 'wait';
      conversationUrl: string;
      outgoingUserMessageId: string;
      timeoutMs: number;
    };

export function normalizeAllowedOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map((origin) => new URL(origin).origin))];
}

export function buildCliOperation(
  operation: CliOperation,
  url: string,
  allowedOrigins: readonly string[],
  nonce = 'test',
): string {
  const config = JSON.stringify({
    operation,
    url,
    allowedOrigins: normalizeAllowedOrigins(allowedOrigins),
    nonce,
    selectors: {
      message: CHATGPT_MESSAGE_SELECTOR,
      composer: CHATGPT_COMPOSER_SELECTOR,
      send: CHATGPT_SEND_SELECTOR,
      stop: CHATGPT_STOP_SELECTOR,
      streaming: CHATGPT_STREAMING_SELECTOR,
    },
  });
  // run-code follows the documented restricted-sandbox capability contract below.
  return `async page => {
    const c=${config};
    const fail=code=>{throw new Error(code)};
    const allowed=u=>c.allowedOrigins.some(o=>u===o||u.startsWith(o+'/')||u.startsWith(o+'?')||u.startsWith(o+'#'));
    const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]+$/.test(id);
    const encode=v=>{const s=encodeURIComponent(JSON.stringify(v));let h='';for(let i=0;i<s.length;i++)h+=s.charCodeAt(i).toString(16).padStart(2,'0');return h};
    const result=v=>'CHATBRIDGE_RESULT_'+c.nonce+'_'+encode(v);
    const bridgeError=e=>'CHATBRIDGE_ERROR_'+c.nonce+'_'+encode({code:e});
    const canonical=u=>u.split('#')[0];
    const candidates=()=>page.context().pages().filter(p=>allowed(p.url()));
    const exact=url=>canonical(page.url())===url?page:page.context().pages().find(p=>canonical(p.url())===url);
    const selected=url=>{if(url)return exact(url);if(allowed(page.url()))return page;const items=candidates();if(items.length>1)fail('CHATGPT_TAB_AMBIGUOUS');return items[0]};
    const metadata=async(target,execute=action=>action())=>{const result=[];for(const item of await execute(()=>target.$$(c.selectors.message))){const id=await execute(()=>item.getAttribute('data-message-id'));const role=await execute(()=>item.getAttribute('data-message-author-role'));if(typeof role==='string')result.push(validId(id)?{id,role}:{role})}return result};
    const latest=(items,role)=>{for(let i=items.length-1;i>=0;i--)if(items[i].role===role&&items[i].id)return items[i].id};
    const delay=ms=>page.waitForTimeout(ms);
    const poll=async(predicate,timeout,timeoutCode='BRIDGE_TIMEOUT')=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await predicate();if(value!==undefined)return value;await delay(50)}fail(timeoutCode)};
    let target;
    let invalid=false;
    let navigationGuard;
    let sendLifecycle='PRE_COMMIT';
    const bind=value=>{target=value;navigationGuard=frame=>{if(frame===target.mainFrame()&&!allowed(frame.url()))invalid=true};target.on('framenavigated',navigationGuard)};
    const guard=()=>{if(!target||invalid||!allowed(target.url())){invalid=true;fail('ORIGIN_DENIED')}};
    const step=async action=>{guard();try{const value=await action();guard();return value}catch(error){guard();throw error}};
    try{
      if(c.operation.kind==='ensure'||c.operation.kind==='login'||c.operation.kind==='prepare'){
        let choice=selected(c.operation.conversationUrl);if(!choice){choice=await page.context().newPage();try{await choice.goto(c.operation.conversationUrl||c.url)}catch(error){if(c.operation.conversationUrl)fail('CHATGPT_CONVERSATION_UNAVAILABLE');throw error}}bind(choice);guard();
        if(c.operation.conversationUrl&&canonical(choice.url())!==c.operation.conversationUrl)fail('CHATGPT_CONVERSATION_UNAVAILABLE');
        if(c.operation.kind==='ensure')return result({value:{conversationUrl:choice.url()}});
        if(c.operation.kind==='login'){const composer=await step(()=>target.$(c.selectors.composer));return result({value:composer?await step(()=>composer.isVisible()):false})}
        const items=await step(()=>metadata(target));
        return result({value:{conversationUrl:target.url(),previousUserMessageId:latest(items,'user'),previousAssistantMessageId:latest(items,'assistant')}})
      }
      if(c.operation.kind==='recover'){
        const inspected=[];
        const inspect=async candidate=>{if(inspected.includes(candidate))return;inspected.push(candidate);let candidateInvalid=false;let invalidate;const invalidated=new Promise(resolve=>invalidate=resolve);const listener=frame=>{if(frame===candidate.mainFrame()&&!allowed(frame.url())){candidateInvalid=true;invalidate()}};const check=()=>{if(candidateInvalid||!allowed(candidate.url())){candidateInvalid=true;fail('ORIGIN_DENIED')}};const candidateStep=async action=>{check();try{const value=await action();check();return value}catch(error){await Promise.race([delay(25),invalidated]);check();throw error}};candidate.on('framenavigated',listener);try{check();const items=await metadata(candidate,candidateStep);check();const id=latest(items,'user');return id&&id!==c.operation.previousUserMessageId?{conversationUrl:candidate.url(),outgoingUserMessageId:id,previousAssistantMessageId:c.operation.previousAssistantMessageId}:undefined}finally{candidate.off('framenavigated',listener)}};
        const preferred=allowed(page.url())?await inspect(page):undefined;if(preferred)return result({value:preferred});
        const old=exact(c.operation.conversationUrl);if(old){const recovered=await inspect(old);if(recovered)return result({value:recovered})}
        const matches=[];for(const candidate of candidates()){const recovered=await inspect(candidate);if(recovered)matches.push(recovered)}
        return result({value:matches.length===1?matches[0]:null})
      }
      target=exact(c.operation.conversationUrl);if(!target)fail('CHATGPT_CONVERSATION_NOT_FOUND');bind(target);guard();
      if(c.operation.kind==='commit'){
        const beforeCommit=await step(()=>metadata(target));if(beforeCommit.some(item=>!item.id))fail('CHATGPT_MESSAGE_ID_UNAVAILABLE');
        const composer=await poll(async()=>{const item=await step(()=>target.$(c.selectors.composer));return item&&await step(()=>item.isVisible())?item:undefined},10000);
        await step(()=>composer.fill(c.operation.message));const send=await step(()=>target.$(c.selectors.send));
        if(send&&await step(()=>send.isVisible())){sendLifecycle='COMMIT_ATTEMPTED';await step(()=>send.click({noWaitAfter:true,timeout:10000}))}else{sendLifecycle='COMMIT_ATTEMPTED';await step(()=>composer.press('Enter'))}
        const outgoingUserMessageId=await poll(async()=>{const id=latest(await step(()=>metadata(target)),'user');return id&&id!==c.operation.previousUserMessageId?id:undefined},10000,'CHATGPT_MESSAGE_ID_UNAVAILABLE');
        sendLifecycle='COMMITTED';
        return result({value:{conversationUrl:target.url(),outgoingUserMessageId,previousAssistantMessageId:c.operation.previousAssistantMessageId}})
      }
      let assistantId;
      const deadline=Date.now()+c.operation.timeoutMs;
      assistantId=await poll(async()=>{const items=await step(()=>metadata(target));const anchor=items.findIndex(item=>item.role==='user'&&item.id===c.operation.outgoingUserMessageId);if(anchor<0)return;const found=items.slice(anchor+1).find(item=>item.role==='assistant');if(found&&!found.id)fail('CHATGPT_MESSAGE_ID_UNAVAILABLE');return found&&found.id},c.operation.timeoutMs);
      let stable;
      const text=await poll(async()=>{const handles=await step(()=>target.$$(c.selectors.message));let current;for(const handle of handles)if(await step(()=>handle.getAttribute('data-message-id'))===assistantId){current=handle;break}if(!current)return;const streaming=await step(()=>current.getAttribute('data-message-streaming'))==='true'||Boolean(await step(()=>current.$(c.selectors.streaming)));const stopped=Boolean(await step(()=>target.$(c.selectors.stop)));const value=(await step(()=>current.innerText())).trim();if(streaming||stopped||!value){stable=undefined;return}if(stable===value)return value;stable=value},Math.max(1,deadline-Date.now()));
      return result({value:text})
    }catch(error){const code=error&&typeof error.message==='string'?error.message:'';if(sendLifecycle==='COMMIT_ATTEMPTED'&&code!=='ORIGIN_DENIED')return bridgeError('SEND_OBSERVER_FAILED');if(['ORIGIN_DENIED','BRIDGE_TIMEOUT','CHATGPT_DOCUMENT_MISSING','CHATGPT_MESSAGE_ID_UNAVAILABLE','CHATGPT_TAB_AMBIGUOUS','CHATGPT_CONVERSATION_NOT_FOUND','CHATGPT_CONVERSATION_UNAVAILABLE'].includes(code))return bridgeError(code);throw error}
    finally{if(target&&navigationGuard)target.off('framenavigated',navigationGuard)}
  }`;
}
