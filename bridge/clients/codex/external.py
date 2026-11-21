"""HTTP transport for the codexhost external-client endpoint.

Newer desktop builds publish request/event access over loopback HTTP instead of
the Unix IPC socket; older builds keep using DesktopIPC.
"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

TOKEN_PREFIX = 'chc_'
LOOPBACK = 'http://127.0.0.1:'
CREDENTIALS_ENV = 'CODEXHOST_CLI_CREDENTIALS'
MAX_BODY = 64 * 1024 * 1024


class ExternalUnavailable(Exception):
    pass


def credentials_path():
    configured = os.environ.get(CREDENTIALS_ENV)
    if configured:
        return Path(configured).expanduser()
    return Path.home() / '.codexhost' / 'cli-credentials.json'


def discover():
    """Return (endpoint, token) for the running host runtime, or None."""
    try:
        published = json.loads(credentials_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(published, dict):
        return None
    endpoint = str(published.get('endpoint') or '').strip()
    token = str(published.get('token') or '').strip()
    if not endpoint.startswith(LOOPBACK) or not token.startswith(TOKEN_PREFIX):
        return None
    return endpoint, token


class ExternalClient:
    """Loopback HTTP requests plus the /v1/events server-sent stream."""

    def __init__(self, endpoint, token, on_event=None, on_disconnect=None):
        self.endpoint = endpoint.rstrip('/')
        self.token = token
        self.on_event = on_event or (lambda event: None)
        self.on_disconnect = on_disconnect or (lambda: None)
        self.stream = None
        self.cursor = 0
        self.closed = False

    # Proxy handlers leak loopback traffic into system proxies; keep it direct.
    def _opener(self):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def call(self, route, body=None, timeout=15):
        if self.closed:
            raise ExternalUnavailable('桌面连接已断开')
        data = json.dumps(body or {}, separators=(',', ':')).encode()
        if len(data) > MAX_BODY:
            raise ExternalUnavailable('消息过大')
        request = urllib.request.Request(self.endpoint + route, data=data, method='POST')
        request.add_header('Authorization', 'Bearer ' + self.token)
        request.add_header('Content-Type', 'application/json')
        try:
            with self._opener().open(request, timeout=timeout) as response:
                payload = response.read(MAX_BODY)
        except urllib.error.HTTPError as exc:
            raise ExternalUnavailable(_error_text(exc)) from exc
        except OSError as exc:
            raise ExternalUnavailable('桌面连接已断开；请检查会话后再决定是否重发。') from exc
        if not payload:
            return {}
        try:
            return json.loads(payload)
        except ValueError as exc:
            raise ExternalUnavailable('桌面响应无法解析') from exc

    def open_events(self, after=0, timeout=15):
        """Start the event stream; frames are delivered through on_event."""
        request = urllib.request.Request(f'{self.endpoint}/v1/events?after={int(after)}')
        request.add_header('Authorization', 'Bearer ' + self.token)
        request.add_header('Accept', 'text/event-stream')
        try:
            self.stream = self._opener().open(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            raise ExternalUnavailable(_error_text(exc)) from exc
        except OSError as exc:
            raise ExternalUnavailable('桌面事件流不可用') from exc
        return self.stream

    def read_events(self, stream):
        """Yield (event, data) pairs until the stream ends."""
        name = ''
        payload = []
        for raw in stream:
            line = raw.decode('utf-8', 'replace').rstrip('\r\n')
            if not line:
                if payload:
                    yield name or 'message', _json(payload)
                name, payload = '', []
                continue
            if line.startswith(':'):
                continue
            field, _, value = line.partition(':')
            value = value[1:] if value.startswith(' ') else value
            if field == 'event':
                name = value
            elif field == 'data':
                payload.append(value)
            elif field == 'id':
                try:
                    self.cursor = int(value)
                except ValueError:
                    pass

    def close(self):
        self.closed = True
        stream, self.stream = self.stream, None
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def _json(lines):
    try:
        return json.loads('\n'.join(lines))
    except ValueError:
        return {'raw': '\n'.join(lines)}


def _error_text(exc):
    try:
        body = json.loads(exc.read(4096).decode('utf-8', 'replace'))
        message = body.get('error', {}).get('message')
        if message:
            return str(message)
    except (OSError, ValueError, AttributeError):
        pass
    return f'桌面请求失败（HTTP {exc.code}）'
