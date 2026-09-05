import zipfile
from pathlib import PurePosixPath
from typing import BinaryIO

from .base import ParsedPackage
from .ps_vita import PSVitaParser


def detect_vpk(source: BinaryIO) -> tuple[str, int, str]:
	"""Identify formats from bytes and internal layout, never from extension alone."""
	source.seek(0)
	header = source.read(4)
	source.seek(0)
	if header == b"MDKV":
		return "valve_vpk", 95, "Valve VPK signature detected; full directory parsing is not enabled yet"
	try:
		with zipfile.ZipFile(source) as archive:
			names = {PurePosixPath(item.filename.replace("\\", "/")).as_posix().lower() for item in archive.infolist()}
			has_sce_sys = any(name == "sce_sys" or name.startswith("sce_sys/") for name in names)
			has_eboot = "eboot.bin" in names
			if has_sce_sys or has_eboot:
				return "ps_vita", 98, "PS Vita package layout detected"
	except (zipfile.BadZipFile, OSError):
		return "unknown", 0, "Unsupported or unknown VPK format"
	return "unknown", 0, "Unsupported or unknown VPK format"


def parse_vpk(source: BinaryIO) -> ParsedPackage:
	format_name, confidence, message = detect_vpk(source)
	if format_name == "ps_vita":
		return PSVitaParser().parse(source)
	return ParsedPackage(format_name, confidence, message, [], {})
