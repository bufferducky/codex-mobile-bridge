#!/usr/bin/env python3
"""Exercise the actual Android notification entry method with isolated UI stubs."""
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.tmp/mobile-notification-links'
WORK.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'mobile/android/src/io/github/try2love/codexbridge/MainActivity.java').read_text()


def method(signature):
    start = source.index(signature)
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        if source[end] == '{': depth += 1
        if source[end] == '}': depth -= 1
        end += 1
    return source[start:end]


harness = r'''
import java.net.*;
import java.util.*;
import java.util.function.Consumer;
import io.github.try2love.codexbridge.GatewayURL;
public class NotificationLinkTests {
 String origin="https://one.example"; WebView web=new WebView(origin+"/"); int generation=1,connects;
 String connected=""; List<String> notices=new ArrayList<>();
 Set<String> saved(){return new HashSet<>(Arrays.asList("https://one.example","https://two.example","https://one.example/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));}
 String L(String s){return s;} void message(String s){notices.add(s);}
 void connect(String url){connects++;connected=url;web=new WebView(url);generation++;}
''' + method(' boolean openIntent(') + r'''
 static final String THREAD="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
 static Intent target(String origin,String thread){return new Intent(origin,thread,"local");}
 static void check(boolean yes,String message){if(!yes)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception {
  NotificationLinkTests f=new NotificationLinkTests();WebView existing=f.web;
  check(f.openIntent(target(f.origin,THREAD)),"accept saved notification");
  check(f.connects==0&&f.web==existing,"a warm notification must keep the existing WebView and drafts instead of reconnecting");
  check(existing.scripts.size()+existing.loads.size()==1,"warm entry must navigate exactly once");
  f=new NotificationLinkTests();f.web=null;check(f.openIntent(target(f.origin,THREAD))&&f.connects==1,"cold entry connects once");
  f=new NotificationLinkTests();check(f.openIntent(target("https://two.example",THREAD))&&f.connects==1,"different saved computer connects");
  f=new NotificationLinkTests();existing=f.web;check(!f.openIntent(target("https://unknown.example",THREAD)),"reject unsaved computer");check(f.web==existing&&f.connects==0,"unsaved link cannot destroy current view");
  f=new NotificationLinkTests();check(!f.openIntent(target(f.origin,"bad-thread"))&&f.connects==0,"reject malformed thread");
  f=new NotificationLinkTests();f.web.url="https://untrusted.example/";check(f.openIntent(target(f.origin,THREAD))&&f.connects==1,"untrusted current document cannot receive injected navigation");
  f=new NotificationLinkTests();f.web.url=f.origin+"/html-preview/shell";check(f.openIntent(target(f.origin,THREAD))&&f.connects==1,"preview document must not receive chat navigation");
  f=new NotificationLinkTests();check(f.openIntent(target("https://one.example/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",THREAD))&&f.connects==1,"relay identity must remain isolated");
  f=new NotificationLinkTests();existing=f.web;check(f.openIntent(target(f.origin,null))&&f.connects==0&&f.web==existing,"address-only notification keeps active computer");
  System.out.println("Android notification links: warm reuse, cold launch, computer/relay isolation and invalid target checks passed");
 }
}
class Intent {
 Map<String,String> values=new HashMap<>(); Uri data;
 Intent(String origin,String thread,String host){values.put("origin",origin);values.put("thread",thread);values.put("host",host);}
 String getStringExtra(String key){return values.get(key);} Uri getData(){return data;}
}
class Uri {
 URI value; Uri(String s){value=URI.create(s);}
 String getScheme(){return value.getScheme();} String getHost(){return value.getHost();}
 String getQueryParameter(String key)throws Exception {for(String pair:value.getRawQuery().split("&")){String[] parts=pair.split("=",2);if(parts[0].equals(key))return URLDecoder.decode(parts[1],"UTF-8");}return null;}
}
class WebView {
 String url;List<String> scripts=new ArrayList<>(),loads=new ArrayList<>();WebView(String url){this.url=url;}
 String getUrl(){return url;} void loadUrl(String url){loads.add(url);this.url=url;}
 void evaluateJavascript(String script,Consumer<String> callback){scripts.add(script);if(callback!=null)callback.accept("true");}
}
class JSONObject {static String quote(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}}
'''
(WORK / 'NotificationLinkTests.java').write_text(harness)
java_home = os.environ.get('JAVA_HOME')


def tool(name):
    return str(Path(java_home) / 'bin' / name) if java_home else shutil.which(name)


subprocess.run([tool('javac'), '-d', str(WORK), str(WORK / 'NotificationLinkTests.java'),
                str(ROOT / 'mobile/android/src/io/github/try2love/codexbridge/GatewayURL.java')], check=True)
subprocess.run([tool('java'), '-cp', str(WORK), 'NotificationLinkTests'], check=True, timeout=10)
