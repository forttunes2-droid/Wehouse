"""Real browser media preparation using generated files, without a hosted upload."""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('QA_BASE_URL','http://127.0.0.1:4173')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(args=['--no-sandbox'])
  try:
   page=await browser.new_page();await page.goto(BASE+'/tests/browser/media-preparation.html');await page.wait_for_function('window.__mediaPreparation')
   result=await page.evaluate('''async()=>{
    const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=2000;const ctx=canvas.getContext('2d');
    const pixels=ctx.createImageData(canvas.width,canvas.height);let seed=12345;
    for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
    const original=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',1));
    const compressed=await window.__mediaPreparation.compressImageFile(new File([original],'property.jpg',{type:'image/jpeg'}),2560,.86,1.8*1024*1024);
    const decoded=await createImageBitmap(compressed);const photo={source_bytes:original.size,prepared_bytes:compressed.size,width:decoded.width,height:decoded.height,type:compressed.type};decoded.close();
    let invalidRejected=false;try{await window.__mediaPreparation.compressImageFile(new File(['not an image'],'broken.jpg',{type:'image/jpeg'}));}catch{invalidRejected=true;}
    return {photo,invalidRejected};
   }''')
   assert result['photo']['source_bytes']>2000000
   assert 0<result['photo']['prepared_bytes']<=1.8*1024*1024
   assert result['photo']['prepared_bytes']<result['photo']['source_bytes']
   assert max(result['photo']['width'],result['photo']['height'])<=2560
   assert result['photo']['type']=='image/jpeg' and result['invalidRejected']
   out=Path('test-results/experience');out.mkdir(parents=True,exist_ok=True);(out/'media-preparation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
  finally:await browser.close()
if __name__=='__main__':asyncio.run(main())
