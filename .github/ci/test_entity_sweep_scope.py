import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).parent

class EntitySweepScopeTests(unittest.TestCase):
    def invoke(self, flag, status=0):
        with tempfile.TemporaryDirectory() as tmp:
            npm = Path(tmp) / 'npm'
            npm.write_text('#!/usr/bin/env python3\nimport os,json,sys\nprint(json.dumps(os.environ.get("ENTITY_SWEEP_ROUTES")))\nsys.exit(' + str(status) + ')\n')
            npm.chmod(0o755)
            env = {**os.environ, 'PATH': tmp + os.pathsep + os.environ['PATH'], 'ENTITY_SWEEP_ROUTES': 'stale-inherited-route'}
            env.pop('PR_CRITICAL_ROUTES', None)
            if flag is not None:
                env['PR_CRITICAL_ROUTES'] = flag
            result = subprocess.run(['bash', str(HERE / 'run-entity-sweep.sh')], env=env, capture_output=True, text=True)
            return result.returncode, json.loads(result.stdout)

    def test_full_sweep_unsets_the_override(self):
        self.assertEqual(self.invoke('false'), (0, None))

    def test_unspecified_scope_is_full(self):
        self.assertEqual(self.invoke(None), (0, None))

    def test_critical_scope_includes_the_affected_calendar_route(self):
        status, routes = self.invoke('true')
        self.assertEqual(status, 0)
        self.assertEqual(routes.split(','), ['/app', '/app/documents', '/app/tasks', '/app/meetings', '/app/calendar'])

    def test_browser_failure_is_not_suppressed(self):
        self.assertEqual(self.invoke('true', 7)[0], 7)

if __name__ == '__main__':
    unittest.main()
