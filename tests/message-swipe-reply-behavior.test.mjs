import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function gestureHarness(alignment='flex-start') {
  const slots=[];let cursor=0;const timers=new Map();let timerId=0;let replies=0,opens=0,taps=0;
  const react={useRef(value){const i=cursor++;return slots[i]??={current:value};},useEffect(){cursor++;},useState(value){const i=cursor++;slots[i]??={value};return [slots[i].value,v=>slots[i].value=v];}};
  const jsx=(type,props)=>({type,props});
  const exports={};
  const code=ts.transpileModule(fs.readFileSync('src/components/MessagePress.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name==='react'?react:{jsx,jsxs:jsx},navigator:{vibrate(){}},window:{getComputedStyle:()=>({justifyContent:alignment}),setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)}});
  const captured=new Set();
  const element={setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id),getBoundingClientRect:()=>({left:0,top:0,width:350,height:60})};
  const props={onOpen:()=>opens++,onReply:()=>replies++,onTap:()=>taps++,children:'message'};
  const render=()=>{cursor=0;return exports.default(props).props;};
  const event=(x=0,y=0,extra={})=>({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,currentTarget:element,target:{closest:()=>null},cancelable:true,preventDefault(){},stopPropagation(){},...extra});
  return {render,event,timers,counts:()=>({replies,opens,taps}),captured};
}

test('incoming replies only to the right, outgoing only to the left, once per completed gesture',()=>{
  for (const [alignment,direction] of [['flex-start',1],['flex-end',-1]]) {
    const h=gestureHarness(alignment);let p=h.render();p.onPointerDown(h.event());p.onPointerMove(h.event(-direction*120));p.onPointerUp(h.event(-direction*120));assert.equal(h.counts().replies,0);
    p=h.render();p.onPointerDown(h.event());p.onPointerMove(h.event(direction*120));
    // Finish before React rerenders: the last movement must still count.
    p.onPointerUp(h.event(direction*120));p.onPointerUp(h.event(direction*120));assert.equal(h.counts().replies,1);assert.equal(h.captured.size,0);
  }
});

test('hover, a different pointer, scrolling and cancelled gestures never reply',()=>{
  const h=gestureHarness();let p=h.render();p.onPointerMove(h.event(200));p.onPointerUp(h.event(200));assert.equal(h.counts().replies,0);
  p.onPointerDown(h.event());p.onPointerMove(h.event(200,0,{pointerId:2}));p.onPointerUp(h.event(200,0,{pointerId:2}));assert.equal(h.counts().replies,0);p.onPointerCancel(h.event());
  p=h.render();p.onPointerDown(h.event());p.onPointerMove(h.event(2,30));p.onPointerMove(h.event(200,35));p.onPointerUp(h.event(200,35));assert.equal(h.counts().replies,0);
  p=h.render();p.onPointerDown(h.event());p.onPointerMove(h.event(200));p.onPointerCancel(h.event(200));p.onPointerUp(h.event(200));assert.equal(h.counts().replies,0);
});

test('long press opens once, cannot become reply and does not steal embedded controls',()=>{
  const h=gestureHarness();const p=h.render();p.onPointerDown(h.event());for(const fn of h.timers.values())fn();p.onContextMenu(h.event());p.onPointerMove(h.event(200));p.onPointerUp(h.event(200));assert.deepEqual(h.counts(),{replies:0,opens:1,taps:0});
  p.onPointerDown(h.event(0,0,{target:{closest:()=>({tagName:'BUTTON'})}}));assert.equal(h.captured.size,0);
  assert.equal(p.style.overflowX,'clip');assert.equal(p.style.overflowY,'visible');assert.equal(p.style.touchAction,'pan-y pinch-zoom');assert.equal(p.style.WebkitTouchCallout,'none');
});


test('property and media buttons opt into swipe without stealing a normal tap',()=>{
  for(const alignment of ['flex-start','flex-end']) {
    const h=gestureHarness(alignment),p=h.render(),direction=alignment==='flex-start'?1:-1;
    const target={closest:()=>({getAttribute:key=>key==='data-message-swipe-surface'?'true':null})};
    p.onPointerDown(h.event(0,0,{target}));assert.equal(h.captured.size,0,'tap must remain on its property/photo button');
    p.onPointerUp(h.event(0,0,{target}));assert.equal(h.counts().replies,0);
    p.onPointerDown(h.event(0,0,{target}));p.onPointerMove(h.event(100*direction,0,{target}));
    assert.equal(h.captured.size,1);p.onPointerUp(h.event(100*direction,0,{target}));assert.equal(h.counts().replies,1);
    let prevented=false;p.onClickCapture(h.event(100*direction,0,{target,preventDefault(){prevented=true;}}));assert.equal(prevented,true,'reply must not also open the property');
  }
});
test('media surface wrong direction, scrolling, cancellation and hold remain distinct',()=>{
  const h=gestureHarness(),p=h.render(),target={closest:()=>({getAttribute:()=> 'true'})};
  p.onPointerDown(h.event(0,0,{target}));p.onPointerMove(h.event(-120,0,{target}));p.onPointerUp(h.event(-120,0,{target}));assert.equal(h.counts().replies,0);
  p.onPointerDown(h.event(0,0,{target}));p.onPointerMove(h.event(2,40,{target}));p.onPointerMove(h.event(120,50,{target}));p.onPointerUp(h.event(120,50,{target}));assert.equal(h.counts().replies,0);
  p.onPointerDown(h.event(0,0,{target}));for(const fn of h.timers.values())fn();p.onPointerMove(h.event(120,0,{target}));p.onPointerUp(h.event(120,0,{target}));assert.deepEqual(h.counts(),{replies:0,opens:1,taps:0});
});
