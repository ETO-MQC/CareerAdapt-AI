"""Synthetic fixtures only. Never removes files or directories."""
import os, pathlib, secrets, json, hashlib, mimetypes
from PIL import Image, ImageDraw, ImageFont
root=pathlib.Path.cwd()/'.artifacts/p522-host-a02-03/fixtures'
root.mkdir(parents=True,exist_ok=True)
assert not (root/'manifest.local.json').exists(), 'Preserve previous fixtures; use a new root rather than overwriting'
markers={k:'A02_'+k.upper()+'_'+secrets.token_hex(5).upper() for k in ['txt','png','pdf','folder']}
(root/'sample.txt').write_text((markers['txt']+'\n'+'Synthetic attachment qualification. No personal data.\n'*42)[:2048],encoding='utf8')
im=Image.new('RGB',(256,256),'white');d=ImageDraw.Draw(im)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',19)
for i,line in enumerate([markers['png'][:8],markers['png'][8:],'SYNTHETIC ONLY']):d.text((8,55+i*45),line,font=font,fill='black')
im.save(root/'image.png')
# Minimal standalone PDF with an independent marker; no document author metadata.
stream=('BT /F1 18 Tf 40 740 Td ('+markers['pdf']+') Tj ET').encode()
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
pdf=b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';offsets=[0]
for i,obj in enumerate(objects,1):offsets.append(len(pdf));pdf+=str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
xref=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets[1:])+f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(root/'sample.pdf').write_bytes(pdf)
(root/'unsupported.xyz').write_bytes(b'\x00\xffSYNTHETIC_UNSUPPORTED')
(root/'empty.txt').write_bytes(b'')
(root/'corrupt.png').write_bytes(b'not a valid PNG\x00')
(root/'folder').mkdir();(root/'folder/inside.txt').write_text(markers['folder'],encoding='utf8');(root/'empty-folder').mkdir()
records=[]
for f in root.rglob('*'):
 if f.is_file():
  b=f.read_bytes();kind='png' if f.name=='image.png' else 'pdf' if f.suffix=='.pdf' else 'folder' if f.name=='inside.txt' else 'txt' if f.name=='sample.txt' else None
  records.append(dict(filename=f.relative_to(root).as_posix(),MIME=mimetypes.guess_type(f.name)[0] or 'application/octet-stream',byte_length=len(b),base64_length=4*((len(b)+2)//3),sha256=hashlib.sha256(b).hexdigest(),synthetic_marker=markers.get(kind),expected_content_hash=hashlib.sha256(b).hexdigest(),expected_route='image.attach' if f.suffix=='.png' else 'file.attach/@file'))
manifest=dict(synthetic=True,records=records,markers=markers)
(root/'manifest.local.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
out=pathlib.Path('docs/architecture/evidence/p522-host-a02-03');out.mkdir(parents=True,exist_ok=True)
(out/'attachment-fixture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({'syntheticFiles':len(records)}))
