"""Build an installable ZIP using an explicit allowlist; never package vault data."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'manifest.json').read_text())
output = ROOT / 'dist'
output.mkdir(exist_ok=True)
files = ('main.js', 'styles.css', 'manifest.json', 'LICENSE')
archive = output / f"{manifest['id']}-{manifest['version']}.zip"
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in files:
        source = ROOT / name
        info = zipfile.ZipInfo(f"{manifest['id']}/{name}", (2026, 11, 5, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        z.writestr(info, source.read_bytes())
        shutil.copyfile(source, output / name)
with zipfile.ZipFile(archive) as z:
    expected = {f"{manifest['id']}/{name}" for name in files}
    assert set(z.namelist()) == expected
    assert z.testzip() is None
    for name in files:
        assert z.read(f"{manifest['id']}/{name}") == (ROOT / name).read_bytes()
checks = [archive, *(output / name for name in files)]
(output / 'SHA256SUMS.txt').write_text(''.join(
    f"{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in checks
))
print(f"Built {archive.name} ({archive.stat().st_size:,} bytes)")
print('ZIP contents: ' + ', '.join(sorted(expected)))
