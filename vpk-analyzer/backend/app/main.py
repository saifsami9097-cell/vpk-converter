import os
import re
import mimetypes
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from app.services.storage import PackageStore


logger = logging.getLogger("vpk_analyzer")
logger.setLevel(logging.INFO)
if not logger.handlers:
    log_handler = logging.StreamHandler()
    log_handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    logger.addHandler(log_handler)
logger.propagate = False


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


def error_payload(message: str) -> dict[str, object]:
    return {"success": False, "error": message}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=error_payload(str(exc.detail)))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content=error_payload("Invalid request payload"))


@app.exception_handler(ResponseValidationError)
async def response_validation_exception_handler(request: Request, exc: ResponseValidationError) -> JSONResponse:
    logger.exception("Backend response validation error for %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=error_payload("The server returned an invalid response"))


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error for %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content=error_payload("The server could not process the request"))


@app.get("/health", tags=["system"])
@app.get("/api/health", tags=["system"])
def health_check() -> dict[str, object]:
    return {"success": True, "status": "Backend is running", "service": "vpk-analyzer"}


def safe_filename(filename: str) -> str:
    """Keep only a display-safe basename; storage uses a generated ID."""
    basename = Path(filename or "package.vpk").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", basename).strip(".")
    return cleaned or "package.vpk"


@app.post("/api/vpk/upload", status_code=201, tags=["vpk"])
async def upload_vpk(file: UploadFile = File(...)) -> dict[str, object]:
    logger.info("=== VPK UPLOAD REQUEST ===")
    logger.info("Request received")
    if file is None:
        logger.error("ERROR: No file received")
        raise HTTPException(status_code=400, detail="No VPK file was received")

    filename = safe_filename(file.filename or "package.vpk")
    logger.info("File received: %s", filename)
    if not filename.lower().endswith(".vpk"):
        logger.warning("Rejected upload with wrong extension: %s", filename)
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
        logger.info("File saved: %s bytes", total_bytes)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise
    except OSError:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="The uploaded file could not be stored")
    finally:
        await file.close()

    if total_bytes == 0:
        destination.unlink(missing_ok=True)
        logger.warning("Rejected empty upload")
        raise HTTPException(status_code=400, detail="Invalid or unsupported VPK file")

    logger.info("File validated; VPK parsing started")
    parsed = store.parse(upload_id)
    logger.info("VPK parsing completed: format=%s confidence=%s", parsed.format, parsed.confidence)
    if parsed.format == "unknown":
        destination.unlink(missing_ok=True)
        logger.warning("Rejected invalid or unsupported VPK: %s", filename)
        raise HTTPException(status_code=400, detail="Invalid or unsupported VPK file")

    logger.info("JSON response created for upload %s", upload_id)
    return {
        "success": True,
        "data": {
            "id": upload_id,
            "filename": filename,
            "size": total_bytes,
            "status": "uploaded",
            "message": "Upload received. Analysis is ready to begin.",
        },
    }


class ExtractionRequest(BaseModel):
    paths: list[str] | None = None


@app.get("/api/vpk/{package_id}/info", tags=["vpk"])
def package_info(package_id: str) -> dict[str, object]:
    package = store.parse(package_id)
    files = [entry for entry in package.entries if entry.kind == "file"]
    directories = [entry for entry in package.entries if entry.kind == "directory"]
    return {"success": True, "data": {
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
    }}


@app.get("/api/vpk/{package_id}/analyze", tags=["vpk"])
def analyze_package(package_id: str) -> dict[str, object]:
    logger.info("=== VPK ANALYZE REQUEST ===")
    logger.info("VPK analysis started: %s", package_id)
    package = store.parse(package_id)
    files = [entry for entry in package.entries if entry.kind == "file"]
    directories = [entry for entry in package.entries if entry.kind == "directory"]
    logger.info("VPK analysis completed: %s format=%s files=%s", package_id, package.format, len(files))
    return {"success": True, "data": {
        "id": package_id,
        "format": package.format,
        "confidence": package.confidence,
        "message": package.message,
        "file_count": len(files),
        "directory_count": len(directories),
        "total_uncompressed_size": sum(entry.size for entry in files),
        "metadata": package.metadata,
        "entries": [entry.__dict__ for entry in package.entries],
    }}


@app.get("/api/vpk/{package_id}/tree", tags=["vpk"])
def package_tree(package_id: str) -> dict[str, object]:
    package = store.parse(package_id)
    return {"success": True, "data": {
        "format": package.format,
        "confidence": package.confidence,
        "message": package.message,
        "entries": [entry.__dict__ for entry in package.entries],
    }}


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
    logger.info("=== VPK EXTRACT REQUEST ===")
    logger.info("VPK extraction started: %s", package_id)
    destination = store.extract(package_id, request.paths if request else None)
    logger.info("VPK extraction completed: %s", package_id)
    return {"success": True, "data": {"id": package_id, "directory": "extracted", "status": "extracted"}}


@app.get("/api/vpk/{package_id}/download", tags=["vpk"])
def download_package(package_id: str) -> StreamingResponse:
    archive = store.zip_contents(package_id)
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="vpk-contents.zip"'},
    )


@app.delete("/api/vpk/{package_id}", tags=["vpk"])
def delete_package(package_id: str) -> dict[str, object]:
    store.delete(package_id)
    return {"success": True, "data": {"id": package_id, "status": "deleted"}}
