"""Real Chromium encode/decode of an oversized public video, without Storage access."""
import asyncio
import base64
import json
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    fixture = Path('test-results/experience/compression-input.mp4')
    fixture.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
        '-vf', 'noise=alls=60:allf=t+u', '-t', '15',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '25M',
        '-maxrate', '25M', '-bufsize', '50M', '-an', str(fixture),
    ], check=True)
    assert 45_000_000 < fixture.stat().st_size <= 50_000_000, 'The input must resemble a 50 MB upload'
    chat_fixture = Path('test-results/experience/chat-compression-input.mp4')
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
        '-vf', 'noise=alls=60:allf=t+u', '-t', '15',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M',
        '-maxrate', '12M', '-bufsize', '24M', '-an', str(chat_fixture),
    ], check=True)
    assert 2_000_000 < chat_fixture.stat().st_size <= 25_000_000
    longer_fixture = Path('test-results/experience/longer-compression-input.mp4')
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
        '-vf', 'noise=alls=60:allf=t+u', '-t', '30',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8M',
        '-maxrate', '8M', '-bufsize', '16M', '-an', str(longer_fixture),
    ], check=True)
    assert 5_000_000 < longer_fixture.stat().st_size <= 50_000_000
    audio_fixture = Path('test-results/experience/work-post-original-sound.wav')
    subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=4',str(audio_fixture)],check=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        page = await browser.new_page()
        await page.goto('http://127.0.0.1:4173/tests/browser/experience.html')
        for kind, source_path in [('public', fixture.name), ('chat', chat_fixture.name), ('longer', longer_fixture.name)]:
          result = await page.evaluate('''async ({ kind, sourcePath }) => {
          const { preparePublicVideo, prepareChatVideo, PUBLIC_VIDEO_MAX_BYTES, CHAT_VIDEO_MAX_BYTES, videoTargetBytes } = await import('/src/lib/mediaVideo.ts');
          const source = await (await fetch('/test-results/experience/' + sourcePath)).blob();
          const prepared = await (kind === 'chat' ? prepareChatVideo : preparePublicVideo)(new File([source], 'oversized.mp4', { type: 'video/mp4' }));
          const url = URL.createObjectURL(prepared.body);
          try {
            const video = document.createElement('video');
            video.preload = 'metadata';
            await new Promise((resolve, reject) => {
              video.onloadedmetadata = resolve;
              video.onerror = () => reject(new Error('The compressed output cannot play'));
              video.src = url;
            });
            const encoded = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(',')[1]);
              reader.onerror = () => reject(new Error('Could not save compressed video'));
              reader.readAsDataURL(prepared.body);
            });
            return { input: source.size, output: prepared.body.size, cap: kind === 'chat' ? CHAT_VIDEO_MAX_BYTES : PUBLIC_VIDEO_MAX_BYTES,
              target: videoTargetBytes(video.duration),
              type: prepared.contentType, extension: prepared.extension, duration: video.duration, encoded };
          } finally { URL.revokeObjectURL(url); }
        }''', { 'kind': kind, 'sourcePath': source_path })
          encoded = result.pop('encoded')
          assert 0 < result['output'] <= result['target'] <= result['cap'], result
          assert result['output'] < result['input'], result
          assert abs(result['target'] - (4_000_000 if kind == 'longer' else 2_000_000)) < 20_000, result
          assert result['duration'] > 10, result
          assert result['type'] in ('video/mp4', 'video/webm'), result
          saved = Path(f'test-results/experience/{kind}-compressed.{result["extension"]}')
          saved.write_bytes(base64.b64decode(encoded))
          assert saved.stat().st_size == result['output']
          print(f'{kind} video browser compression:', result)
        edited = await page.evaluate('''async () => {
          const { editWorkPostVideo } = await import('/src/lib/workPostVideoEditor.ts');
          const source=await (await fetch('/test-results/experience/chat-compression-input.mp4')).blob();
          const audio=await (await fetch('/test-results/experience/work-post-original-sound.wav')).blob();
          const prepared=await editWorkPostVideo(new File([source],'work.mp4',{type:'video/mp4'}),2,5,
            new File([audio],'owned-sound.wav',{type:'audio/wav'}),0.5);
          const reader=new FileReader();
          const encoded=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(prepared.body);});
          return {size:prepared.body.size,extension:prepared.extension,encoded};
        }''')
        edited_path=Path(f'test-results/experience/work-post-edited.{edited["extension"]}')
        edited_path.write_bytes(base64.b64decode(edited['encoded']))
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type','-of','json',str(edited_path)]))
        assert 2.4 < float(probe['format']['duration']) < 4.0,probe
        assert {'video','audio'}.issubset({stream['codec_type'] for stream in probe['streams']}),probe
        print('work-post trim and owned audio browser edit:',{'bytes':edited['size'],'duration':probe['format']['duration']})
        await browser.close()


asyncio.run(main())
