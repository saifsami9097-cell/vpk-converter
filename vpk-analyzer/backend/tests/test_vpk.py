import io
import zipfile
from pathlib import Path

import pytest

from app.parsers.detector import detect_vpk, parse_vpk
from app.services.storage import PackageStore


def vita_archive() -> io.BytesIO:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("sce_sys/param.sfo", build_sfo({"TITLE_ID": "TEST00001", "TITLE": "Fixture App", "APP_VER": "1.0"}))
        archive.writestr("sce_sys/icon0.png", b"\x89PNG\r\n")
        archive.writestr("data/readme.txt", "hello VPK")
        archive.writestr("eboot.bin", b"never execute")
    buffer.seek(0)
    return buffer


def build_sfo(values: dict[str, str]) -> bytes:
    keys = b"".join(key.encode() + b"\0" for key in values)
    value_data = b"".join(value.encode() + b"\0" for value in values.values())
    key_offset = 20 + len(values) * 16
    value_offset = key_offset + len(keys)
    records = bytearray()
    key_cursor = 0
    value_cursor = 0
    for key, value in values.items():
        encoded = value.encode() + b"\0"
        records.extend((key_cursor).to_bytes(2, "little"))
        records.extend((0x0204).to_bytes(2, "little"))
        records.extend(len(encoded).to_bytes(4, "little"))
        records.extend(len(encoded).to_bytes(4, "little"))
        records.extend(value_cursor.to_bytes(4, "little"))
        key_cursor += len(key) + 1
        value_cursor += len(encoded)
    header = b"\x00PSF" + (0x101).to_bytes(4, "little") + key_offset.to_bytes(4, "little") + value_offset.to_bytes(4, "little") + len(values).to_bytes(4, "little")
    return header + records + keys + value_data


def test_detect_and_parse_ps_vita():
    source = vita_archive()
    assert detect_vpk(source) == ("ps_vita", 98, "PS Vita package layout detected")
    parsed = parse_vpk(source)
    assert parsed.format == "ps_vita"
    assert parsed.metadata["application_id"] == "TEST00001"
    assert parsed.metadata["title"] == "Fixture App"
    assert {entry.path for entry in parsed.entries if entry.kind == "file"} == {"sce_sys/param.sfo", "sce_sys/icon0.png", "data/readme.txt", "eboot.bin"}


def test_unknown_package_is_reported():
    source = io.BytesIO(b"not a package")
    assert detect_vpk(source) == ("unknown", 0, "Unsupported or unknown VPK format")


def test_storage_extract_and_zip(tmp_path: Path):
    uploads = tmp_path / "uploads"
    extracted = tmp_path / "extracted"
    uploads.mkdir()
    package_id = "a" * 32
    (uploads / f"{package_id}.vpk").write_bytes(vita_archive().getvalue())
    store = PackageStore(uploads, extracted)
    destination = store.extract(package_id, ["data/readme.txt"])
    assert (destination / "data" / "readme.txt").read_text() == "hello VPK"
    with zipfile.ZipFile(store.zip_contents(package_id)) as archive:
        assert set(archive.namelist()) == {"sce_sys/param.sfo", "sce_sys/icon0.png", "data/readme.txt", "eboot.bin"}


def test_path_traversal_is_rejected(tmp_path: Path):
    store = PackageStore(tmp_path / "uploads", tmp_path / "extracted")
    with pytest.raises(Exception):
        store.safe_relative_path("../../important-file")