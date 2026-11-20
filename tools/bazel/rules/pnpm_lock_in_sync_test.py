"""A pnpm-lock.yaml must stay `pnpm import`'s translation of package-lock.json.

npm (package-lock.json) drives local development; Bazel (rules_js
npm_translate_lock) installs from pnpm-lock.yaml. This test fails when the two
disagree, so a dependency bump made with npm cannot silently leave Bazel
building a different tree:

  * every workspace's package.json dependencies are the importer specifiers
    pnpm-lock.yaml recorded (the root, plus pnpm-workspace.yaml's packages);
  * both lockfiles resolve exactly the same package@version set;
  * with --rules-ts-typescript, rules_ts's TypeScript (MODULE.bazel
    typescript.deps) is the version and tarball the lockfile resolves.

Usage: pnpm_lock_in_sync_test.py <dir holding the lockfiles> [--rules-ts-typescript]
(see pnpm_lock.bzl). Fix a failure by re-running `pnpm import` in that
directory (`bazel run -- @pnpm//:pnpm --dir "$PWD/<dir>" import`).
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest

LOCK_DIR = ""
CHECK_RULES_TS = False
DEP_FIELDS = ("dependencies", "devDependencies", "optionalDependencies")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _web(path: str) -> str:
    return os.path.join(LOCK_DIR, path)


def workspaces() -> dict[str, str]:
    """importer -> package.json path: the root and pnpm-workspace.yaml's packages."""
    found = {".": "package.json"}
    path = _web("pnpm-workspace.yaml")
    if not os.path.exists(path):
        return found
    in_packages = False
    for line in _read(path).splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            in_packages = line.strip() == "packages:"
            continue
        if in_packages and line.strip().startswith("- "):
            pkg = _unquote(line.strip()[2:])
            found[pkg] = os.path.join(pkg, "package.json")
    return found


def _unquote(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        return text[1:-1]
    return text


def _section(lock: str, name: str) -> list[str]:
    """Lines of a top-level pnpm-lock.yaml section, without the header."""
    lines = lock.splitlines()
    start = lines.index(f"{name}:") + 1
    end = next((i for i in range(start, len(lines)) if lines[i] and not lines[i].startswith(" ")), len(lines))
    return lines[start:end]


def pnpm_importers(lock: str) -> dict[str, dict[str, str]]:
    """importer -> {dependency: specifier} from pnpm-lock.yaml."""
    importers: dict[str, dict[str, str]] = {}
    importer = dep = None
    for line in _section(lock, "importers"):
        indent = len(line) - len(line.lstrip(" "))
        text = line.strip()
        if not text:
            continue
        if indent == 2:
            importer = _unquote(text.rstrip(":"))
            importers[importer] = {}
        elif indent == 6:
            dep = _unquote(text.rstrip(":"))
        elif indent == 8 and text.startswith("specifier:"):
            importers[importer][dep] = _unquote(text.split(":", 1)[1])
    return importers


def pnpm_packages(lock: str) -> set[tuple[str, str]]:
    """(name, version) of every package pnpm-lock.yaml resolves."""
    packages = set()
    for line in _section(lock, "packages"):
        match = re.match(r"^  '?(@?[^@\s']+)@([^:'(]+)'?:$", line)
        if match:
            packages.add((match.group(1), match.group(2)))
    return packages


def pnpm_integrity(lock: str, name: str, version: str) -> str:
    section = "\n".join(_section(lock, "packages"))
    match = re.search(rf"^  '?{re.escape(name)}@{re.escape(version)}'?:\n    resolution: {{integrity: (\S+)}}", section, re.M)
    if not match:
        raise AssertionError(f"pnpm-lock.yaml has no integrity for {name}@{version}")
    return match.group(1)


class LockParseError(AssertionError):
    pass


_FLOW_PAIRS = {"{": "}", "[": "]"}


def _split_key(line: str, lineno: int) -> tuple[str, str]:
    """`key: value` / `key:` -> (key, value); a quoted key may hold ':'."""
    if line[0] in "'\"":
        end = line.find(line[0], 1)
        if end < 0 or not line[end + 1 :].startswith(":"):
            raise LockParseError(f"line {lineno}: unterminated quoted key")
        return line[1:end], line[end + 2 :].strip()
    if line.endswith(":"):
        return line[:-1], ""
    key, sep, value = line.partition(": ")
    if not sep:
        raise LockParseError(f"line {lineno}: expected `key: value`")
    return key, value.strip()


def _scalar(value: str, lineno: int) -> str:
    if value[:1] in _FLOW_PAIRS:
        depth = []
        quote = None
        for ch in value:
            if quote:
                quote = None if ch == quote else quote
            elif ch in "'\"":
                quote = ch
            elif ch in _FLOW_PAIRS:
                depth.append(_FLOW_PAIRS[ch])
            elif ch in "}]":
                if not depth or depth.pop() != ch:
                    raise LockParseError(f"line {lineno}: unbalanced flow value")
        if depth or quote:
            raise LockParseError(f"line {lineno}: unbalanced flow value")
        return value
    return _unquote(value)


def parse_lock(text: str) -> dict:
    """Parses the block-YAML subset pnpm writes (nested mappings, `- ` lists,
    flow values kept as text). Raises LockParseError on a duplicated key or an
    indentation that does not nest, as pnpm's own YAML loader does."""
    root: dict = {}
    stack: list[tuple[int, object]] = [(0, root)]
    pending: tuple[int, dict, str] | None = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        if raw.lstrip(" ").startswith("\t"):
            raise LockParseError(f"line {lineno}: tab in indentation")
        if pending is not None:
            p_indent, p_parent, p_key = pending
            pending = None
            if indent > p_indent:
                child: object = [] if stripped.startswith("- ") else {}
                p_parent[p_key] = child
                stack.append((indent, child))
        while len(stack) > 1 and indent < stack[-1][0]:
            stack.pop()
        level, container = stack[-1]
        if indent != level:
            raise LockParseError(f"line {lineno}: bad indentation ({indent}, expected {level})")
        if isinstance(container, list):
            if not stripped.startswith("- "):
                raise LockParseError(f"line {lineno}: bad indentation (mapping key inside a list)")
            container.append(_scalar(stripped[2:].strip(), lineno))
            continue
        if stripped.startswith("- "):
            raise LockParseError(f"line {lineno}: bad indentation (list item inside a mapping)")
        key, value = _split_key(stripped, lineno)
        if key in container:
            raise LockParseError(f"line {lineno}: duplicated mapping key {key!r}")
        if value == "":
            container[key] = None
            pending = (indent, container, key)
        else:
            container[key] = _scalar(value, lineno)
    return root


def check_lock_shape(doc: dict) -> None:
    """Every packages entry carries its resolution; every snapshot is a mapping."""
    for section in ("importers", "packages", "snapshots"):
        if not isinstance(doc.get(section), dict):
            raise LockParseError(f"no {section}: section")
    for key, entry in doc["packages"].items():
        if not isinstance(entry, dict) or "resolution" not in entry:
            raise LockParseError(f"packages {key!r} has no resolution")
    for key, entry in doc["snapshots"].items():
        if not (isinstance(entry, dict) or entry == "{}"):
            raise LockParseError(f"snapshots {key!r} is not a mapping")


def npm_packages(package_lock: dict) -> set[tuple[str, str]]:
    """(name, version) of every installed package in package-lock.json."""
    packages = set()
    for path, meta in package_lock["packages"].items():
        if "node_modules/" not in path or meta.get("link") or "version" not in meta:
            continue
        # A bundleDependencies copy ships inside its parent's tarball;
        # pnpm-lock.yaml never lists it, and no override can move it.
        if meta.get("inBundle"):
            continue
        # An npm alias ("x": "npm:@scope/y@1") installs @scope/y under x;
        # pnpm-lock.yaml keys the package by its real name.
        packages.add((meta.get("name") or path.rsplit("node_modules/", 1)[1], meta["version"]))
    return packages


class LockfilesInSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.lock = _read(_web("pnpm-lock.yaml"))
        cls.package_lock = json.loads(_read(_web("package-lock.json")))

    def test_lockfile_parses(self) -> None:
        # pnpm rejects a broken lockfile (ERR_PNPM_BROKEN_LOCKFILE) and so does
        # rules_js; the line-based checks below cannot see it, this parse does.
        check_lock_shape(parse_lock(self.lock))

    def test_importers_match_package_json(self) -> None:
        importers = pnpm_importers(self.lock)
        expected = workspaces()
        self.assertEqual(set(importers), set(expected))
        for importer, manifest in expected.items():
            package = json.loads(_read(_web(manifest)))
            declared = {}
            for field in DEP_FIELDS:
                declared.update(package.get(field, {}))
            with self.subTest(importer=importer):
                self.assertEqual(importers[importer], declared, f"{manifest} differs from pnpm-lock.yaml; re-run pnpm import")

    def test_same_resolved_packages(self) -> None:
        npm = npm_packages(self.package_lock)
        pnpm = pnpm_packages(self.lock)
        self.assertGreater(len(npm), 0)
        self.assertEqual(sorted(npm - pnpm), [], "in package-lock.json only; re-run pnpm import")
        self.assertEqual(sorted(pnpm - npm), [], "in pnpm-lock.yaml only; re-run pnpm import")

    def test_rules_ts_typescript_matches_lock(self) -> None:
        if not CHECK_RULES_TS:
            self.skipTest("no --rules-ts-typescript")
        module = _read("MODULE.bazel")
        match = re.search(r"typescript\.deps\(\s*integrity = \"([^\"]+)\",\s*version = \"([^\"]+)\",\s*\)", module)
        self.assertIsNotNone(match, "MODULE.bazel has no typescript.deps(integrity, version)")
        integrity, version = match.groups()
        versions = {v for name, v in pnpm_packages(self.lock) if name == "typescript"}
        self.assertEqual(versions, {version}, "MODULE.bazel typescript.deps version differs from pnpm-lock.yaml")
        self.assertEqual(integrity, pnpm_integrity(self.lock, "typescript", version))


class PnpmLockParseTest(unittest.TestCase):
    """parse_lock is a real parse of the block YAML pnpm writes (fork PR #7 review B1:
    a lockfile with entries spliced mid-file passed the line-based checks)."""

    GOOD = (
        "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      c:\n"
        "        specifier: ^2.0.0\n        version: 2.0.0\n\npackages:\n\n"
        "  '@a/b@1.0.0':\n    resolution: {integrity: sha512-x}\n    engines: {node: '>=18'}\n\n"
        "  c@2.0.0:\n    resolution: {integrity: sha512-y}\n\n"
        "snapshots:\n\n  '@a/b@1.0.0':\n    dependencies:\n      c: 2.0.0\n\n  c@2.0.0: {}\n"
    )

    def test_good_lock_parses(self) -> None:
        doc = parse_lock(self.GOOD)
        self.assertEqual(doc["packages"]["c@2.0.0"]["resolution"], "{integrity: sha512-y}")
        self.assertEqual(doc["snapshots"]["@a/b@1.0.0"]["dependencies"], {"c": "2.0.0"})

    def test_spliced_entry_is_a_duplicated_key(self) -> None:
        spliced = self.GOOD.replace(
            "  c@2.0.0:\n    resolution: {integrity: sha512-y}\n",
            "  c@2.0.0:\n  d@3.0.0:\n    resolution: {integrity: sha512-z}\n\n    resolution: {integrity: sha512-y}\n",
        )
        with self.assertRaisesRegex(LockParseError, "duplicated mapping key"):
            parse_lock(spliced)

    def test_bad_indentation_fails(self) -> None:
        # a line that dedents to no open level (5 is neither 4 nor 6)
        bad = self.GOOD.replace("      c: 2.0.0", "      c: 2.0.0\n     d: 1.0.0")
        with self.assertRaisesRegex(LockParseError, "indentation"):
            parse_lock(bad)

    def test_package_without_resolution_fails(self) -> None:
        bad = self.GOOD.replace("  c@2.0.0:\n    resolution: {integrity: sha512-y}\n", "  c@2.0.0:\n    engines: {}\n")
        with self.assertRaisesRegex(LockParseError, "no resolution"):
            check_lock_shape(parse_lock(bad))

    def test_unbalanced_flow_value_fails(self) -> None:
        with self.assertRaisesRegex(LockParseError, "flow"):
            parse_lock(self.GOOD.replace("{integrity: sha512-x}", "{integrity: sha512-x"))


if __name__ == "__main__":
    args = sys.argv[1:]
    CHECK_RULES_TS = "--rules-ts-typescript" in args
    positional = [a for a in args if not a.startswith("--")]
    if len(positional) != 1:
        sys.exit("usage: pnpm_lock_in_sync_test.py <lockfile dir> [--rules-ts-typescript]")
    LOCK_DIR = positional[0]
    unittest.main(argv=sys.argv[:1])
