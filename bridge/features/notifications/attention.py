"""Ephemeral, authenticated foreground leases and local desktop attention."""
import re
import sys
import threading
import time


class Attention:
    LEASE_SECONDS = 25

    def __init__(self):
        self.lock = threading.Lock()
        self.viewers = {}

    @staticmethod
    def desktop_active():
        if sys.platform != 'darwin':
            return None
        from bridge.platforms.macos.attention import desktop_active
        return desktop_active()

    def update(self, owner, body, valid=lambda: True):
        if (not isinstance(body, dict) or set(body) != {'viewer', 'thread', 'host'}
                or not isinstance(body['viewer'], str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', body['viewer'])
                or not isinstance(body['host'], str) or len(body['host']) > 256
                or not isinstance(body['thread'], str) or len(body['thread']) > 256
                or bool(body['thread']) != bool(body['host'])):
            raise ValueError('前台聊天状态格式不正确')
        with self.lock:
            self._prune()
            key = (owner, body['viewer'])
            if not body['thread']:
                self.viewers.pop(key, None)
            else:
                if key not in self.viewers and len(self.viewers) >= 256:
                    raise ValueError('前台聊天连接过多')
                self.viewers[key] = (body['host'], body['thread'], time.monotonic() + self.LEASE_SECONDS, valid)

    def _prune(self):
        now = time.monotonic()
        for key, value in list(self.viewers.items()):
            if value[2] <= now or not value[3]():
                del self.viewers[key]

    def viewing(self, row):
        with self.lock:
            self._prune()
            return any(value[:2] == (row['host'], row['id']) for value in self.viewers.values())
