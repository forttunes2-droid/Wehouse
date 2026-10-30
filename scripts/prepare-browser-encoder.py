"""Provide a pinned QA encoder without a large Ubuntu multimedia-package install."""
import os,shutil,subprocess,sys
from pathlib import Path

encoder=shutil.which('ffmpeg')
if not encoder:
 subprocess.run([sys.executable,'-m','pip','install','--only-binary=:all:','--no-deps',
  '--disable-pip-version-check','--timeout','30','--retries','2','imageio-ffmpeg==0.6.0'],check=True,timeout=240)
 import imageio_ffmpeg
 encoder=imageio_ffmpeg.get_ffmpeg_exe()
 tools=Path(os.environ['RUNNER_TEMP'])/'wehouse-qa-tools';tools.mkdir(exist_ok=True)
 link=tools/'ffmpeg'
 if not link.exists():link.symlink_to(encoder)
 with open(os.environ['GITHUB_PATH'],'a',encoding='utf-8') as path_file:path_file.write(str(tools)+'\n')
subprocess.run([encoder,'-version'],check=True,timeout=15,stdout=subprocess.DEVNULL)
print('QA video encoder is ready')
