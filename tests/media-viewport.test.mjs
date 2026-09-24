import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/mediaViewport.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const b = {width:400,height:600,imageWidth:400,imageHeight:400};
test('photo fit respects orientation and invalid sizes',()=>{
 assert.equal(exports.fittedImage(400,600,2000,1000).height,200);
 assert.equal(exports.fittedImage(600,400,1000,2000).width,200);
 assert.equal(exports.fittedImage(0,400,1000,2000).width,0);
});
test('zoom and panning never leave the image beyond its allowed bounds',()=>{
 const c=exports.boundedCamera({scale:3,x:9999,y:-9999},b);
 assert.equal(c.scale,3);assert.equal(c.x,400);assert.equal(c.y,-300);
 assert.equal(exports.boundedCamera({scale:.5,x:50,y:80},b).scale,1);
 assert.equal(exports.boundedCamera({scale:NaN,x:Infinity,y:NaN},b).x,0);
});
test('zoom retains the chosen point until an image edge requires clamping',()=>{
 const c=exports.zoomAt({scale:1,x:0,y:0},2,{x:50,y:0},b);
 assert.equal(c.x,-50);assert.equal(c.scale,2);
 const reset=exports.zoomAt(c,1,{x:0,y:0},b);assert.equal(reset.x,0);assert.equal(reset.y,0);
});
test('only an unzoomed single-finger horizontal gesture changes the gallery',()=>{
 assert.equal(exports.mediaSwipe(-100,10,false,false),1);
 assert.equal(exports.mediaSwipe(100,10,false,false),-1);
 for(const args of [[100,10,true,false],[100,10,false,true],[20,0,false,false],[100,150,false,false]])assert.equal(exports.mediaSwipe(...args),0);
});
test('media viewer owns native Back, focus and dynamic opaque viewport',()=>{
 const s=fs.readFileSync('src/components/MediaViewer.tsx','utf8');
 assert.match(s,/useRecordScreenBack\(props.onClose\)/);assert.match(s,/useDialogInteraction\(dismiss\)/);
 assert.match(s,/useVisualViewportFrame\(dialogRoot\)/);assert.doesNotMatch(s,/100svh|backdrop-blur/);
 assert.match(s,/ZoomablePhoto key=\{src\}/);
 assert.doesNotMatch(s,/user-scalable|maximum-scale/);
});

test('first-frame dialog input does not depend on a later effect or animation frame',()=>{
 const history=fs.readFileSync('src/hooks/useRecordScreenBack.ts','utf8');
 const dialog=fs.readFileSync('src/hooks/useDialogInteraction.ts','utf8');
 assert.match(history,/useLayoutEffect\(\(\) => \{[\s\S]*?bindProfileScreenHistory/);
 assert.match(dialog,/useLayoutEffect/);assert.doesNotMatch(dialog,/requestAnimationFrame/);
 assert.match(dialog,/focusables\(\)\[0\] \|\| root/);
});

test('image zoom remains functional without displaying a calculation',()=>{
 const photo=fs.readFileSync('src/components/ZoomablePhoto.tsx','utf8');
 assert.doesNotMatch(photo,/Math.round\(scale \* 100\)|aria-label="Image zoom"/);
 assert.match(photo,/data-photo-stage/);assert.match(photo,/aria-label="Zoom in"/);assert.match(photo,/aria-label="Reset image zoom"/);
});
