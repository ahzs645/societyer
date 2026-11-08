import importlib.util, json, unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('selector', HERE / 'select-checks.py')
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)
CONFIG = json.loads((HERE / 'scope.json').read_text())

class SelectionTests(unittest.TestCase):
    def test_unknown_path_broadens(self):
        selected, reasons = selector.classify(['new-unmapped-area/input'], CONFIG)
        self.assertTrue(all(selected.values()))
        self.assertIn('unclassified', reasons[0])

    def test_no_change_list_broadens(self):
        self.assertTrue(all(selector.classify([], CONFIG)[0].values()))

    def test_manual_full_broadens(self):
        self.assertTrue(all(selector.classify(['README.md'], CONFIG, True)[0].values()))

    def test_shared_workflow_broadens(self):
        self.assertTrue(all(selector.classify(['.github/workflows/ci.yml'], CONFIG)[0].values()))

    def test_documentation_can_be_narrow(self):
        self.assertFalse(all(selector.classify(['docs/usage.md'], CONFIG)[0].values()))

    def test_repository_dependency_examples(self):
        for case in CONFIG['cases']:
            with self.subTest(paths=case['paths']):
                selected, _ = selector.classify(case['paths'], CONFIG)
                for flag, expected in case['expected'].items():
                    self.assertEqual(selected[flag], expected, flag)

if __name__ == '__main__':
    unittest.main()
