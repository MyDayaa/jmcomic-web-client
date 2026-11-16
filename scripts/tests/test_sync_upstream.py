"""Verify synchronization against local upstream/fork remotes, without network access."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'sync-upstream.sh'


class SyncUpstreamTests(unittest.TestCase):
    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', *args], cwd=cwd or self.work, stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self, path, content, cwd):
        (cwd / path).write_text(content)
        self.git('add', path, cwd=cwd)
        self.git('commit', '-m', 'fixture change', cwd=cwd)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='jm-sync-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.upstream = self.root / 'upstream.git'
        self.origin = self.root / 'origin.git'
        self.work = self.root / 'work'
        self.git('init', '--bare', '--initial-branch=main', str(self.upstream), cwd=self.root)
        self.git('init', '--bare', '--initial-branch=main', str(self.origin), cwd=self.root)
        self.git('clone', str(self.upstream), str(self.work), cwd=self.root)
        self.configure(self.work)
        self.commit('reader.ts', 'initialData: null\n', self.work)
        self.git('push', 'origin', 'main')
        self.git('remote', 'set-url', 'origin', str(self.origin))
        self.commit('reader.ts', 'initialData: undefined\n', self.work)
        self.git('push', 'origin', 'main')
        self.before = self.git('rev-parse', 'HEAD')

    def configure(self, cwd):
        self.git('config', 'user.name', 'Sync test', cwd=cwd)
        self.git('config', 'user.email', 'sync-test@example.invalid', cwd=cwd)

    def change_upstream(self, path, content):
        clone = self.root / 'upstream-work'
        self.git('clone', str(self.upstream), str(clone), cwd=self.root)
        self.configure(clone)
        self.commit(path, content, clone)
        self.git('push', 'origin', 'main', cwd=clone)

    def sync(self):
        self.output = self.root / 'github-output'
        return subprocess.run(['bash', str(SCRIPT), str(self.upstream), 'main'],
                              cwd=self.work, env={**os.environ, 'GITHUB_OUTPUT': str(self.output)},
                              capture_output=True, text=True)

    def test_unchanged_upstream_does_not_replace_fork(self):
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)
        self.assertEqual(self.git('--git-dir=' + str(self.origin), 'rev-parse', 'main'), self.before)
        self.assertEqual(self.output.read_text().strip(), 'changed=false')

    def test_update_preserves_local_reader_fix(self):
        self.change_upstream('README.md', 'New upstream feature\n')
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.work / 'reader.ts').read_text(), 'initialData: undefined\n')
        self.assertEqual((self.work / 'README.md').read_text(), 'New upstream feature\n')
        self.assertEqual(self.git('--git-dir=' + str(self.origin), 'rev-parse', 'main'), self.git('rev-parse', 'HEAD'))
        self.assertEqual(self.output.read_text().strip(), 'changed=true')

    def test_conflict_leaves_main_and_local_fix_untouched(self):
        self.change_upstream('reader.ts', 'initialData: upstream_rewrite\n')
        result = self.sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Upstream conflicts with fork changes', result.stdout)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.before)
        self.assertEqual(self.git('--git-dir=' + str(self.origin), 'rev-parse', 'main'), self.before)
        self.assertEqual((self.work / 'reader.ts').read_text(), 'initialData: undefined\n')
        self.assertEqual(self.git('status', '--porcelain'), '')


if __name__ == '__main__':
    unittest.main()
