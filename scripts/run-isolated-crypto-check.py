"""Run only the small crypto fixture in an OS-enforced disposable CI sandbox."""
import os
import json
import re
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
SOURCES=('src/lib/e2ee.ts','src/lib/privateMessageText.ts','src/lib/privateDeviceKeys.ts','src/lib/privatePasskeyBackup.ts','src/lib/privateMessagingSession.ts','src/lib/byteCache.ts','tests/security/private-messaging-key-lifecycle.mjs')

def main():
    if os.name!='posix' or os.environ.get('GITHUB_ACTIONS')!='true':
        raise RuntimeError('Crypto fixture execution is restricted to the isolated disposable CI runner')
    image=subprocess.check_output(['docker','inspect','--format','{{.Image}}','supabase_db_wehouse'],text=True).strip()
    if not image.startswith('sha256:') or len(image)!=71:
        raise RuntimeError('The existing disposable database image was not identified')
    node=Path(shutil.which('node') or '').resolve()
    if not node.is_file():
        raise RuntimeError('The existing Node toolchain is unavailable')
    # The existing database image can use musl, while setup-node uses glibc.
    # Bind only the installed toolchain's system dependencies, never a host tree.
    linkage=subprocess.check_output(['ldd',str(node)],text=True)
    libraries=[];loader=None;names=set()
    for line in linkage.splitlines():
        match=re.search(r'(?:=>\s+)?(/[^\s,]+)\s+\(',line)
        if not match:continue
        declared=match.group(1);source=Path(declared).resolve()
        if not declared.startswith(('/lib/','/lib64/','/usr/lib/','/usr/lib64/')) or not source.is_file() or source.stat().st_size>50000000:
            raise RuntimeError('Unexpected system dependency in the installed Node toolchain')
        name=Path(declared).name
        if name in names:continue
        names.add(name)
        # Preserve the requested SONAME (e.g. libstdc++.so.6), even when its
        # trusted host symlink resolves to a versioned libstdc++.so.6.0.xx file.
        libraries+=['--mount',f'type=bind,src={source},dst=/toolchain/lib/{name},readonly']
        if 'ld-linux' in Path(declared).name:
            loader=declared
            libraries+=['--mount',f'type=bind,src={source},dst={declared},readonly']
    if not loader or len(names)>16:
        raise RuntimeError('The existing Node dynamic loader could not be bounded')
    with tempfile.TemporaryDirectory(prefix='wehouse-crypto-',dir=os.environ['RUNNER_TEMP']) as temporary:
        target=Path(temporary)/'target';target.mkdir()
        for relative in SOURCES:
            source=ROOT/relative
            if source.is_symlink() or not source.is_file() or source.stat().st_size>150000:
                raise RuntimeError('Unexpected source entry in the crypto fixture allowlist')
            destination=target/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
        name='wehouse-crypto-'+uuid.uuid4().hex
        volumes=json.loads(subprocess.check_output(['docker','image','inspect','--format','{{json .Config.Volumes}}',image],text=True)) or {}
        masks=[]
        for volume in volumes:
            if not volume.startswith('/') or '..' in volume.split('/') or volume in ('/','/target','/toolchain','/scratch'):
                raise RuntimeError('Unexpected image volume in the isolated fixture')
            masks+=['--tmpfs',volume+':ro,nosuid,nodev,size=1m']
        command=['docker','run','--rm','--pull','never','--name',name,'--network','none','--ipc','none','--read-only','--user','65534:65534',
                 '--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','384m','--memory-swap','384m',
                 '--pids-limit','32','--ulimit','nofile=128:128','--ulimit','fsize=1048576:1048576',
                 *masks,*libraries,
                 '--tmpfs','/scratch:rw,nosuid,nodev,size=32m,mode=1777','--mount',f'type=bind,src={target},dst=/target,readonly',
                 '--mount',f'type=bind,src={node},dst=/toolchain/node,readonly','--workdir','/target','--entrypoint','/usr/bin/env',image,
                 '-i','PATH=/toolchain:/usr/bin:/bin','HOME=/scratch','TMPDIR=/scratch','LD_LIBRARY_PATH=/toolchain/lib',
                 '/toolchain/node','--max-old-space-size=192','--test','tests/security/private-messaging-key-lifecycle.mjs']
        process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        output=bytearray();deadline=time.monotonic()+75;selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ)
        try:
            while selector.get_map():
                if time.monotonic()>deadline:raise RuntimeError('Crypto fixture exceeded its 75-second wall-clock budget')
                for key,_ in selector.select(timeout=1):
                    chunk=os.read(key.fd,4096)
                    if not chunk:selector.unregister(key.fileobj);continue
                    output.extend(chunk)
                    if len(output)>65536:raise RuntimeError('Crypto fixture exceeded its output budget')
            code=process.wait(timeout=max(1,deadline-time.monotonic()))
            print(output.decode('utf-8',errors='replace'))
            if code:raise RuntimeError('The isolated crypto fixture failed')
        finally:
            selector.close()
            subprocess.run(['docker','rm','--force',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
            if process.poll() is None:process.kill();process.wait(timeout=5)

if __name__=='__main__':main()
