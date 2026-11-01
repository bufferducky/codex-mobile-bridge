#!/usr/bin/env python3
"""Exercise Android's actual theme reporting method with isolated Java UI stubs."""
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.tmp/mobile-theme'
WORK.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'mobile/android/src/io/github/try2love/codexbridge/MainActivity.java').read_text()


def method(signature):
    start = source.index(signature)
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        if source[end] == '{':
            depth += 1
        if source[end] == '}':
            depth -= 1
        end += 1
    return source[start:end]


configuration = WORK / 'android/content/res/Configuration.java'
configuration.parent.mkdir(parents=True, exist_ok=True)
configuration.write_text('''package android.content.res;
public class Configuration {
 public static final int UI_MODE_NIGHT_MASK=0x30, UI_MODE_NIGHT_NO=0x10, UI_MODE_NIGHT_YES=0x20;
 public int uiMode;
}
''')
harness = r'''
import java.util.*;
import java.util.function.Consumer;
import io.github.try2love.codexbridge.GatewayURL;
public class SystemThemeTests {
 String origin="https://one.example";WebView web=new WebView(origin+"/");
 Resources resources=new Resources();Resources getResources(){return resources;}
''' + method(' void reportSystemTheme(') + r'''
 static void check(boolean yes,String message){if(!yes)throw new AssertionError(message);}
 public static void main(String[] args){
  SystemThemeTests f=new SystemThemeTests();
  f.resources.configuration.uiMode=0x20|0x01;f.reportSystemTheme();
  check(f.web.scripts.get(0).contains("BridgeNativeColorScheme=\"dark\"")&&f.web.scripts.get(0).contains("bridge-native-theme"),"real Android night bit must report dark even with other UI bits set");
  f.resources.configuration.uiMode=0x10|0x01;f.reportSystemTheme();
  check(f.web.scripts.get(1).contains("BridgeNativeColorScheme=\"light\""),"system light mode must report light");
  f.web.url="https://untrusted.example/";f.reportSystemTheme();
  check(f.web.scripts.size()==2,"foreign document must not receive injection");
  f.web=null;f.reportSystemTheme();
  f.web=new WebView("https://one.example/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/");
  f.origin="https://one.example/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  f.resources.configuration.uiMode=0x20;f.reportSystemTheme();
  check(f.web.scripts.size()==1,"current relay page receives system theme");
  f.web.url="https://one.example/d/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/";f.reportSystemTheme();
  check(f.web.scripts.size()==1,"another relay identity must not receive injection");
  System.out.println("Android system theme: dark/light configuration, null WebView, origin and relay isolation passed");
 }
}
class Resources {
 android.content.res.Configuration configuration=new android.content.res.Configuration();
 android.content.res.Configuration getConfiguration(){return configuration;}
}
class WebView {
 String url;List<String> scripts=new ArrayList<>();WebView(String value){url=value;}
 String getUrl(){return url;}void evaluateJavascript(String script,Consumer<String> callback){scripts.add(script);}
}
class JSONObject {static String quote(String s){return "\""+s+"\"";}}
'''
(WORK / 'SystemThemeTests.java').write_text(harness)
java_home = os.environ.get('JAVA_HOME')


def tool(name):
    return str(Path(java_home) / 'bin' / name) if java_home else shutil.which(name)


subprocess.run([tool('javac'), '-d', str(WORK), str(configuration), str(WORK / 'SystemThemeTests.java'),
                str(ROOT / 'mobile/android/src/io/github/try2love/codexbridge/GatewayURL.java')], check=True)
subprocess.run([tool('java'), '-cp', str(WORK), 'SystemThemeTests'], check=True, timeout=10)
