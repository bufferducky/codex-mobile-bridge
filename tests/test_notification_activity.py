import json
from contextlib import closing
import sqlite3
import tempfile
import time
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

from bridge.features.notifications.channels import Notifications, save_settings
from bridge.app.service import LiveSession
from bridge.features.sessions.store import SessionStore
import test_bridge as support

ROOT = Path(__file__).resolve().parents[1]
THREAD = '11111111-1111-4111-8111-111111111111'


class ActiveNotificationsTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'.tmp').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'.tmp')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.session = LiveSession(THREAD)
        self.session.connected = True
        self.session.state = {'requests': [], 'turns': [{'turnId': 'old', 'status': 'completed'}]}
        session = self.session
        class Source:
            changes = [{'host': 'local', 'id': THREAD}]
            calls = 0
            releases = 0
            def notification_candidates(self):
                result, self.changes = self.changes, []
                return result
            def for_host(self, host):return self
            def notification_session(self, identifier):
                self.calls += 1
                session.connected = True
                return session
            def release_notification_session(self, value):
                self.releases += 1
                value.watched = False
                value.connected = False
                return True
        self.source = Source()
        save_settings(self.directory, {'enabled': True, 'topic': 'test'})
        self.manager = Notifications(self.source, self.directory)
        self.manager.defaults({'requests': True, 'completion': True})

    def rediscover(self):
        self.source.changes = [{'host': 'local', 'id': THREAD}]
        self.manager.discovery_at = 0

    def test_idle_retires_and_new_run_rejoins_then_completes_once(self):
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.assertEqual(self.source.releases, 1)
            for _ in range(20):self.manager.scan()
            self.assertEqual(self.source.calls, 1)
            send.assert_not_called()
            self.session.state['turns'].append({'turnId': 'new', 'status': 'inProgress'})
            self.rediscover();self.manager.scan()
            self.assertTrue(self.session.watched)
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan();send.assert_called_once()
            self.assertEqual(self.source.releases, 2)
            self.manager.scan();send.assert_called_once()

    def test_idle_runtime_patch_before_turn_completion_does_not_detach_early(self):
        self.session.state['threadRuntimeStatus'] = {'type': 'active'}
        self.session.state['turns'][-1]['status'] = 'inProgress'
        self.manager.scan()
        self.session.state['threadRuntimeStatus']['type'] = 'idle'
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.assertEqual(self.source.releases, 0)
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan()
            send.assert_called_once()
            self.assertEqual(self.source.releases, 1)

    def test_pending_approval_stays_attached_when_runtime_is_idle(self):
        self.session.state['threadRuntimeStatus'] = {'type': 'idle'}
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan();send.assert_called_once()
            self.assertEqual(self.source.releases, 0)
            self.session.state['requests'] = []
            self.manager.scan();self.assertEqual(self.source.releases, 1)

    def test_completion_retry_does_not_reattach_and_survives_restart(self):
        self.session.state['turns'][-1]['status'] = 'inProgress'
        self.manager.scan()
        self.session.state['turns'][-1]['status'] = 'completed'
        with patch('bridge.features.notifications.channels.publish', side_effect=OSError()):self.manager.scan()
        calls = self.source.calls
        self.assertEqual(self.source.releases, 1)
        for value in self.manager.ledger.values():value['next'] = 0
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan();send.assert_called_once()
        self.assertEqual(self.source.calls, calls)
        # A failed completion is retained independently of subscriptions.
        for value in self.manager.ledger.values():value.update(delivered=False, next=0)
        from bridge.features.notifications.channels import write_json
        write_json(self.directory/'notification-delivery.json', self.manager.ledger)
        restarted = Notifications(self.source, self.directory)
        with patch('bridge.features.notifications.channels.publish') as send:
            restarted.scan();send.assert_called_once()
        self.assertEqual(self.source.calls, calls)

    def test_live_event_rejoins_without_waiting_for_metadata_discovery(self):
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.session.state['turns'].append({'turnId': 'event', 'status': 'inProgress'})
            self.source.notification_updates = lambda: [{'host': 'local', 'id': THREAD}]
            self.manager.scan()
            self.assertTrue(self.session.watched)
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan()
            send.assert_called_once()

    def test_reenabled_defaults_probe_idle_chat_again(self):
        self.manager.scan()
        self.session.state['turns'].append({'turnId': 'later', 'status': 'inProgress'})
        self.manager.defaults({'requests': False, 'completion': False})
        self.manager.scan()
        self.manager.defaults({'requests': True, 'completion': True})
        self.manager.scan()
        self.assertTrue(self.session.watched)

    def test_disabled_completion_cancels_detached_retry(self):
        self.session.state['turns'][-1]['status'] = 'inProgress'
        self.manager.scan()
        self.session.state['turns'][-1]['status'] = 'completed'
        with patch('bridge.features.notifications.channels.publish', side_effect=OSError()):self.manager.scan()
        self.manager.defaults({'requests': True, 'completion': False})
        for value in self.manager.ledger.values():value['next'] = 0
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan();send.assert_not_called()


class AttentionNotificationTests(unittest.TestCase):
    rediscover = ActiveNotificationsTests.rediscover

    def setUp(self):
        ActiveNotificationsTests.setUp(self)
        save_settings(self.directory, {'smartNotifications': True})
        self.manager.attention = SimpleNamespace(desktop_active=lambda: True, viewing=lambda row: False, seen_completion=lambda row, turn: False)

    def test_active_mac_completion_is_not_pushed_or_replayed_after_leaving(self):
        self.session.state['turns'][-1]['status'] = 'inProgress'
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan()
            send.assert_not_called()
            self.manager.attention.desktop_active = lambda: False
            self.rediscover(); self.manager.scan()
            restarted = Notifications(self.source, self.directory)
            restarted.attention = self.manager.attention
            restarted.scan()
            send.assert_not_called()

    def test_active_mac_approval_waits_thirty_seconds(self):
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan(); send.assert_not_called()
            now.return_value = 1029
            self.manager.scan(); send.assert_not_called()
            now.return_value = 1030
            self.manager.scan(); send.assert_called_once()
            self.manager.scan(); send.assert_called_once()

    def test_locked_mac_completion_after_android_clear_is_sent_after_restart(self):
        from bridge.features.notifications.attention import Attention
        self.manager.attention = Attention()
        self.manager.attention.desktop_active = lambda: False
        self.session.state['turns'][-1]['status'] = 'inProgress'
        body = {'viewer': 'a'*32, 'host': 'local', 'thread': THREAD}
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.attention.update('owner', body)
            self.manager.scan()
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan(); send.assert_not_called()
            restarted = Notifications(self.source, self.directory)
            restarted.attention.desktop_active = lambda: False
            restarted.scan(); send.assert_called_once()

    def test_only_confirmed_completed_turns_are_skipped_when_android_leaves(self):
        from bridge.features.notifications.attention import Attention
        self.manager.attention = Attention()
        self.manager.attention.desktop_active = lambda: False
        self.session.state['turns'][-1]['status'] = 'inProgress'
        body = {'viewer': 'a'*32, 'host': 'local', 'thread': THREAD}
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.attention.update('owner', body)
            self.manager.scan()
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan(); send.assert_not_called()
            self.manager.attention.update('owner', {**body, 'completed': ['old']})
            self.manager.attention.update('owner', {**body, 'host': '', 'thread': ''})
            self.manager.scan(); send.assert_not_called()
            restarted = Notifications(self.source, self.directory)
            restarted.attention.desktop_active = lambda: False
            restarted.scan(); send.assert_not_called()

    def test_questions_have_independent_thirty_second_deadlines(self):
        self.session.state['requests'] = [{'id': 'first', 'method': 'item/tool/requestUserInput', 'params': {}}]
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            now.return_value = 1015
            self.session.state['requests'].append({'id': 'second', 'method': 'item/tool/requestUserInput', 'params': {}})
            self.manager.scan(); send.assert_not_called()
            now.return_value = 1030
            self.manager.scan(); send.assert_called_once()
            self.assertIn('1 项', send.call_args.args[2])
            now.return_value = 1045
            self.manager.scan(); self.assertEqual(send.call_count, 2)
            self.assertIn('1 项', send.call_args.args[2])

    def test_webhooks_continue_while_phone_is_silent(self):
        save_settings(self.directory, {'webhookEnabled': True, 'webhookUrl': 'https://hooks.example/test'})
        self.session.state['requests'] = [{'id': 'first', 'method': 'item/tool/requestUserInput', 'params': {}}]
        with patch('bridge.features.notifications.channels.publish') as phone, patch('bridge.features.notifications.channels.publish_webhook') as webhook:
            self.manager.scan(); phone.assert_not_called(); webhook.assert_called_once()

    def test_handled_approval_is_not_sent_after_timeout(self):
        self.session.state['requests'] = [{'id': 'question', 'method': 'item/tool/requestUserInput', 'params': {}}]
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.session.state['requests'] = []
            now.return_value = 1031
            self.manager.scan(); send.assert_not_called()

    def test_away_or_unknown_desktop_sends_immediately(self):
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        for active in (False, None):
            with self.subTest(active=active), patch('bridge.features.notifications.channels.publish') as send:
                self.manager.ledger.clear()
                self.manager.attention.desktop_active = lambda: active
                self.manager.scan(); send.assert_called_once()

    def test_android_same_chat_defers_request_until_background_even_after_thirty_seconds(self):
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        self.manager.attention.viewing = lambda row: True
        self.manager.attention.desktop_active = lambda: False
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan(); send.assert_not_called()
            now.return_value = 1040
            self.manager.scan(); send.assert_not_called()
            self.manager.attention.viewing = lambda row: False
            self.manager.scan(); send.assert_called_once()

    def test_android_completion_is_skipped_and_inbox_still_records_it(self):
        save_settings(self.directory, {'mobileEnabled': True})
        self.manager.attention.viewing = lambda row: True
        self.manager.attention.desktop_active = lambda: False
        self.session.state['turns'][-1]['status'] = 'inProgress'
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan(); send.assert_not_called()
            self.assertEqual(len(self.manager.mobile.read()['events']), 1)
            self.manager.attention.seen_completion = lambda row, turn: True
            self.manager.scan(); send.assert_not_called()
            self.manager.attention.viewing = lambda row: False
            self.rediscover(); self.manager.scan(); send.assert_not_called()

    def test_new_completion_after_leaving_still_pushes(self):
        self.manager.attention.desktop_active = lambda: False
        self.session.state['turns'][-1]['status'] = 'inProgress'
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan(); send.assert_called_once()

    def test_locked_mac_completion_after_android_background_survives_stale_lease(self):
        from bridge.features.notifications.attention import Attention
        self.manager.attention = Attention()
        self.manager.attention.desktop_active = lambda: False
        self.session.state['turns'][-1]['status'] = 'inProgress'
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, \
                patch('bridge.features.notifications.attention.time.monotonic', return_value=100) as monotonic, \
                patch('bridge.features.notifications.channels.publish') as send:
            self.manager.attention.update('owner', {'viewer': 'a'*32, 'host': 'local', 'thread': THREAD})
            self.manager.scan()
            # Android has entered the background; its final clear may be suspended
            # or lost. The response arrives before the last foreground lease expires.
            now.return_value = 1002; monotonic.return_value = 102
            self.session.state['turns'][-1]['status'] = 'completed'
            self.manager.scan(); send.assert_not_called()
            now.return_value = 1026; monotonic.return_value = 126
            self.manager.scan(); send.assert_called_once()
            self.manager.scan(); send.assert_called_once()

    def test_restart_preserves_approval_age_and_retry_does_not_restart_delay(self):
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        with patch('bridge.features.notifications.channels.time.time', return_value=1000) as now, patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan()
            self.rediscover()
            restarted = Notifications(self.source, self.directory)
            restarted.attention = self.manager.attention
            now.return_value = 1030
            send.side_effect = OSError('synthetic failure')
            restarted.scan(); send.assert_called_once()
            now.return_value = 1041
            send.side_effect = None
            restarted.scan(); self.assertEqual(send.call_count, 2)

    def test_disabled_smart_mode_retains_immediate_delivery(self):
        save_settings(self.directory, {'smartNotifications': False})
        self.session.state['requests'] = [{'id': 'approval', 'method': 'item/commandExecution/requestApproval', 'params': {}}]
        with patch('bridge.features.notifications.channels.publish') as send:
            self.manager.scan(); send.assert_called_once()
            self.manager.scan(); send.assert_called_once()


class DiscoveryTests(unittest.TestCase):
    setUp = support.IntegrationTests.setUp
    tearDown = support.IntegrationTests.tearDown

    def test_incremental_discovery_and_equal_timestamp_new_thread(self):
        first = self.bridge.notification_candidates()
        self.assertIn(support.THREAD, [r['id'] for r in first])
        self.assertEqual(self.bridge.notification_candidates(), [])
        with closing(sqlite3.connect(self.root/'state_5.sqlite')) as db, db:
            db.execute('UPDATE threads SET updated_at=updated_at+1 WHERE id=?', (support.THREAD,))
        self.assertEqual(len(self.bridge.notification_candidates()), 1)
        self.assertEqual(self.bridge.notification_candidates(), [])
        with closing(sqlite3.connect(self.root/'state_5.sqlite')) as db, db:
            db.execute('INSERT INTO threads SELECT ?,title,cwd,updated_at,1,originator,source,rollout_path FROM threads WHERE id=?', (THREAD, support.THREAD))
        self.assertEqual(self.bridge.notification_candidates(), [{'id': THREAD, 'host': 'local'}])

    def test_reconnect_rediscovers_without_metadata_change(self):
        self.assertTrue(self.bridge.notification_candidates())
        self.assertEqual(self.bridge.notification_candidates(), [])
        self.bridge._disconnected()
        self.assertTrue(self.bridge.notification_candidates())

    def test_stream_updates_do_not_rejoin_idle_chat_but_wake_active_chat(self):
        session = self.bridge.notification_session(support.THREAD)
        until = time.monotonic()+2
        while not session.connected and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(self.bridge.notification_updates())
        session.watched = False
        self.bridge.notification_dirty.add(session.id)
        self.assertEqual(self.bridge.notification_updates(), [])
        session.state['threadRuntimeStatus'] = {'type': 'active'}
        self.bridge.notification_dirty.add(session.id)
        self.assertTrue(self.bridge.notification_updates())

    def test_release_only_notification_subscription_preserves_phone_reader(self):
        session = self.bridge.notification_session(support.THREAD)
        until = time.monotonic()+2
        while not session.connected and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(session.connected)
        session.viewers = 1
        self.bridge.release_notification_session(session)
        self.assertTrue(session.connected)
        session.viewers = 0
        self.bridge.release_notification_session(session)
        self.assertFalse(session.connected)
        self.assertFalse(session.watched)
