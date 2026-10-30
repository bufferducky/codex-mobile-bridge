#!/usr/bin/env python3
"""Build a local debug APK using project-local JDK/SDK; never installs tools."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, default=ROOT/'dist/mobile-preview')
parser.add_argument('--dev-app', action='store_true', help='Build a separately signed Codex Bridge Dev app, alongside the original app')
options = parser.parse_args()
tools = ROOT/'.tmp/mobile-tools'
jdks = list((tools/'jdk').glob('*/Contents/Home'))
if not jdks:
    raise SystemExit('Place a JDK 17 in .tmp/mobile-tools/jdk first.')
jdk = jdks[0]
sdk = tools/'sdk'
build_tools = next(p for p in (sdk/'build-tools').iterdir() if (p/'aapt2').exists())
android = next((sdk/'platforms').glob('*/android.jar'))
zxing = tools/'zxing-core-3.5.3.jar'
if hashlib.sha1(zxing.read_bytes()).hexdigest() != (tools/'zxing.sha1').read_text().strip():
    raise SystemExit('ZXing checksum mismatch')
work = ROOT/'.tmp/mobile-preview/android-build'
work.mkdir(parents=True, exist_ok=True)
for name in ('gen', 'classes', 'dex'):
    folder = work/name
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir()
env = {**os.environ, 'JAVA_HOME': str(jdk), 'PATH': str(jdk/'bin')+os.pathsep+os.environ['PATH']}
def run(*args):
    subprocess.run([str(a) for a in args], env=env, check=True, cwd=ROOT)
source = ROOT/'mobile/android'
manifest = source/'AndroidManifest.xml'
if options.dev_app:
    namespace = 'http://schemas.android.com/apk/res/android'
    ElementTree.register_namespace('android', namespace)
    tree = ElementTree.parse(manifest)
    package = 'io.github.bufferducky.codexbridge.dev'
    tree.getroot().set('package', package)
    application = tree.getroot().find('application')
    application.set('{'+namespace+'}label', 'Codex Bridge Dev')
    for provider in application.findall('provider'):
        provider.set('{'+namespace+'}authorities', package+'.downloads')
    manifest = work/'AndroidManifest.xml'
    tree.write(manifest, encoding='utf-8', xml_declaration=True)
run(build_tools/'aapt2','compile','--dir',source/'res','-o',work/'resources.zip')
run(build_tools/'aapt2','link','-I',android,'--manifest',manifest,'--java',work/'gen','-o',work/'base.apk',work/'resources.zip')
java = list((source/'src').rglob('*.java')) + list((work/'gen').rglob('*.java'))
run(jdk/'bin/javac','-encoding','UTF-8','--release','8','-classpath',str(android)+os.pathsep+str(zxing),'-d',work/'classes',*java)
run(build_tools/'d8','--lib',android,'--min-api','26','--output',work/'dex',*list((work/'classes').rglob('*.class')),zxing)
shutil.copy2(work/'base.apk',work/'unsigned.apk')
with zipfile.ZipFile(work/'unsigned.apk','a') as archive:
    for path in (work/'dex').glob('*.dex'):
        archive.write(path,path.name)
    for directory in (ROOT/'mobile/shared/web', source/'assets', ROOT/'web/client-icons'):
        for asset in directory.glob('*.js'):
            archive.write(asset,'assets/'+asset.name)
    for provider in ('codex', 'claude', 'deepseek'):
        archive.write(ROOT/'web/client-icons'/f'{provider}.png', 'assets/'+provider+'.png')
    archive.write(ROOT/'mobile/NOTICE.md','assets/NOTICE.md')
    archive.write(ROOT/'mobile/licenses/ZXing-LICENSE.txt','assets/ZXing-LICENSE.txt')
key = ROOT/'.local/android-signing/dev-debug.p12' if options.dev_app else tools/'preview-debug.p12'
key.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
if not key.exists():
    run(jdk/'bin/keytool','-genkeypair','-keystore',key,'-storepass','android','-keypass','android','-alias','preview','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=Bridge Local Preview')
key.chmod(0o600)
run(build_tools/'zipalign','-f','4',work/'unsigned.apk',work/'aligned.apk')
out = options.output_dir.resolve()
out.mkdir(parents=True,exist_ok=True)
version = json.loads((ROOT/'package.json').read_text())['version']
apk = out/('Codex-Mobile-Bridge-'+version+('-Dev' if options.dev_app else '')+'-Android.apk')
run(build_tools/'apksigner','sign','--ks',key,'--ks-pass','pass:android','--out',apk,work/'aligned.apk')
run(build_tools/'apksigner','verify','--verbose',apk)
print(apk)
print('SHA-256',hashlib.sha256(apk.read_bytes()).hexdigest())
