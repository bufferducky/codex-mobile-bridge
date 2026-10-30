import unittest

from bridge.features.sessions.model import normalize_state
from bridge.features.sessions.timeline import Timeline


class LiveActivityTests(unittest.TestCase):
    def test_compound_native_commands_preserve_every_action_in_order(self):
        item = {'id': 'compound', 'type': 'commandExecution', 'status': 'inProgress',
                'cwd': '/repo', 'commandActions': [
                    {'type': 'read', 'name': 'A.java', 'path': '/repo/src/A.java'},
                    {'type': 'search', 'path': 'supply/src', 'query': 'editable|version'},
                    {'type': 'read', 'name': 'C.java', 'path': '/repo/src/C.java'},
                    {'type': 'listFiles', 'path': 'supply/src/main'}]}
        activity = normalize_state(self.native(item))['currentActivity']
        actions = activity.get('actions', [])
        self.assertEqual([action['kind'] for action in actions], ['read', 'search', 'read', 'list'])
        self.assertEqual(actions[0]['path'], '/repo/src/A.java')
        self.assertEqual(actions[1]['query'], 'editable|version')
        self.assertEqual(actions[1]['target'], 'supply/src')
        self.assertEqual(actions[2]['target'], 'C.java')
        self.assertEqual(actions[3]['target'], 'supply/src/main')
        self.assertEqual(activity['summary'], actions[-1])

    def test_unknown_command_retains_its_description_without_exposing_credentials(self):
        item = {'type': 'commandExecution', 'status': 'inProgress', 'commandActions': [
            {'type': 'unknown', 'command': 'ssh remote-host --token PRIVATE_TOKEN'},
            {'type': 'search', 'path': 'supply/src/main', 'query': 'editable'}]}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['actions'][1]['kind'], 'search')
        self.assertEqual(activity['actions'][1]['target'], 'supply/src/main')
        self.assertEqual(activity['actions'][0]['command'], 'ssh remote-host --token <redacted>')
        self.assertNotIn('PRIVATE_TOKEN', str(activity))
        self.assertEqual(activity['summary'], activity['actions'][1])

    def test_latest_summary_is_retained_even_when_the_details_list_is_bounded(self):
        item = {'type': 'commandExecution', 'status': 'inProgress', 'commandActions': [
            {'type': 'search', 'path': 'directory-'+str(index), 'query': 'pattern'} for index in range(65)]}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(len(activity['actions']), 64)
        self.assertEqual(activity['actionsOmitted'], 1)
        self.assertEqual(activity['summary']['target'], 'directory-64')

    def test_generic_command_description_and_credential_redaction(self):
        item = {'type': 'commandExecution', 'status': 'inProgress',
                'command': 'API_KEY=PRIVATE_KEY ssh remote-host --password "PRIVATE_PASSWORD" rg query src'}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['command'], 'API_KEY=<redacted> ssh remote-host --password <redacted> rg query src')
        self.assertNotIn('PRIVATE_KEY', str(activity))
        self.assertNotIn('PRIVATE_PASSWORD', str(activity))

    def test_file_edits_and_mcp_calls_retain_their_native_context(self):
        item = {'type': 'fileChange', 'status': 'inProgress', 'cwd': '/repo', 'changes': {
            '/repo/src/A.java': {'type': 'update', 'diff': 'PRIVATE_PATCH'},
            '/repo/src/B.java': {'type': 'update', 'diff': 'PRIVATE_PATCH'}}}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual([action['target'] for action in activity['actions']], ['src/A.java', 'src/B.java'])
        self.assertNotIn('PRIVATE_PATCH', str(activity))
        item = {'type': 'mcpToolCall', 'status': 'inProgress', 'server': 'workspace', 'tool': 'read_file', 'arguments': {'token': 'PRIVATE_TOKEN'}}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['target'], 'workspace · read_file')
        self.assertNotIn('PRIVATE_TOKEN', str(activity))

    def test_search_query_survives_phone_metadata_with_its_folder(self):
        command = {'id': 'search', 'type': 'commandExecution', 'status': 'inProgress',
                   'commandActions': [{'type': 'search', 'path': '/repo/supply',
                                       'query': 'MerchantServiceProductController|editable'}]}
        timeline = Timeline()
        timeline.update({**normalize_state(self.native(command)), 'sequence': 1})
        activity = timeline.page()['meta']['currentActivity']
        self.assertEqual(activity['target'], 'supply')
        self.assertEqual(activity.get('query'), 'MerchantServiceProductController|editable')
        first = timeline.page()
        command['commandActions'][0]['query'] = 'review_status|source_version'
        timeline.update({**normalize_state(self.native(command)), 'sequence': 2})
        changed = timeline.changes(1, first['epoch'], first['before'])
        self.assertEqual(changed['meta']['currentActivity']['query'], 'review_status|source_version')
        self.assertEqual(changed['rows'], [])

    def test_fast_native_tools_remain_visible_between_tool_and_model_events(self):
        # Real desktop event pattern: completed command, then an empty public
        # reasoning item while the native turn remains in progress.
        state = self.native({'id': 'read', 'type': 'commandExecution', 'status': 'completed',
                             'commandActions': [{'type': 'read', 'path': '/repo/Controller.java'}]})
        state['turns'][0]['items'].append({'id': 'reasoning', 'type': 'reasoning', 'summary': []})
        activity = normalize_state(state)['currentActivity']
        self.assertEqual(activity['kind'], 'read')
        self.assertEqual(activity['target'], 'Controller.java')
        self.assertEqual(activity['status'], 'completed')
        state['turns'][0]['items'].extend([
            {'id': 'search', 'type': 'commandExecution', 'status': 'completed',
             'commandActions': [{'type': 'search', 'path': '/repo/main'}]},
            {'id': 'next-reasoning', 'type': 'reasoning', 'summary': []}])
        activity = normalize_state(state)['currentActivity']
        self.assertEqual((activity['kind'], activity['target'], activity['status']),
                         ('search', 'main', 'completed'))

    def test_active_search_target_updates_in_phone_metadata(self):
        command = {'id': 'search', 'type': 'commandExecution', 'status': 'inProgress',
                   'command': 'rg editable java',
                   'commandActions': [{'type': 'search', 'command': 'rg editable java',
                                       'query': 'editable', 'path': 'java'}]}
        state = {'id': 'fixture', 'threadRuntimeStatus': {'type': 'active'},
                 'turns': [{'turnId': 'turn', 'status': 'inProgress',
                            'turnStartedAtMs': 1800000000000, 'items': [command]}]}
        timeline = Timeline()
        timeline.update({**normalize_state(state), 'sequence': 1})
        first = timeline.page()
        self.assertEqual(first['meta'].get('currentActivity', {}).get('target'), 'java')
        command['commandActions'][0]['path'] = 'main'
        timeline.update({**normalize_state(state), 'sequence': 2})
        changed = timeline.changes(1, first['epoch'], first['before'])
        self.assertEqual(changed['meta']['currentActivity']['target'], 'main')
        self.assertEqual(changed['meta']['currentActivity']['kind'], 'search')
        self.assertEqual(changed['rows'], [])  # Metadata must update even without new text.

    def native(self, item, **turn_fields):
        return {'threadRuntimeStatus': {'type': 'active'},
                'turns': [{'turnId': 'current', 'status': 'inProgress',
                           'turnStartedAtMs': 1800000000000, 'items': [item], **turn_fields}]}

    def test_native_read_and_windows_path_are_bounded_and_do_not_copy_commands(self):
        item = {'id': 'read', 'type': 'commandExecution', 'status': 'inProgress',
                'command': 'PRIVATE_COMMAND --token PRIVATE_TOKEN',
                'aggregatedOutput': 'PRIVATE_OUTPUT',
                'commandActions': [{'type': 'read', 'path': 'C:\\repo\\SupplierProductPoolServiceImpl.java'}]}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['kind'], 'read')
        self.assertEqual(activity['target'], 'SupplierProductPoolServiceImpl.java')
        self.assertEqual(activity['startedAt'], 1800000000000)
        self.assertNotIn('PRIVATE', str(activity))
        item['commandActions'][0]['path'] = 'dir/' + 'a' * 1000 + '\n'
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertLessEqual(len(activity['target']), 160)
        self.assertNotIn('\n', activity['target'])

    def test_generic_command_and_tool_never_expose_arguments(self):
        command = {'id': 'command', 'type': 'commandExecution', 'status': 'inProgress',
                   'command': 'private command', 'commandActions': None}
        self.assertEqual(normalize_state(self.native(command))['currentActivity']['kind'], 'command')
        tool = {'id': 'tool', 'type': 'dynamicToolCall', 'status': 'inProgress',
                'tool': 'lookup', 'arguments': {'token': 'PRIVATE_TOKEN'}}
        activity = normalize_state(self.native(tool))['currentActivity']
        self.assertEqual((activity['kind'], activity['target']), ('tool', 'lookup'))
        self.assertNotIn('PRIVATE_TOKEN', str(activity))

    def test_completed_or_disconnected_tasks_clear_the_current_action(self):
        item = {'type': 'commandExecution', 'status': 'inProgress'}
        state = self.native(item)
        self.assertIsNone(normalize_state(state, connected=False)['currentActivity'])
        state['turns'][0]['status'] = 'completed'
        self.assertIsNone(normalize_state(state)['currentActivity'])
        state = self.native(item)
        state['threadRuntimeStatus']['type'] = 'idle'
        self.assertIsNone(normalize_state(state)['currentActivity'])

    def test_finished_tool_retains_its_completed_state_without_claiming_to_be_running(self):
        item = {'type': 'commandExecution', 'status': 'completed',
                'commandActions': [{'type': 'search', 'path': 'old-folder'}]}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['kind'], 'search')
        self.assertEqual(activity['target'], 'old-folder')
        self.assertEqual(activity['status'], 'completed')

    def test_latest_completed_tool_does_not_override_a_running_tool_or_final_reply(self):
        running = {'id': 'running', 'type': 'commandExecution', 'status': 'inProgress',
                   'commandActions': [{'type': 'search', 'path': 'running-folder'}]}
        state = self.native(running)
        state['turns'][0]['items'].append({'id': 'finished', 'type': 'commandExecution', 'status': 'completed'})
        self.assertEqual(normalize_state(state)['currentActivity']['itemId'], 'running')
        running['status'] = 'completed'
        state['turns'][0]['items'].append({'id': 'answer', 'type': 'agentMessage', 'phase': 'final_answer', 'text': 'Answer'})
        self.assertEqual(normalize_state(state)['currentActivity']['kind'], 'replying')

    def test_current_action_survives_a_small_presentation_window(self):
        tool = {'id': 'search', 'type': 'commandExecution', 'status': 'inProgress',
                'commandActions': [{'type': 'listFiles', 'path': '/repo/java'}]}
        state = self.native(tool)
        state['turns'][0]['items'].append({'id': 'progress', 'type': 'agentMessage',
                                         'phase': 'commentary', 'text': 'Public progress'})
        view = normalize_state(state, item_limit=1)
        self.assertEqual(view['currentActivity']['target'], 'java')
        self.assertEqual(view['currentActivity']['kind'], 'list')
        self.assertEqual(len(view['turns'][0]['messages']), 1)

    def test_reasoning_contents_are_not_copied_into_the_live_status(self):
        item = {'type': 'reasoning', 'status': 'inProgress',
                'summary': ['Public summary'], 'content': 'PRIVATE_REASONING'}
        activity = normalize_state(self.native(item))['currentActivity']
        self.assertEqual(activity['kind'], 'thinking')
        self.assertNotIn('Public summary', str(activity))
        self.assertNotIn('PRIVATE_REASONING', str(activity))


if __name__ == '__main__':
    unittest.main()
