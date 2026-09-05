# VPK Analyzer & Explorer

This prototype uploads, detects, analyzes, explores, previews, extracts, downloads, and deletes VPK packages without executing their contents.

- React, TypeScript, and Vite frontend
- FastAPI backend with a health endpoint
- Isolated parser, API, service, model, and utility packages
- Controlled `uploads/` and `extracted/` directories
- PS Vita ZIP-backed VPK detection, `sce_sys/param.sfo` metadata, virtual tree browsing, safe previews, extraction, and ZIP export
- Explicit unsupported/unknown format responses

The application never executes files contained in a VPK. VPK-to-APK conversion is intentionally not implemented.

## Requirements

- Python 3.11+
- Node.js 20+
- npm 10+

## Development

### Backend

Windows PowerShell:

```powershell
cd vpk-analyzer/backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Linux/macOS:

```bash
cd vpk-analyzer/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The backend runs at `http://127.0.0.1:8000`. OpenAPI documentation is available at `/docs`.

### Frontend

```bash
cd vpk-analyzer/frontend
npm install
npm run dev
```

The frontend runs at the URL printed by Vite, normally `http://127.0.0.1:5173`.

## Environment variables

`VPK_MAX_UPLOAD_BYTES` optionally controls the upload limit. It defaults to 2 GiB.

## API endpoints

- `POST /api/vpk/upload` - validate the `.vpk` filename and store a generated-ID upload
- `GET /api/vpk/{id}/info` - format, confidence, counts, sizes, and safe metadata
- `GET /api/vpk/{id}/tree` - virtual file and directory entries
- `GET /api/vpk/{id}/file/{path}` - safe text, JSON, XML, and image preview/download
- `POST /api/vpk/{id}/extract` - extract all files into the controlled `extracted/` directory
- `GET /api/vpk/{id}/download` - stream a ZIP of the package contents
- `DELETE /api/vpk/{id}` - remove the upload and extracted data

## Tests

```powershell
cd vpk-analyzer\backend
.\.venv\Scripts\python.exe -m pytest -q
```

The tests generate a small PS Vita-shaped VPK fixture at runtime in `tests/fixtures/` because real packages may be very large and are not redistributed.

## Known limitations

- PS Vita packages are supported when they use the ZIP-backed layout and contain recognizable members such as `sce_sys/` or `eboot.bin`.
- Valve VPK signatures are detected, but Valve directory records are not parsed yet; the UI reports this as detected but unsupported.
- Preview is limited to text-like files and common images. Executables such as `eboot.bin` are never executed.
- Uploads are local temporary files; production deployments should add lifecycle cleanup and authentication.

## Next step

Implement the Valve VPK binary directory parser behind the existing detector/parser interface, then add integration tests for real Valve fixtures.
