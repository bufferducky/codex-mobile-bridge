import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from bridge.features.notifications.attention import Attention
from bridge.features.notifications.channels import Notifications, settings
from bridge.platforms.macos.attention import desktop_active

ROOT = Path(__file__).resolve().parents[1]
THREAD = '11111111-1111-4111-8111-111111111111'


class ForegroundLeaseTests(unittest.TestCase):
    def setUp(self):
        self.attention = Attention()
        self.body = {'viewer': 'a'*32, 'thread': THREAD, 'host': 'local'}
        self.row = {'host': 'local', 'id': THREAD}

    def test_lease_matches_chat_and_host_and_expires_without_background_callback(self):
        with patch('bridge.features.notifications.attention.time.monotonic', return_value=100) as now:
            self.attention.update('owner', self.body)
            self.assertTrue(self.attention.viewing(self.row))
            self.assertFalse(self.attention.viewing({**self.row, 'host': 'remote'}))
            self.assertFalse(self.attention.viewing({**self.row, 'id': 'another'}))
            now.return_value = 124.9
            self.assertTrue(self.attention.viewing(self.row))
            now.return_value = 125
            self.assertFalse(self.attention.viewing(self.row))

    def test_switch_background_and_revoked_login_stop_silencing(self):
        valid = Mock(return_value=True)
        self.attention.update('owner', self.body, valid)
        self.attention.update('owner', {**self.body, 'host': 'remote'}, valid)
        self.assertFalse(self.attention.viewing(self.row))
        self.attention.update('owner', self.body, valid)
        valid.return_value = False
        self.assertFalse(self.attention.viewing(self.row))
        self.attention.update('owner', self.body)
        self.attention.update('owner', {**self.body, 'host': '', 'thread': ''})
        self.assertFalse(self.attention.viewing(self.row))

    def test_two_viewers_do_not_clear_each_other(self):
        self.attention.update('owner', self.body)
        other = {**self.body, 'viewer': 'b'*32}
        self.attention.update('owner', other)
        self.attention.update('owner', {**self.body, 'host': '', 'thread': ''})
        self.assertTrue(self.attention.viewing(self.row))
        self.attention.update('owner', {**other, 'host': '', 'thread': ''})
        self.assertFalse(self.attention.viewing(self.row))

    def test_malformed_or_excessive_presence_does_not_create_a_lease(self):
        for bad in (None, {}, {**self.body, 'thread': 3}, {**self.body, 'host': ''}, {**self.body, 'viewer': 'x'}, {**self.body, 'extra': True}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.attention.update('owner', bad)
        with patch('bridge.features.notifications.attention.time.monotonic', return_value=100):
            for i in range(256):
                self.attention.update(str(i), self.body)
            with self.assertRaises(ValueError):
                self.attention.update('overflow', self.body)

    def test_other_operating_systems_keep_ordinary_notifications(self):
        for platform in ('linux', 'win32'):
            with patch('bridge.features.notifications.attention.sys.platform', platform):
                self.assertIsNone(self.attention.desktop_active())

    def test_foreground_lease_alone_is_not_a_completion_receipt(self):
        self.attention.update('owner', self.body)
        self.assertTrue(self.attention.viewing(self.row))
        self.assertFalse(self.attention.seen_completion(self.row, 'turn'))
        self.attention.update('owner', {**self.body, 'completed': ['turn']})
        self.assertTrue(self.attention.seen_completion(self.row, 'turn'))
        self.assertFalse(self.attention.seen_completion({**self.row, 'host': 'remote'}, 'turn'))
        self.assertFalse(self.attention.seen_completion(self.row, 'other'))
        self.attention.update('owner', {**self.body, 'host': '', 'thread': ''})
        self.assertFalse(self.attention.viewing(self.row))
        self.assertTrue(self.attention.seen_completion(self.row, 'turn'))

    def test_receipt_expiry_and_revoked_login_do_not_silence_unseen_results(self):
        valid = Mock(return_value=True)
        with patch('bridge.features.notifications.attention.time.monotonic', return_value=100) as now:
            self.attention.update('owner', {**self.body, 'completed': ['turn']}, valid)
            valid.return_value = False
            self.assertFalse(self.attention.seen_completion(self.row, 'turn'))
            valid.return_value = True
            self.attention.update('owner', {**self.body, 'completed': ['turn']}, valid)
            now.return_value = 401
            self.assertFalse(self.attention.seen_completion(self.row, 'turn'))

    def test_completion_receipts_are_bounded_and_require_a_chat(self):
        for completed in ('turn', [1], [''], ['x'*257], ['turn']*65):
            with self.subTest(completed=completed), self.assertRaises(ValueError):
                self.attention.update('owner', {**self.body, 'completed': completed})
        with self.assertRaises(ValueError):
            self.attention.update('owner', {**self.body, 'host': '', 'thread': '', 'completed': ['turn']})


class MacAttentionTests(unittest.TestCase):
    def native(self, *, console=1, logged_in=1, locked=None, idle=0, session=42):
        # Boolean pointers: 1 = CF true, 2 = CF false, None = absent key.
        values = {b'kCGSSessionOnConsoleKey': console, b'kCGSessionLoginDoneKey': logged_in,
                  b'CGSSessionScreenIsLocked': locked}
        cf = SimpleNamespace(CFStringCreateWithCString=lambda _, key, encoding: key,
                             CFDictionaryGetValue=lambda _, key: values.get(key),
                             CFBooleanGetValue=lambda value: value == 1, CFRelease=Mock())
        cg = SimpleNamespace(CGSessionCopyCurrentDictionary=lambda: session,
                             CGEventSourceSecondsSinceLastEventType=lambda *_: idle)
        with patch('bridge.platforms.macos.attention._frameworks', return_value=(cg, cf)):
            result = desktop_active()
        if session:
            cf.CFRelease.assert_any_call(session)
        return result

    def test_idle_boundary_and_lock_override_recent_input(self):
        self.assertTrue(self.native(idle=179.99))
        self.assertFalse(self.native(idle=180))
        self.assertFalse(self.native(locked=1, idle=0))
        self.assertFalse(self.native(console=2, idle=0))
        self.assertFalse(self.native(logged_in=2, idle=0))

    def test_unknown_or_failed_native_state_fails_open(self):
        for options in ({'console': None}, {'logged_in': None}, {'session': None}, {'idle': float('nan')}, {'idle': -1}):
            with self.subTest(options=options):
                self.assertIsNone(self.native(**options))
        with patch('bridge.platforms.macos.attention._frameworks', side_effect=OSError):
            self.assertIsNone(desktop_active())


class AttentionHTTPTests(unittest.TestCase):
    def test_presence_requires_auth_csrf_and_origin_and_stops_after_logout(self):
        from bridge.api.httpd import GatewayServer
        from bridge.features.auth.auth import password_record
        with tempfile.TemporaryDirectory(dir=ROOT/'.tmp') as directory:
            server = GatewayServer(('127.0.0.1', 0), object(), {'auth': {'mode': 'password', 'username': 'test', **password_record('long-password')}, 'origins': ['https://gateway.example']}, ROOT/'web')
            server.notifications = Notifications(None, directory)
            token, session = server.auth.new_session('127.0.0.1')
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            def request(*, csrf='', origin='https://gateway.example', cookie=True, body=None, path='/api/mobile/presence'):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                headers = {'Host': 'gateway.example', 'Origin': origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf}
                if cookie:
                    headers['Cookie'] = server.auth.cookie_name + '=' + token
                connection.request('POST', path, json.dumps(body if body is not None else {'viewer': 'a'*32, 'host': 'local', 'thread': THREAD}), headers)
                response = connection.getresponse()
                status = response.status
                response.read(); connection.close()
                return status
            try:
                self.assertEqual(request(cookie=False), 401)
                self.assertEqual(request(), 403)
                self.assertEqual(request(csrf=session['csrf'], origin='https://evil.example'), 403)
                self.assertEqual(request(csrf=session['csrf'], body={}), 400)
                self.assertEqual(request(csrf=session['csrf']), 200)
                self.assertTrue(server.notifications.attention.viewing({'id': THREAD, 'host': 'local'}))
                self.assertEqual(request(csrf=session['csrf'], path='/api/notifications/channels/common', body={'smartNotifications': True}), 200)
                self.assertTrue(settings(directory)['smartNotifications'])
                self.assertEqual(request(csrf=session['csrf'], path='/api/notifications/channels/common', body={'smartNotifications': 1}), 400)
                server.auth.logout(token)
                self.assertFalse(server.notifications.attention.viewing({'id': THREAD, 'host': 'local'}))
                self.assertEqual(request(csrf=session['csrf']), 401)
            finally:
                server.shutdown(); worker.join(); server.server_close()
