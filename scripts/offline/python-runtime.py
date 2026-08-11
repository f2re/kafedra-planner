#!/usr/bin/env python3
"""Export a managed CPython runtime for Kafedra Planner recognition.

The exported runtime carries CPython, stdlib, libpython and non-glibc shared
libraries. It intentionally carries no user site-packages. The target installer
probes it before activation and recognition remains dependent only on bundled
OS packages (Tesseract/Poppler), not on the target system Python.
"""
from __future__ import print_function

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import sysconfig

EXCLUDED_DIR_NAMES = {"__pycache__", "site-packages", "dist-packages", "test", "tests", "idle_test", "idlelib", "ensurepip", "venv", "tkinter", "turtledemo"}
GLIBC_CORE_PREFIXES = (
    "ld-linux", "ld-musl", "libc.so", "libm.so", "libpthread.so", "libdl.so",
    "librt.so", "libresolv.so", "libutil.so", "libanl.so", "libBrokenLocale.so",
)
MIN_PYTHON = (3, 7)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_tree(source, destination):
    if destination.exists():
        shutil.rmtree(str(destination))

    def ignore(_directory, names):
        return set(name for name in names if name in EXCLUDED_DIR_NAMES or name.startswith("config-") or name.endswith((".pyc", ".pyo")))

    shutil.copytree(str(source), str(destination), symlinks=False, ignore=ignore)


def base_executable():
    version = "python%s.%s" % (sys.version_info.major, sys.version_info.minor)
    base = Path(sys.base_prefix)
    candidates = [
        Path(getattr(sys, "_base_executable", "") or ""), base / "bin" / version,
        base / "bin" / "python3", base / "bin" / "python", Path(sys.executable),
    ]
    for candidate in candidates:
        if not str(candidate):
            continue
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_file() and os.access(str(resolved), os.X_OK):
            return resolved
    raise RuntimeError("Не найден исполняемый файл базового Python")


def stdlib_path():
    version = "python%s.%s" % (sys.version_info.major, sys.version_info.minor)
    candidates = [
        Path(sysconfig.get_path("stdlib") or ""), Path(sys.base_prefix) / "lib" / version,
        Path(sys.base_prefix) / "lib64" / version,
    ]
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "os.py").is_file():
            return candidate.resolve()
    raise RuntimeError("Не найден каталог стандартной библиотеки Python")


def dependency_paths(binaries):
    if not shutil.which("ldd"):
        return set()
    result = set()
    mapped = re.compile(r"=>\s+(/[^\s]+)")
    direct = re.compile(r"^\s*(/[^\s]+)\s+\(")
    for binary in binaries:
        try:
            output = subprocess.check_output(["ldd", str(binary)], universal_newlines=True, stderr=subprocess.STDOUT)
        except (OSError, subprocess.CalledProcessError):
            continue
        for line in output.splitlines():
            match = mapped.search(line) or direct.search(line)
            if match:
                path = Path(match.group(1))
                if path.is_file():
                    result.add(path)
    return result


def is_glibc_core(path):
    return path.name.startswith(GLIBC_CORE_PREFIXES)


def copy_runtime_libraries(base, stdlib, executable, destination):
    destination.mkdir(parents=True, exist_ok=True)
    copied = {}
    search_dirs = {base / "lib", base / "lib64", Path(sysconfig.get_config_var("LIBDIR") or "")}
    configured_name = str(sysconfig.get_config_var("LDLIBRARY") or "")
    for directory in search_dirs:
        if not directory.is_dir():
            continue
        for pattern in ("libpython*.so*", "libpython*.dylib"):
            for path in directory.glob(pattern):
                if path.is_file():
                    copied.setdefault(path.name, path.resolve())
        if configured_name:
            path = directory / configured_name
            if path.is_file():
                copied.setdefault(path.name, path.resolve())
    dynload = stdlib / "lib-dynload"
    binaries = [executable]
    if dynload.is_dir():
        binaries.extend(path for path in dynload.glob("*.so") if path.is_file())
    for dependency in dependency_paths(binaries):
        if not is_glibc_core(dependency):
            copied.setdefault(dependency.name, dependency)
    for name, source in sorted(copied.items()):
        target = destination / name
        shutil.copy2(str(source), str(target), follow_symlinks=True)
        if os.access(str(source), os.X_OK):
            target.chmod(target.stat().st_mode | 0o111)
    return sorted(copied)


def glibc_requirement(binaries):
    if not shutil.which("objdump"):
        return ""
    versions = []
    pattern = re.compile(r"GLIBC_(\d+(?:\.\d+)*)")
    for binary in binaries:
        try:
            output = subprocess.check_output(["objdump", "-T", str(binary)], universal_newlines=True, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.CalledProcessError):
            continue
        for match in pattern.finditer(output):
            versions.append(tuple(int(part) for part in match.group(1).split(".")))
    if not versions:
        return ""
    return ".".join(str(part) for part in max(versions))


def inspect_runtime():
    if sys.version_info[:2] < MIN_PYTHON:
        raise RuntimeError("Для managed recognition runtime требуется CPython %s.%s или новее" % MIN_PYTHON)
    executable = base_executable()
    stdlib = stdlib_path()
    dynload = stdlib / "lib-dynload"
    binaries = [executable]
    if dynload.is_dir():
        binaries.extend(path for path in dynload.glob("*.so") if path.is_file())
    version = "%s.%s.%s" % sys.version_info[:3]
    digest = hashlib.sha256()
    digest.update(version.encode("ascii"))
    digest.update(platform.machine().lower().encode("ascii"))
    digest.update(sha256(executable).encode("ascii"))
    return {
        "version": version,
        "major": sys.version_info.major,
        "minor": sys.version_info.minor,
        "micro": sys.version_info.micro,
        "implementation": platform.python_implementation(),
        "architecture": platform.machine().lower(),
        "platform": platform.system().lower(),
        "libc": list(platform.libc_ver()),
        "glibc_required": glibc_requirement(binaries),
        "source_executable": str(executable),
        "source_base_prefix": str(Path(sys.base_prefix).resolve()),
        "source_stdlib": str(stdlib),
        "soabi": str(sysconfig.get_config_var("SOABI") or ""),
        "runtime_id": digest.hexdigest()[:16],
    }


def export_runtime(destination):
    info = inspect_runtime()
    destination = Path(destination).resolve()
    temporary = destination.with_name(destination.name + ".tmp-%s" % os.getpid())
    if temporary.exists():
        shutil.rmtree(str(temporary))
    temporary.mkdir(parents=True)
    prefix = temporary / "prefix"
    bin_dir = prefix / "bin"
    lib_dir = prefix / "lib"
    version_xy = "%s.%s" % (info["major"], info["minor"])
    executable = Path(info["source_executable"])
    stdlib = Path(info["source_stdlib"])
    bin_dir.mkdir(parents=True)
    lib_dir.mkdir(parents=True)
    real_name = "python%s" % version_xy
    shutil.copy2(str(executable), str(bin_dir / real_name), follow_symlinks=True)
    (bin_dir / real_name).chmod(0o755)
    copy_tree(stdlib, lib_dir / ("python%s" % version_xy))
    libraries = copy_runtime_libraries(Path(info["source_base_prefix"]), stdlib, executable, lib_dir)
    launcher = temporary / "python"
    launcher.write_text(
        "#!/bin/sh\nset -eu\n"
        "ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n"
        "PREFIX=\"$ROOT/prefix\"\n"
        "REAL=\"$PREFIX/bin/%s\"\n" % real_name +
        "export PYTHONHOME=\"$PREFIX\"\n"
        "export PYTHONNOUSERSITE=1\n"
        "export PYTHONDONTWRITEBYTECODE=1\n"
        "export LD_LIBRARY_PATH=\"$PREFIX/lib:$PREFIX/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\"\n"
        "exec \"$REAL\" \"$@\"\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)
    license_candidates = [
        Path(sys.base_prefix) / "LICENSE", Path(sys.base_prefix) / "LICENSE.txt",
        Path("/usr/share/doc/python%s.%s/copyright" % (info["major"], info["minor"])),
        Path("/usr/share/doc/python3/copyright"),
    ]
    license_source = next((item for item in license_candidates if item.is_file()), None)
    if license_source:
        shutil.copy2(str(license_source), str(temporary / "LICENSE.python"))
        info["license_sha256"] = sha256(temporary / "LICENSE.python")
    else:
        info["license_sha256"] = None
    info["libraries"] = libraries
    info["launcher"] = "python"
    info["prefix"] = "prefix"
    (temporary / "runtime.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    probe = subprocess.run(
        [str(launcher), "-c", "import json,sqlite3,ssl,sys; print(json.dumps({'version':list(sys.version_info[:3]),'prefix':sys.prefix}))"],
        universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
    )
    if probe.returncode != 0:
        shutil.rmtree(str(temporary), ignore_errors=True)
        raise RuntimeError("Экспортированный Python не запускается: %s" % (probe.stderr.strip() or probe.stdout.strip()))
    if destination.exists():
        shutil.rmtree(str(destination))
    temporary.replace(destination)
    return info


def main(argv=None):
    parser = argparse.ArgumentParser(description="Подготовка managed CPython для распознавания")
    sub = parser.add_subparsers(dest="command")
    inspect_p = sub.add_parser("inspect")
    inspect_p.add_argument("--json", action="store_true")
    export_p = sub.add_parser("export")
    export_p.add_argument("--destination", required=True)
    args = parser.parse_args(argv)
    if args.command not in ("inspect", "export"):
        parser.error("не указана команда inspect/export")
    try:
        info = inspect_runtime() if args.command == "inspect" else export_runtime(args.destination)
        print(json.dumps(info, ensure_ascii=False, indent=2))
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print("Ошибка подготовки Python runtime: %s" % exc, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
