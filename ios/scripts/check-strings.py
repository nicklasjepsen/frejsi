#!/usr/bin/env python3
"""Checks the iPhone app's strings: every key used as L("key") in ios/App and ios/Shared exists in
both da.lproj and en.lproj Localizable.strings, both files have the same keys and placeholders,
and no string mentions insulin. Runs anywhere with Python 3 (no Xcode needed)."""
import pathlib
import re
import sys

ios = pathlib.Path(__file__).resolve().parent.parent
pair = re.compile(r'^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$')


def load(lang):
    path = ios / "App" / f"{lang}.lproj" / "Localizable.strings"
    text = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    entries = {}
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        match = pair.match(line)
        if not match:
            sys.exit(f"{path}: cannot read line {number}: {line!r}")
        if match.group(1) in entries:
            sys.exit(f"{path}: {match.group(1)} twice")
        entries[match.group(1)] = match.group(2)
    return entries


da, en = load("da"), load("en")
problems = []
for key in sorted(set(da) ^ set(en)):
    problems.append(f"{key}: only in {'da' if key in da else 'en'}")
for key in sorted(set(da) & set(en)):
    placeholders = lambda s: sorted(re.findall(r"%(?:ld|d|@)", s))
    if placeholders(da[key]) != placeholders(en[key]):
        problems.append(f"{key}: placeholders differ between da and en")
for lang, entries in (("da", da), ("en", en)):
    for key, value in entries.items():
        if "insulin" in value.lower():
            problems.append(f"{lang} {key}: mentions insulin")

used = set()
for source in list((ios / "App").rglob("*.swift")) + list((ios / "Shared").rglob("*.swift")):
    used.update(re.findall(r'\bL\("([^"]+)"', source.read_text(encoding="utf-8")))
for key in sorted(used - set(en)):
    problems.append(f"{key}: used in Swift but not in the strings files")
for key in sorted(set(en) - used):
    problems.append(f"{key}: in the strings files but never used")

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"{len(en)} strings, da and en match, all used")
