"""Check empty-chat permission persistence with an explicit Codex runtime.

Uses a temporary CODEX_HOME with restrictive defaults; never starts a turn,
opens the desktop, or reads the user's Codex configuration or credentials.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from bridge.features.sessions.create import (
    _runtime_operation, create_empty, creation_permission_settings,
)
from bridge.features.sessions.model import permission_mode
from bridge.features.sessions.side_chat import SideChat


def native_mode(result):
    return permission_mode({'currentPermissions': {
        **{key: result[key] for key in
           ('approvalPolicy', 'approvalsReviewer', 'activePermissionProfile') if key in result},
        'sandboxPolicy': result.get('sandbox', {}),
    }})


def verify(runtime):
    (ROOT / '.tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='creation-permissions-', dir=ROOT / '.tmp') as folder:
        home, cwd = Path(folder) / 'home', Path(folder) / 'workspace'
        home.mkdir()
        cwd.mkdir()
        (home / 'config.toml').write_text(
            'approval_policy="on-request"\nsandbox_mode="workspace-write"\n', encoding='utf-8')
        modes = {}
        for preference, expected in [(None, 'ask'), ('full-access', 'full-access')]:
            identifier = create_empty(runtime, home, str(cwd), 'Isolated permission check',
                                      permission_mode=preference)
            # A separate runtime models desktop takeover, without overriding
            # permissions during resume or hiding a missing persisted setting.
            resumed = _runtime_operation(runtime, home, str(cwd), lambda request: request(
                'thread/resume', {'threadId': identifier, 'excludeTurns': True}))
            actual = native_mode(resumed)
            assert actual == expected, f'{preference or "default"}: reopened empty chat is {actual}, expected {expected}'
            modes[preference or 'default'] = actual

        child = SideChat(runtime, home, identifier, str(cwd), {
            'model': resumed['model'], 'modelProvider': resumed['modelProvider'],
            **creation_permission_settings('full-access'),
        })
        try:
            assert child.view()['permissionMode'] == 'full-access', 'Side chat lost its creation permission'
        finally:
            child.close()
        return {'reopenedEmptyChats': modes, 'sideChat': 'full-access', 'turnsStarted': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    args = parser.parse_args()
    runtime = args.runtime.expanduser().resolve(strict=True)
    print(json.dumps(verify(str(runtime))))
