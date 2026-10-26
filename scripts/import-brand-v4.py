"""Import the owner's supplied vector pack without tracing or redrawing it."""
import argparse,hashlib,json,zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

parser=argparse.ArgumentParser();parser.add_argument('archive');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
destination=root/'public/brand/v4';destination.mkdir(parents=True,exist_ok=True)
archive=Path(args.archive);imported={}
with zipfile.ZipFile(archive) as source:
 for name in source.namelist():
  if Path(name).name!=name or not (name.endswith('.svg') or name.startswith('app-icon-') and name.endswith('.png')):continue
  data=source.read(name)
  if name.endswith('.svg'):
   artwork=ET.fromstring(data)
   for node in artwork.iter():
    if node.tag.rsplit('}',1)[-1] in ('script','foreignObject'):raise ValueError('Unexpected active SVG content')
    if any(k.lower().startswith('on') or k.endswith('href') and not v.startswith('#') for k,v in node.attrib.items()):raise ValueError('Unexpected external SVG reference')
  (destination/name).write_bytes(data);imported[name]=hashlib.sha256(data).hexdigest()
 aliases={'app-icon.svg':'wehouse-app-icon.svg','brand-mark-light.svg':'wehouse-symbol-primary.svg','brand-mark-dark.svg':'wehouse-symbol-white.svg','brand-horizontal-dark.svg':'wehouse-lockup-dark.svg','brand-lockup-dark.svg':'wehouse-lockup-tagline-dark.svg','brand-mask.svg':'wehouse-symbol-black.svg','icon-512.png':'app-icon-512.png'}
 for alias,name in aliases.items():(root/'public'/alias).write_bytes(source.read(name))

# Platform wrapper only: original artwork is inset into the maskable safe area.
original=ET.fromstring((destination/'wehouse-app-icon.svg').read_bytes())
inner=''.join(ET.tostring(child,encoding='unicode') for child in original)
(destination/'wehouse-maskable.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#0B0912"/><g transform="translate(32 32) scale(.75)">'+inner+'</g></svg>',encoding='utf-8')
(destination/'source.json').write_text(json.dumps({'source':'wehouse-brand-v4-complete.zip','archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'original_files':imported,'platform_wrapper':'wehouse-maskable.svg'},indent=2)+'\n',encoding='utf-8')
print(f'Imported {len(imported)} original V4 files; artwork hashes recorded in source.json')
