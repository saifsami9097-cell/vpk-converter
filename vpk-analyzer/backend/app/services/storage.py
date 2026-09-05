import io
import shutil
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import HTTPException

from app.parsers.base import ParsedPackage, VirtualEntry
from app.parsers.detector import parse_vpk


class PackageStore:
    def __init__(self, upload_dir: Path, extracted_dir: Path):
        self.upload_dir = upload_dir
        self.extracted_dir = extracted_dir
        self.extracted_dir.mkdir(parents=True, exist_ok=True)

    def package_path(self, package_id: str) -> Path:
        if not package_id.isalnum():
            raise HTTPException(status_code=404, detail="Package not found")
        path = self.upload_dir / f"{package_id}.vpk"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Package not found")
        return path

    def parse(self, package_id: str) -> ParsedPackage:
        path = self.package_path(package_id)
        try:
            with path.open("rb") as source:
                return parse_vpk(source)
        except (zipfile.BadZipFile, ValueError, OSError) as error:
            if isinstance(error, ValueError) and "unsafe path" in str(error):
                raise HTTPException(status_code=422, detail="The package contains an unsafe path")
            return ParsedPackage("unknown", 0, "Unsupported or unknown VPK format", [], {})

    def archive_entry(self, package_id: str, entry_path: str) -> tuple[bytes, VirtualEntry]:
        package = self.parse(package_id)
        entry = next((item for item in package.entries if item.path == entry_path and item.kind == "file"), None)
        if entry is None:
            raise HTTPException(status_code=404, detail="File not found")
        with zipfile.ZipFile(self.package_path(package_id)) as archive:
            try:
                return archive.read(entry.path), entry
            except KeyError as error:
                raise HTTPException(status_code=404, detail="File not found") from error

    def extract(self, package_id: str, paths: list[str] | None = None) -> Path:
        package = self.parse(package_id)
        if package.format != "ps_vita":
            raise HTTPException(status_code=422, detail=package.message)
        wanted = set(paths or [entry.path for entry in package.entries if entry.kind == "file"])
        selected = [entry for entry in package.entries if entry.kind == "file" and (entry.path in wanted or any(entry.path.startswith(path.rstrip("/") + "/") for path in wanted))]
        destination = self.extracted_dir / package_id
        destination.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(self.package_path(package_id)) as archive:
            for entry in selected:
                safe = self.safe_relative_path(entry.path)
                target = destination / safe
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as output:
                    output.write(archive.read(entry.path))
        return destination

    def zip_contents(self, package_id: str, paths: list[str] | None = None) -> io.BytesIO:
        package = self.parse(package_id)
        if package.format != "ps_vita":
            raise HTTPException(status_code=422, detail=package.message)
        wanted = set(paths or [entry.path for entry in package.entries if entry.kind == "file"])
        result = io.BytesIO()
        with zipfile.ZipFile(self.package_path(package_id)) as source, zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as output:
            for entry in package.entries:
                if entry.kind == "file" and (entry.path in wanted or any(entry.path.startswith(path.rstrip("/") + "/") for path in wanted)):
                    output.writestr(self.safe_relative_path(entry.path).as_posix(), source.read(entry.path))
        result.seek(0)
        return result

    @staticmethod
    def safe_relative_path(path: str) -> Path:
        candidate = PurePosixPath(path.replace("\\", "/"))
        if candidate.is_absolute() or ".." in candidate.parts or not candidate.parts:
            raise HTTPException(status_code=422, detail="Unsafe archive path")
        return Path(*candidate.parts)

    def delete(self, package_id: str) -> None:
        path = self.package_path(package_id)
        path.unlink(missing_ok=True)
        shutil.rmtree(self.extracted_dir / package_id, ignore_errors=True)