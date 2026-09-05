import { ChangeEvent, DragEvent, useRef, useState } from "react";

type UploadedPackage = { id: string; filename: string; size: number };
type PackageInfo = UploadedPackage & {
  format: string;
  confidence: number;
  message: string;
  file_count: number;
  directory_count: number;
  total_uncompressed_size: number;
  metadata: Record<string, string | number | null>;
};
type Entry = { path: string; name: string; kind: "file" | "directory"; size: number };
type Preview = { name: string; content: string; image?: string };

type JsonValue = Record<string, any>;

function App() {
  const [uploaded, setUploaded] = useState<UploadedPackage | null>(null);
  const [info, setInfo] = useState<PackageInfo | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const analyze = async (packageFile: UploadedPackage) => {
    setBusy("Analyzing");
    setError("");
    try {
      const [infoResponse, treeResponse] = await Promise.all([
        fetch(`/api/vpk/${packageFile.id}/info`),
        fetch(`/api/vpk/${packageFile.id}/tree`),
      ]);
      const infoPayload = await readJson(infoResponse);
      const treePayload = await readJson(treeResponse);
      if (!infoResponse.ok || !treeResponse.ok) throw new Error(infoPayload.detail || treePayload.detail || "Analysis failed");
      setInfo({ ...infoPayload, id: packageFile.id, filename: packageFile.filename, size: packageFile.size } as PackageInfo);
      setEntries(treePayload.entries);
      setCurrentPath("");
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Analysis failed");
    } finally {
      setBusy("");
    }
  };

  const extract = async () => {
    if (!uploaded) return;
    setBusy("Extracting");
    setError("");
    try {
      const response = await fetch(`/api/vpk/${uploaded.id}/extract`, { method: "POST" });
      if (!response.ok) throw new Error((await readJson(response)).detail || "Extraction failed");
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Extraction failed");
    } finally {
      setBusy("");
    }
  };

  const deletePackage = async () => {
    if (!uploaded) return;
    setBusy("Deleting");
    try {
      const response = await fetch(`/api/vpk/${uploaded.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      setUploaded(null);
      setInfo(null);
      setEntries([]);
      setPreview(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">V</div>
        <div><p className="eyebrow">Developer utility / prototype</p><h1>VPK Analyzer</h1></div>
        <span className="status-pill"><span />{info ? "Package loaded" : "Local workspace"}</span>
      </header>
      {!uploaded ? (
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy"><p className="section-label">Package intelligence</p><h2 id="page-title">Open the package.<br /><em>See what is inside.</em></h2><p className="hero-description">Inspect VPK structure, metadata, and safe file previews without executing package contents.</p></div>
          <UploadPanel onUploaded={setUploaded} onAnalyze={analyze} />
        </section>
      ) : (
        <section className="workspace">
          <div className="workspace-heading"><div><p className="section-label">Package workspace</p><h2>{uploaded.filename}</h2></div><div className="action-row"><button onClick={() => void analyze(uploaded)} disabled={!!busy}>Analyze</button><button onClick={() => void extract()} disabled={!!busy || !info}>Extract All</button><a className="button-link" href={`/api/vpk/${uploaded.id}/download`}>Download ZIP</a><button className="danger-button" onClick={() => void deletePackage()} disabled={!!busy}>Delete</button></div></div>
          {error && <p className="error-banner" role="alert">{error}</p>}
          {busy && <p className="busy-line">{busy} package...</p>}
          {info && <MetadataPanel info={info} />}
          {info && info.format !== "ps_vita" ? <div className="unsupported"><strong>{info.format === "unknown" ? "Unsupported or unknown VPK format" : "Detected format is not yet supported"}</strong><span>{info.message}</span></div> : info && <Explorer entries={entries} currentPath={currentPath} setCurrentPath={setCurrentPath} onPreview={setPreview} packageId={uploaded.id} />}
          {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}
        </section>
      )}
      <footer className="footer-bar"><span>Analysis is local to this workspace</span><span className="footer-divider" /><span>Nothing is executed</span></footer>
    </main>
  );
}

function UploadPanel({ onUploaded, onAnalyze }: { onUploaded: (value: UploadedPackage) => void; onAnalyze: (value: UploadedPackage) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".vpk")) { setError("Choose a file with the .vpk extension."); return; }
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const response = await fetch("/api/vpk/upload", { method: "POST", body: form });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result.detail || "Upload failed");
      const packageFile = { id: result.id, filename: result.filename, size: result.size };
      onUploaded(packageFile);
      await onAnalyze(packageFile);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void upload(file);
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return <div className={`upload-panel${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop} role="region" aria-label="Upload VPK file">
    <div className="upload-icon" aria-hidden="true">↥</div><h3>{busy ? "Uploading package..." : "Drop a VPK file here"}</h3><p>or choose one from your workspace</p><input ref={inputRef} className="file-input" type="file" accept=".vpk,application/octet-stream" onChange={onChange} /><button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Please wait" : "Choose VPK File"} <span>→</span></button>{error && <p className="upload-error" role="alert">{error}</p>}<small>PS Vita VPK · Valve VPK · unsupported formats reported safely</small>
  </div>;
}

function MetadataPanel({ info }: { info: PackageInfo }) {
  return <div className="metadata-panel"><div><span>Detected format</span><strong>{info.format === "ps_vita" ? "PS Vita VPK" : info.format}</strong></div><div><span>Confidence</span><strong>{info.confidence}%</strong></div><div><span>Files / directories</span><strong>{info.file_count} / {info.directory_count}</strong></div><div><span>Uncompressed</span><strong>{formatBytes(info.total_uncompressed_size)}</strong></div><div><span>Application ID</span><strong>{info.metadata.application_id || "Not present"}</strong></div><div><span>Title / version</span><strong>{info.metadata.title || "Not present"} {info.metadata.version ? `· ${info.metadata.version}` : ""}</strong></div></div>;
}

function Explorer({ entries, currentPath, setCurrentPath, onPreview, packageId }: { entries: Entry[]; currentPath: string; setCurrentPath: (path: string) => void; onPreview: (value: Preview) => void; packageId: string }) {
  const prefix = currentPath ? `${currentPath}/` : "";
  const visible = entries.filter((entry) => {
    if (!entry.path.startsWith(prefix) || entry.path === currentPath) return false;
    const rest = entry.path.slice(prefix.length);
    return !rest.includes("/") || (entry.kind === "directory" && rest.indexOf("/") === rest.length - 1);
  }).filter((entry, index, list) => list.findIndex((candidate) => candidate.path === entry.path) === index);
  const breadcrumbs = currentPath ? currentPath.split("/") : [];
  return <div className="explorer"><div className="explorer-head"><div><p className="section-label">Virtual file tree</p><h3>VPK Explorer</h3></div><span>{currentPath || "/"}</span></div><div className="breadcrumbs"><button onClick={() => setCurrentPath("")}>root</button>{breadcrumbs.map((part, index) => <span key={part}><b>/</b><button onClick={() => setCurrentPath(breadcrumbs.slice(0, index + 1).join("/"))}>{part}</button></span>)}</div><div className="file-list">{visible.length ? visible.map((entry) => <button className="file-row" key={entry.path} onClick={() => entry.kind === "directory" ? setCurrentPath(entry.path) : void previewFile(packageId, entry, onPreview)}><span className="file-icon">{entry.kind === "directory" ? "▸" : "·"}</span><span>{entry.name}</span><small>{entry.kind === "file" ? formatBytes(entry.size) : "directory"}</small></button>) : <p className="empty-state">This directory is empty.</p>}</div></div>;
}

async function previewFile(packageId: string, entry: Entry, onPreview: (value: Preview) => void) {
  const response = await fetch(`/api/vpk/${packageId}/file/${entry.path.split("/").map(encodeURIComponent).join("/")}`);
  if (!response.ok) return;
  const type = response.headers.get("content-type") || "";
  if (type.startsWith("image/")) { onPreview({ name: entry.name, content: "", image: URL.createObjectURL(await response.blob()) }); return; }
  if (type.startsWith("text/") || type.includes("json") || type.includes("xml")) onPreview({ name: entry.name, content: await response.text() });
}

function PreviewPanel({ preview, onClose }: { preview: Preview; onClose: () => void }) { return <div className="preview-panel"><div className="preview-heading"><h3>{preview.name}</h3><button onClick={onClose}>Close</button></div>{preview.image ? <img src={preview.image} alt={preview.name} /> : <pre>{preview.content}</pre>}</div>; }
async function readJson(response: Response): Promise<JsonValue> { return response.json() as Promise<JsonValue>; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(2)} MB`; }

export default App;
