#!/usr/bin/env python3
"""Checks the iPhone app's strings, in both tables:

- App/<lang>.lproj/Localizable.strings, the app's words, used as L("key") in ios/App and ios/Shared;
- Shared/<lang>.lproj/Widgets.strings, the widgets' and Live Activity's words, used as WL("key")
  in ios/Shared, ios/LiveActivity and ios/Widgets (the extension does not carry the app's table).

Every key used exists in both da and en, both files of a table have the same keys and
placeholders, every key is used, and no string mentions insulin. Runs anywhere with Python 3
(no Xcode needed)."""
import pathlib
import re
import sys

ios = pathlib.Path(__file__).resolve().parent.parent
pair = re.compile(r'^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$')

TABLES = [
    # (folder, table file, lookup function, folders whose Swift may use it)
    ("App", "Localizable.strings", "L", ["App", "Shared"]),
    ("Shared", "Widgets.strings", "WL", ["Shared", "LiveActivity", "Widgets"]),
]


def load(folder, table, lang):
    path = ios / folder / f"{lang}.lproj" / table
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


problems = []
summary = []
for folder, table, function, users in TABLES:
    da, en = load(folder, table, "da"), load(folder, table, "en")
    for key in sorted(set(da) ^ set(en)):
        problems.append(f"{table} {key}: only in {'da' if key in da else 'en'}")
    for key in sorted(set(da) & set(en)):
        placeholders = lambda s: sorted(re.findall(r"%(?:ld|d|@)", s))
        if placeholders(da[key]) != placeholders(en[key]):
            problems.append(f"{table} {key}: placeholders differ between da and en")
    for lang, entries in (("da", da), ("en", en)):
        for key, value in entries.items():
            if "insulin" in value.lower():
                problems.append(f"{table} {lang} {key}: mentions insulin")

    used = set()
    for user in users:
        for source in (ios / user).rglob("*.swift"):
            used.update(re.findall(rf'\b{function}\("([^"]+)"', source.read_text(encoding="utf-8")))
    for key in sorted(used - set(en)):
        problems.append(f"{table} {key}: used in Swift as {function}(...) but not in the strings files")
    for key in sorted(set(en) - used):
        problems.append(f"{table} {key}: in the strings files but never used")
    summary.append(f"{len(en)} in {table}")

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"{', '.join(summary)}: da and en match, all used")
