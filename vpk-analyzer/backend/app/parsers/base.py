from dataclasses import dataclass
from typing import BinaryIO


@dataclass(frozen=True)
class VirtualEntry:
	path: str
	name: str
	kind: str
	size: int
	compressed_size: int = 0


@dataclass
class ParsedPackage:
	format: str
	confidence: int
	message: str
	entries: list[VirtualEntry]
	metadata: dict[str, str | int | None]


class VPKParser:
	format_name = "unknown"

	def parse(self, source: BinaryIO) -> ParsedPackage:
		raise NotImplementedError
