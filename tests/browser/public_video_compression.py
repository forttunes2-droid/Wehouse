"""Real Chromium encode/decode of an oversized public video, without Storage access."""
import asyncio
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
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '26M',
        '-maxrate', '26M', '-bufsize', '52M', '-an', str(fixture),
    ], check=True)
    assert 45 * 1024 * 1024 < fixture.stat().st_size <= 50 * 1024 * 1024, 'The input must resemble a 50 MB upload'
    chat_fixture = Path('test-results/experience/chat-compression-input.mp4')
    subprocess.run([
        'ffmpeg', '-nostdin', '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
        '-vf', 'noise=alls=60:allf=t+u', '-t', '15',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M',
        '-maxrate', '12M', '-bufsize', '24M', '-an', str(chat_fixture),
    ], check=True)
    assert 2 * 1024 * 1024 < chat_fixture.stat().st_size <= 25 * 1024 * 1024
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        page = await browser.new_page()
        await page.goto('http://127.0.0.1:4173/tests/browser/experience.html')
        for kind, source_path in [('public', fixture.name), ('chat', chat_fixture.name)]:
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
            return { input: source.size, output: prepared.body.size, cap: kind === 'chat' ? CHAT_VIDEO_MAX_BYTES : PUBLIC_VIDEO_MAX_BYTES,
              target: videoTargetBytes(video.duration),
              type: prepared.contentType, duration: video.duration };
          } finally { URL.revokeObjectURL(url); }
        }''', { 'kind': kind, 'sourcePath': source_path })
          assert 0 < result['output'] <= result['target'] <= result['cap'], result
          assert result['output'] < result['input'], result
          assert result['target'] == 2 * 1024 * 1024, result
          assert result['duration'] > 10, result
          assert result['type'] in ('video/mp4', 'video/webm'), result
          print(f'{kind} video browser compression:', result)
        await browser.close()


asyncio.run(main())
