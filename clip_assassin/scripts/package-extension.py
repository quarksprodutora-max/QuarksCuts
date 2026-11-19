"""Gera atualização CEP sem credenciais, backups, caches ou binários locais."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
target = root / 'dist' / 'quarks-cuts-update.zip'
target.parent.mkdir(exist_ok=True)
files = [root / name for name in ('index.html','CSInterface.js','audio-analysis.js','README.md','Clip_assassin.png','Icone Quarks Podcast Branco.png')]
for folder, pattern in [('CSXS','*.xml'),('jsx','*.jsx'),('engine','*.js'),('presets','*'),('scripts','*.py'),('tests','*.js')]:
    files.extend(p for p in (root / folder).glob(pattern) if p.is_file())
files.append(root / 'engine' / 'config.example.json')
with ZipFile(target, 'w', ZIP_DEFLATED) as package:
    for file in files:
        package.write(file, file.relative_to(root))
print(target)
