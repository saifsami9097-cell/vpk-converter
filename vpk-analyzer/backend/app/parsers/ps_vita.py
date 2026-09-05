import struct
import zipfile
from pathlib import PurePosixPath
from typing import BinaryIO

from .base import ParsedPackage, VPKParser, VirtualEntry


def _normalise_member(name: str) -> str:
	path = PurePosixPath(name.replace("\\", "/"))
	if path.is_absolute() or ".." in path.parts:
		raise ValueError("Archive contains an unsafe path")
	return "/".join(part for part in path.parts if part not in ("", "."))


def _parse_sfo(data: bytes) -> dict[str, str]:
	if len(data) < 20 or data[:4] != b"\x00PSF":
		return {}
	_, version, key_offset, value_offset, count = struct.unpack_from("<5I", data, 0)
	result: dict[str, str] = {}
	for index in range(count):
		offset = 20 + index * 16
		if offset + 16 > len(data):
			break
		key_rel, data_fmt, data_len, data_max, data_rel = struct.unpack_from("<HHIII", data, offset)
		key_start = key_offset + key_rel
		value_start = value_offset + data_rel
		if key_start >= len(data) or value_start >= len(data):
			continue
		key_end = data.find(b"\0", key_start)
		key = data[key_start:key_end if key_end >= 0 else len(data)].decode("utf-8", "replace")
		raw = data[value_start:value_start + min(data_len, data_max)]
		if data_fmt & 0xFF == 0x04:
			result[key] = raw.rstrip(b"\0").decode("utf-8", "replace")
	return result


class PSVitaParser(VPKParser):
	format_name = "ps_vita"

	def parse(self, source: BinaryIO) -> ParsedPackage:
		source.seek(0)
		with zipfile.ZipFile(source) as archive:
			entries: list[VirtualEntry] = []
			metadata: dict[str, str | int | None] = {
				"application_id": None,
				"title": None,
				"version": None,
			}
			seen_directories: set[str] = set()
			for info in archive.infolist():
				path = _normalise_member(info.filename)
				if not path:
					continue
				parts = path.split("/")
				for index in range(1, len(parts)):
					directory = "/".join(parts[:index])
					if directory not in seen_directories:
						seen_directories.add(directory)
						entries.append(VirtualEntry(directory, parts[index - 1], "directory", 0))
				if info.is_dir():
					continue
				entries.append(VirtualEntry(path, parts[-1], "file", info.file_size, info.compress_size))
				if path.lower() == "sce_sys/param.sfo":
					metadata.update({
						"application_id": None,
						"title": None,
						"version": None,
					})
					values = _parse_sfo(archive.read(info))
					metadata["application_id"] = values.get("TITLE_ID") or values.get("APP_VER")
					metadata["title"] = values.get("TITLE")
					metadata["version"] = values.get("APP_VER")
			entries.sort(key=lambda entry: (entry.kind != "directory", entry.path.lower()))
			return ParsedPackage(
				self.format_name,
				98,
				"PS Vita package layout detected",
				entries,
				metadata,
			)
