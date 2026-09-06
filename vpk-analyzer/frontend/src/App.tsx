import { ChangeEvent, DragEvent, useRef, useState } from "react";

type UploadedPackage = { id: string; filename: string; size: number };
type PackageInfo = UploadedPackage & { format: string; confidence: number; message: string; file_count: number; directory_count: number; total_uncompressed_size: number; metadata: Record<string, string | number | null> };
type Entry = { path: string; name: string; kind: "file" | "directory"; size: number; compressed_size?: number };
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
    setBusy("Analyzing"); setError("");
    try {
      const analysis = await readJson(await apiFetch(`/api/vpk/${packageFile.id}/analyze`));
      setInfo({ ...analysis, id: packageFile.id, filename: packageFile.filename, size: packageFile.size } as PackageInfo);
      setEntries(analysis.entries); setCurrentPath("");
    } catch (analysisError) { setError(analysisError instanceof Error ? analysisError.message : "Analysis failed"); }
    finally { setBusy(""); }
  };

  const uploadAndAnalyze = async (file: File) => {
    const form = new FormData(); form.append("file", file);
    const result = await readJson(await apiFetch("/api/vpk/upload", { method: "POST", body: form })) as UploadedPackage;
    const packageFile = { id: result.id, filename: result.filename, size: result.size };
    setUploaded(packageFile); await analyze(packageFile);
  };

  const extract = async () => {
    if (!uploaded) return;
    setBusy("Extracting"); setError("");
    try { await readJson(await apiFetch(`/api/vpk/${uploaded.id}/extract`, { method: "POST" })); }
    catch (extractError) { setError(extractError instanceof Error ? extractError.message : "Extraction failed"); }
    finally { setBusy(""); }
  };

  const clearPackage = () => { setUploaded(null); setInfo(null); setEntries([]); setPreview(null); setError(""); setCurrentPath(""); };
  const deletePackage = async () => {
    if (!uploaded) return;
    setBusy("Deleting");
    try { await readJson(await apiFetch(`/api/vpk/${uploaded.id}`, { method: "DELETE" })); clearPackage(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Delete failed"); }
    finally { setBusy(""); }
  };

  return <main className="app-shell">
    <Header hasPackage={Boolean(info)} />
    <div className="page-frame">
      {!uploaded ? <section className="landing-view" id="analyzer" aria-labelledby="page-title">
        <div className="hero-copy"><span className="tool-badge"><span className="badge-dot" /> VPK ANALYSIS TOOL</span><h2 id="page-title">Analyze VPK files<br /><span>with precision.</span></h2><p>Upload, inspect, analyze, and extract package contents from one focused workspace.</p><div className="hero-notes"><span><Icon name="shield" /> Secure local processing</span><span><Icon name="check" /> Nothing executes</span></div></div>
        <UploadPanel onAnalyze={uploadAndAnalyze} />
      </section> : <section className="dashboard" id="analyzer" aria-labelledby="workspace-title">
        <div className="workspace-header"><div className="workspace-title"><span className="file-orb"><Icon name="package" /></span><div><span className="eyebrow">Active package</span><h2 id="workspace-title">{uploaded.filename}</h2><span className="muted">{formatBytes(uploaded.size)} · Local analysis workspace</span></div></div><ActionBar uploaded={uploaded} info={info} busy={busy} onAnalyze={() => void analyze(uploaded)} onExtract={() => void extract()} onClear={clearPackage} onDelete={() => void deletePackage()} /></div>
        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        {busy && <LoadingState label={busy} />}
        {info && <AnalysisSummary info={info} />}
        {info && info.format !== "ps_vita" ? <UnsupportedState message={info.message} /> : info && <Explorer entries={entries} currentPath={currentPath} setCurrentPath={setCurrentPath} onPreview={setPreview} packageId={uploaded.id} />}
        {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}
      </section>}
    </div>
    <footer className="site-footer"><span>VPK ANALYZER <b>v0.1.0</b></span><span>Local-first package inspection</span><span className="footer-security"><Icon name="lock" /> No execution · No telemetry</span></footer>
  </main>;
}

function Header({ hasPackage }: { hasPackage: boolean }) { return <header className="site-header"><a className="brand" href="#analyzer" aria-label="VPK Analyzer home"><span className="brand-icon"><Icon name="package" /></span><span>VPK <strong>Analyzer</strong></span></a><nav aria-label="Primary navigation"><a className="nav-active" href="#analyzer">Analyzer</a><a href="#extractor">Extractor</a><a href="#documentation">Documentation</a><a href="#about">About</a></nav><div className="header-meta"><span className="online-state"><i /> {hasPackage ? "Workspace active" : "System online"}</span><span className="version-chip">v0.1.0</span><span className="theme-mark" title="Dark theme"><Icon name="moon" /></span></div></header>; }

function UploadPanel({ onAnalyze }: { onAnalyze: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null); const [dragging, setDragging] = useState(false); const [selected, setSelected] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const selectFile = (file: File) => { setError(""); if (!file.name.toLowerCase().endsWith(".vpk")) { setError("Choose a file with the .vpk extension."); return; } setSelected(file); };
  const analyzeSelected = async () => { if (!selected) return; setBusy(true); setError(""); try { await onAnalyze(selected); } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Upload failed"); } finally { setBusy(false); } };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) selectFile(file); event.target.value = ""; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) selectFile(file); };
  return <div className={`upload-card${dragging ? " is-dragging" : ""}${selected ? " has-file" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop} role="region" aria-label="VPK file upload">
    <input ref={inputRef} className="file-input" type="file" accept=".vpk,application/octet-stream" onChange={onChange} /><div className="upload-illustration"><Icon name={selected ? "file" : "upload"} /></div>
    {selected ? <><span className="selected-label"><Icon name="check" /> VPK file selected</span><h3 className="selected-name">{selected.name}</h3><p className="selected-size">{formatBytes(selected.size)}</p><div className="upload-actions"><button className="primary-button" type="button" disabled={busy} onClick={() => void analyzeSelected()}><Icon name="scan" /> {busy ? "Analyzing..." : "Analyze File"}</button><button className="quiet-button" type="button" disabled={busy} onClick={() => setSelected(null)}>Remove</button></div></> : <><h3>Drop your VPK file here</h3><p>or click to browse from your computer</p><button className="primary-button" type="button" onClick={() => inputRef.current?.click()}><Icon name="folder" /> Choose VPK File</button><span className="upload-format">.vpk <span>·</span> Secure local processing</span></>}
    {error && <p className="inline-error" role="alert"><Icon name="alert" /> {error}</p>}{!selected && <small className="upload-footnote">No files are uploaded without your action</small>}
  </div>;
}

function AnalysisSummary({ info }: { info: PackageInfo }) { const valid = info.format === "ps_vita"; return <div className="analysis-block"><div className="section-heading"><div><span className="eyebrow">Analysis overview</span><h3>Package intelligence</h3></div><span className={`result-badge ${valid ? "valid" : "invalid"}`}><i /> {valid ? "Analysis complete" : "Needs attention"}</span></div><div className="stats-grid"><StatCard icon="database" label="File size" value={formatBytes(info.size)} note="Package on disk" /><StatCard icon="layers" label="File count" value={info.file_count.toLocaleString()} note={`${info.directory_count} directories`} /><StatCard icon="scan" label="Detected format" value={formatFormat(info.format)} note={`${info.confidence}% confidence`} /><StatCard icon={valid ? "check" : "alert"} label="Status" value={valid ? "Valid" : "Unsupported"} note={valid ? "Ready to explore" : "Parser unavailable"} tone={valid ? "success" : "warning"} /></div></div>; }
function StatCard({ icon, label, value, note, tone = "" }: { icon: string; label: string; value: string; note: string; tone?: string }) { return <div className="stat-card"><span className={`stat-icon ${tone}`}><Icon name={icon} /></span><div><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }
function ActionBar({ uploaded, info, busy, onAnalyze, onExtract, onClear, onDelete }: { uploaded: UploadedPackage; info: PackageInfo | null; busy: string; onAnalyze: () => void; onExtract: () => void; onClear: () => void; onDelete: () => void }) { return <div className="action-bar"><button className="toolbar-button" onClick={onAnalyze} disabled={!!busy}><Icon name="refresh" /> Analyze</button><button className="toolbar-button primary-small" onClick={onExtract} disabled={!!busy || !info || info.format !== "ps_vita"}><Icon name="archive" /> Extract All</button><a className="toolbar-button" href={info ? `/api/vpk/${uploaded.id}/download` : undefined} aria-disabled={!info}><Icon name="download" /> Download</a><button className="toolbar-button" onClick={onClear} disabled={!!busy}><Icon name="close" /> Clear</button><button className="icon-button danger" onClick={onDelete} disabled={!!busy} aria-label="Delete uploaded package" title="Delete uploaded package"><Icon name="trash" /></button></div>; }

function Explorer({ entries, currentPath, setCurrentPath, onPreview, packageId }: { entries: Entry[]; currentPath: string; setCurrentPath: (path: string) => void; onPreview: (value: Preview) => void; packageId: string }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<"all" | "file" | "directory">("all"); const [selected, setSelected] = useState<Entry | null>(null); const prefix = currentPath ? `${currentPath}/` : "";
  const visible = entries.filter((entry) => { const inPath = query ? true : entry.path.startsWith(prefix) && entry.path !== currentPath; const rest = entry.path.slice(prefix.length); const direct = query || !rest.includes("/") || (entry.kind === "directory" && rest.indexOf("/") === rest.length - 1); const matchesFilter = filter === "all" || entry.kind === filter; const matchesQuery = !query || `${entry.path} ${entry.name}`.toLowerCase().includes(query.toLowerCase()); return inPath && direct && matchesFilter && matchesQuery; }).filter((entry, index, list) => list.findIndex((candidate) => candidate.path === entry.path) === index);
  const breadcrumbs = currentPath ? currentPath.split("/") : [];
  const chooseEntry = (entry: Entry) => { setSelected(entry); if (entry.kind === "directory") setCurrentPath(entry.path); else void previewFile(packageId, entry, onPreview); };
  return <div className="explorer-layout"><section className="explorer-panel" aria-label="VPK file explorer"><div className="panel-topline"><div><span className="eyebrow">Virtual file tree</span><h3>Package explorer</h3></div><span className="entry-count">{entries.filter((entry) => entry.kind === "file").length} files indexed</span></div><div className="explorer-tools"><label className="search-box"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files..." aria-label="Search files" /></label><div className="filter-tabs" role="group" aria-label="Filter entries">{(["all", "file", "directory"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value === "file" ? "Files" : "Folders"}</button>)}</div></div><div className="breadcrumbs"><button onClick={() => { setCurrentPath(""); setQuery(""); }}>root</button>{breadcrumbs.map((part, index) => <span key={`${part}-${index}`}><b>/</b><button onClick={() => setCurrentPath(breadcrumbs.slice(0, index + 1).join("/"))}>{part}</button></span>)}</div><div className="file-list">{visible.length ? visible.map((entry) => <button className={`file-row${selected?.path === entry.path ? " selected" : ""}`} key={entry.path} onClick={() => chooseEntry(entry)}><span className={`file-type-icon ${entry.kind}`}><Icon name={entry.kind === "directory" ? "folder" : "file"} /></span><span className="file-name"><strong>{entry.name}</strong><small>{entry.path}</small></span><span className="file-size">{entry.kind === "file" ? formatBytes(entry.size) : "folder"}</span><Icon name="chevron" /></button>) : <p className="empty-state">No matching entries in this view.</p>}</div></section><FileDetails entry={selected} currentPath={currentPath} /></div>;
}

function FileDetails({ entry, currentPath }: { entry: Entry | null; currentPath: string }) { return <aside className="details-panel"><div className="panel-topline"><div><span className="eyebrow">Selection</span><h3>File details</h3></div><span className="details-mark"><Icon name="info" /></span></div>{entry ? <div className="details-content"><div className="detail-file-icon"><Icon name={entry.kind === "directory" ? "folder" : "file"} /></div><h4>{entry.name}</h4><span className="detail-path">{entry.path}</span><dl><div><dt>Type</dt><dd>{entry.kind === "directory" ? "Directory" : extension(entry.name)}</dd></div><div><dt>Size</dt><dd>{entry.kind === "file" ? formatBytes(entry.size) : "—"}</dd></div><div><dt>Compression</dt><dd>{entry.kind === "file" && entry.compressed_size !== undefined ? formatBytes(entry.compressed_size) : "—"}</dd></div><div><dt>Location</dt><dd>{currentPath || "Root"}</dd></div></dl></div> : <div className="details-empty"><span><Icon name="cursor" /></span><p>Select a file or folder<br />to inspect its metadata.</p></div>}</aside>; }
function LoadingState({ label }: { label: string }) { return <div className="loading-state" role="status" aria-live="polite"><span className="spinner" /><div><strong>{label} package...</strong><small>{label === "Analyzing" ? "Reading package header and processing file directory" : "Preparing files inside the controlled workspace"}</small></div><div className="loading-bar"><i /></div></div>; }
function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) { return <div className="error-state" role="alert"><span className="error-icon"><Icon name="alert" /></span><div><strong>Operation failed</strong><p>{message}</p></div><button onClick={onDismiss} aria-label="Dismiss error"><Icon name="close" /></button></div>; }
function UnsupportedState({ message }: { message: string }) { return <div className="unsupported-state"><span><Icon name="alert" /></span><div><strong>Format detected, parser unavailable</strong><p>{message}</p></div></div>; }
function PreviewPanel({ preview, onClose }: { preview: Preview; onClose: () => void }) { return <section className="preview-panel" aria-label={`Preview of ${preview.name}`}><div className="panel-topline"><div><span className="eyebrow">Safe preview</span><h3>{preview.name}</h3></div><button className="quiet-button" onClick={onClose}>Close <Icon name="close" /></button></div>{preview.image ? <img src={preview.image} alt={preview.name} /> : <pre>{preview.content}</pre>}</section>; }
async function previewFile(packageId: string, entry: Entry, onPreview: (value: Preview) => void) { const response = await apiFetch(`/api/vpk/${packageId}/file/${entry.path.split("/").map(encodeURIComponent).join("/")}`); if (!response.ok) return; const type = response.headers.get("content-type") || ""; if (type.startsWith("image/")) { onPreview({ name: entry.name, content: "", image: URL.createObjectURL(await response.blob()) }); return; } if (type.startsWith("text/") || type.includes("json") || type.includes("xml")) onPreview({ name: entry.name, content: await response.text() }); }
function Icon({ name }: { name: string }) { const icons: Record<string, string> = { package: "◈", upload: "⇧", file: "▤", folder: "▱", check: "✓", shield: "◇", scan: "⌁", alert: "!", database: "◉", layers: "▥", refresh: "↻", archive: "▣", download: "↓", close: "×", trash: "⌫", search: "⌕", chevron: "›", info: "i", cursor: "⌖", lock: "⌑", moon: "◐" }; return <span className={`icon-glyph icon-${name}`} aria-hidden="true">{icons[name] || "·"}</span>; }
async function apiFetch(input: RequestInfo | URL, init?: RequestInit) { try { return await fetch(input, init); } catch (error) { if (error instanceof TypeError) throw new Error("Unable to connect to the VPK backend. Check that the backend server is running and the API URL is correct."); throw error; } }
async function readJson(response: Response): Promise<JsonValue> { const text = await response.text(); const contentType = response.headers.get("content-type") || "unknown"; console.debug("VPK API response", { status: response.status, contentType, body: text.slice(0, 500) }); if (response.status === 502) throw new Error(`Unable to connect to the VPK backend. Please make sure the backend server is running. (HTTP 502)${text.trim() ? `: ${text.slice(0, 500)}` : ""}`); if (!text.trim()) throw new Error(`Server returned an empty response (HTTP ${response.status})`); let payload: JsonValue; try { payload = JSON.parse(text) as JsonValue; } catch { throw new Error(`Server returned invalid JSON (HTTP ${response.status}): ${text.slice(0, 500)}`); } if (!response.ok || payload.success === false) throw new Error(payload.error || payload.message || payload.detail || `Request failed (HTTP ${response.status})`); return (payload.success === true && payload.data !== undefined ? payload.data : payload) as JsonValue; }
function extension(name: string) { const value = name.split(".").pop(); return value && value !== name ? `.${value.toUpperCase()}` : "File"; }
function formatFormat(value: string) { return value === "ps_vita" ? "PS Vita" : value === "unknown" ? "Unknown" : value; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`; return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`; }

export default App;
