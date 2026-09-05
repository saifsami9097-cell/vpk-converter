import os
import re
from pathlib import Path
import mimetypes
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from app.services.storage import PackageStore


BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_DIR = BASE_DIR / "uploads"
MAX_UPLOAD_BYTES = int(os.getenv("VPK_MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXTRACTED_DIR = BASE_DIR / "extracted"
store = PackageStore(UPLOAD_DIR, EXTRACTED_DIR)


app = FastAPI(
    title="VPK Analyzer API",
    version="0.1.0",
    description="Safe analysis and exploration of VPK packages.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "vpk-analyzer"}


def safe_filename(filename: str) -> str:
    """Keep only a display-safe basename; storage uses a generated ID."""
    basename = Path(filename or "package.vpk").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", basename).strip(".")
    return cleaned or "package.vpk"


@app.post("/api/vpk/upload", status_code=201, tags=["vpk"])
async def upload_vpk(file: UploadFile = File(...)) -> dict[str, object]:
    filename = safe_filename(file.filename or "package.vpk")
    if not filename.lower().endswith(".vpk"):
        raise HTTPException(status_code=415, detail="Only .vpk files are supported")

    upload_id = uuid4().hex
    destination = UPLOAD_DIR / f"{upload_id}.vpk"
    total_bytes = 0

    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="The VPK file exceeds the upload limit")
                output.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except OSError:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="The uploaded file could not be stored")
    finally:
        await file.close()

    return {
        "id": upload_id,
        "filename": filename,
        "size": total_bytes,
        "status": "uploaded",
        "message": "Upload received. Analysis is ready to begin.",
    }


class ExtractionRequest(BaseModel):
    paths: list[str] | None = None


@app.get("/api/vpk/{package_id}/info", tags=["vpk"])
def package_info(package_id: str) -> dict[str, object]:
    package = store.parse(package_id)
    files = [entry for entry in package.entries if entry.kind == "file"]
    directories = [entry for entry in package.entries if entry.kind == "directory"]
    return {
        "id": package_id,
        "filename": store.package_path(package_id).name,
        "size": store.package_path(package_id).stat().st_size,
        "format": package.format,
        "confidence": package.confidence,
        "message": package.message,
        "file_count": len(files),
        "directory_count": len(directories),
        "total_uncompressed_size": sum(entry.size for entry in files),
        "metadata": package.metadata,
    }


@app.get("/api/vpk/{package_id}/tree", tags=["vpk"])
def package_tree(package_id: str) -> dict[str, object]:
    package = store.parse(package_id)
    return {
        "format": package.format,
        "confidence": package.confidence,
        "message": package.message,
        "entries": [entry.__dict__ for entry in package.entries],
    }


@app.get("/api/vpk/{package_id}/file/{entry_path:path}", tags=["vpk"])
def package_file(package_id: str, entry_path: str) -> Response:
    safe_path = store.safe_relative_path(entry_path).as_posix()
    data, entry = store.archive_entry(package_id, safe_path)
    media_type = mimetypes.guess_type(entry.name)[0] or "application/octet-stream"
    previewable = media_type.startswith("text/") or media_type in {
        "application/json", "application/xml", "image/png", "image/jpeg", "image/gif", "image/svg+xml"
    }
    headers = {"Content-Disposition": f'{"inline" if previewable else "attachment"}; filename="{entry.name}"'}
    return Response(content=data, media_type=media_type, headers=headers)


@app.post("/api/vpk/{package_id}/extract", tags=["vpk"])
def extract_package(package_id: str, request: ExtractionRequest | None = None) -> dict[str, object]:
    destination = store.extract(package_id, request.paths if request else None)
    return {"id": package_id, "directory": str(destination), "status": "extracted"}


@app.get("/api/vpk/{package_id}/download", tags=["vpk"])
def download_package(package_id: str) -> StreamingResponse:
    archive = store.zip_contents(package_id)
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="vpk-contents.zip"'},
    )


@app.delete("/api/vpk/{package_id}", tags=["vpk"])
def delete_package(package_id: str) -> dict[str, str]:
    store.delete(package_id)
    return {"id": package_id, "status": "deleted"}
