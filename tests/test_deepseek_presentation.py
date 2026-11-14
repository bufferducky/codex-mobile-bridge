"""Native DSH record projections; synthetic content never reaches a real client."""
import unittest
from bridge.clients.deepseek import adapter
from bridge.clients.deepseek.adapter import messages


def event(seq, kind, data, time=1700000000000):
    return {'event': {'seq': seq, 'time': time, 'type': kind, 'data': data}}


class DeepSeekPresentationTests(unittest.TestCase):
    def test_context_uses_native_provenance_and_never_filters_user_text(self):
        text = '<system-reminder>user pasted this literal tag</system-reminder>'
        rows = messages([
            event(1, 'user/message', {'source': {'kind': 'user'}, 'content': [{'type': 'text', 'text': text}]}),
            event(2, 'user/message', {'source': {'kind': 'runtime-context', 'form': 'snapshot'}, 'content': [{'type': 'text', 'text': 'Runtime context'}]}),
            event(3, 'user/message', {'source': {'kind': 'agent-instructions'}, 'content': [{'type': 'text', 'text': 'Agent instructions'}]}),
            event(4, 'assistant/message', {'turn': 1, 'message': {'content': [{'type': 'text', 'text': 'Normal English answer'}]}}),
        ])
        self.assertEqual([row['role'] for row in rows], ['user', 'context', 'context', 'assistant'])
        self.assertEqual(rows[0]['text'], text)
        self.assertEqual(rows[-1]['text'], 'Normal English answer')

    def test_tools_pair_by_native_call_id_and_keep_turn_identity(self):
        rows = messages([
            event(1, 'turn/start', {'turn': 4}),
            event(2, 'tool/call', {'turn': 4, 'step': 1, 'callId': 'call-a', 'name': 'bash', 'arguments': '{"command":"node --test"}'}),
            event(3, 'tool/call', {'turn': 4, 'step': 1, 'callId': 'call-b', 'name': 'read', 'arguments': '{"path":"src/main.py"}'}),
            event(4, 'tool/result', {'turn': 4, 'message': {'toolCallId': 'call-a', 'isError': True, 'content': [{'type': 'text', 'text': 'Failure output'}]}}),
        ])
        self.assertEqual(len(rows), 2)
        self.assertEqual([row['turnId'] for row in rows], ['4', '4'])
        self.assertEqual(rows[0]['status'], 'failed')
        self.assertIn('Failure output', rows[0]['text'])
        self.assertEqual(rows[1]['status'], 'inProgress')
        self.assertEqual(rows[0]['toolCallId'], 'call-a')

    def test_partial_pages_keep_orphan_result_without_claiming_a_new_call(self):
        rows = messages([event(5, 'tool/result', {'turn': 4, 'message': {'toolCallId': 'outside-page', 'content': [{'type': 'text', 'text': 'Result'}]}})])
        self.assertEqual(rows[0]['toolCallId'], 'outside-page')
        self.assertTrue(rows[0]['resultOnly'])
        self.assertEqual(rows[0]['turnId'], '4')

    def test_activity_uses_native_time_and_never_reports_old_completed_work(self):
        current_activity = adapter.current_activity
        records = [event(1, 'turn/start', {'turn': 2}, 1700000000000), event(2, 'tool/call', {'turn': 2, 'callId': 'call', 'name': 'bash', 'arguments': '{"command":"TOKEN=private node --test"}'})]
        activity = current_activity(records, True)
        self.assertEqual(activity['startedAt'], 1700000000000)
        self.assertEqual(activity['kind'], 'command')
        self.assertIn('<redacted>', activity['command'])
        self.assertNotIn('private', activity['command'])
        self.assertIsNone(current_activity(records, False))
        records.append(event(3, 'turn/end', {'turn': 2, 'reason': {'kind': 'completed'}}))
        self.assertNotEqual((current_activity(records, True) or {}).get('command'), activity['command'])

    def test_native_task_failures_are_visible_without_forwarding_provider_secrets(self):
        for kind in ('error', 'blocked', 'max-tokens'):
            rows = messages([event(1, 'turn/start', {'turn': 4}), event(2, 'turn/end', {
                'turn': 4, 'reason': {'kind': kind, 'error': {'message': 'PRIVATE upstream body', 'token': 'PRIVATE'}}})])
            self.assertEqual(rows[-1]['role'], 'error')
            self.assertEqual(rows[-1]['endReason'], kind)
            self.assertEqual(rows[-1]['turnId'], '4')
            self.assertNotIn('PRIVATE', str(rows))


if __name__ == '__main__':
    unittest.main()
