#!/usr/bin/env python3
"""Classify changed paths; missing bases and unknown paths require full coverage."""
import argparse, json, os, re, subprocess
from pathlib import Path

def classify(paths, config, full=False):
    result = dict.fromkeys(config['flags'], False)
    reasons = []
    if full or not paths:
        return dict.fromkeys(config['flags'], True), ['full validation or unavailable change list']
    for path in paths:
        matched = False
        for rule in config['rules']:
            if re.search(rule['pattern'], path):
                matched = True
                for key in rule['select']:
                    result[key] = True
        if not matched:
            reasons.append('unclassified: ' + path)
    if reasons:
        return dict.fromkeys(config['flags'], True), reasons
    return result, ['classified ' + str(len(paths)) + ' changed paths']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=os.environ.get('BASE', ''))
    parser.add_argument('--full', action='store_true')
    parser.add_argument('--paths-json', type=Path)
    args = parser.parse_args()
    config = json.loads(Path(__file__).with_name('scope.json').read_text())
    full = args.full or os.environ.get('GITHUB_EVENT_NAME') in ('workflow_dispatch', 'merge_group')
    paths = []
    if args.paths_json:
        paths = json.loads(args.paths_json.read_text())
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            raise SystemExit('paths must be an array of strings')
    elif not full:
        if not args.base or set(args.base) == {'0'}:
            full = True
        else:
            diff = subprocess.run(['git', 'diff', '--no-renames', '--name-only', '-z', args.base, 'HEAD'], capture_output=True)
            if diff.returncode:
                full = True
            else:
                paths = diff.stdout.decode('utf-8').rstrip('\0').split('\0') if diff.stdout else []
    selected, reasons = classify(paths, config, full)
    print(json.dumps({'selected': selected, 'reasons': reasons, 'paths': paths}, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in selected.items():
                output.write(f'{key}={str(value).lower()}\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write('### Selected validation\n\n' + ', '.join(k for k,v in selected.items() if v) + '\n\n' + '; '.join(reasons) + '\n')

if __name__ == '__main__':
    main()
