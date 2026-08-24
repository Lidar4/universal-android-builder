import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Cpu,
  FolderCode,
  Github,
  FileCode,
  Settings,
  Check,
  CheckCircle2,
  Copy,
  Terminal,
  ShieldAlert,
  AlertCircle,
  ArrowRight,
  Code2,
  Download,
  Save,
  RotateCcw,
  FileText
} from "lucide-react";

interface AndroidConfig {
  appName: string;
  packageName: string;
  versionCode: number;
  versionName: string;
  compileSdk: number;
  targetSdk: number;
  minSdk: number;
  permissions: string[];
  workflowContent: string;
}

const AVAILABLE_PERMISSIONS = [
  { id: "CAMERA", name: "Camera Access (CAMERA)", desc: "Required for capturing photos and videos" },
  { id: "RECORD_AUDIO", name: "Microphone Input (RECORD_AUDIO)", desc: "Required for recording ambient voice memos" },
  { id: "ACCESS_FINE_LOCATION", name: "Precise Location (ACCESS_FINE_LOCATION)", desc: "Required for mapping and routing" },
  { id: "BLUETOOTH", name: "Bluetooth Operations (BLUETOOTH)", desc: "Required for nearby developer beacon pairing" },
  { id: "POST_NOTIFICATIONS", name: "Push Notifications (POST_NOTIFICATIONS)", desc: "Required for status and background alert delivery" }
];

const EXPLORABLE_FILES = [
  { name: "MainActivity.kt", path: "app/src/main/java/{PKG_PATH}/MainActivity.kt", icon: FileCode, label: "Kotlin View" },
  { name: "AndroidManifest.xml", path: "app/src/main/AndroidManifest.xml", icon: Code2, label: "App Manifest" },
  { name: "app/build.gradle.kts", path: "app/build.gradle.kts", icon: Settings, label: "Module Gradle" },
  { name: "build-apk.yml", path: ".github/workflows/build-apk.yml", icon: Github, label: "GitHub Pipeline" },
  { name: "Theme.kt", path: "app/src/main/java/{PKG_PATH}/ui/theme/Theme.kt", icon: FileCode, label: "Theme Design" },
  { name: "settings.gradle.kts", path: "settings.gradle.kts", icon: Settings, label: "Settings Gradle" }
];

export default function App() {
  const [config, setConfig] = useState<AndroidConfig>({
    appName: "Universal Android Builder",
    packageName: "com.universal.androidbuilder",
    versionCode: 1,
    versionName: "1.0.0",
    compileSdk: 34,
    targetSdk: 34,
    minSdk: 24,
    permissions: [],
    workflowContent: ""
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  // File Viewer States
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [fileContent, setFileContent] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [copiedFile, setCopiedFile] = useState(false);

  // Load initial configurations from Express backend
  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/android/config");
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
      }
    } catch (e) {
      console.error("Error loading configurations", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Fetch individual file contents based on package name substitution
  const fetchFileContent = async (fileIndex: number, currentPkgName: string) => {
    try {
      setFileLoading(true);
      setIsEditingFile(false);
      const fileInfo = EXPLORABLE_FILES[fileIndex];
      const pkgPathSegment = currentPkgName.replace(/\./g, "/");
      const resolvedPath = fileInfo.path.replace("{PKG_PATH}", pkgPathSegment);

      const res = await fetch(`/api/android/file?relPath=${encodeURIComponent(resolvedPath)}`);
      const data = await res.json();
      if (res.ok) {
        setFileContent(data.content);
        setEditingContent(data.content);
      } else {
        setFileContent(`// Error: File not found at '${resolvedPath}'\n// Ensure you apply configuration settings first to initialize directory pathing.`);
        setEditingContent("");
      }
    } catch (e) {
      setFileContent("// Failed to connect to server backend to fetch file contents.");
    } finally {
      setFileLoading(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      fetchFileContent(selectedFileIdx, config.packageName);
    }
  }, [selectedFileIdx, loading]);

  // Handle Form field updates
  const handleFieldChange = (field: keyof AndroidConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  // Toggle permission checks
  const handlePermissionToggle = (permId: string) => {
    setConfig((prev) => {
      const active = prev.permissions.includes(permId);
      const newPerms = active
        ? prev.permissions.filter((p) => p !== permId)
        : [...prev.permissions, permId];
      return { ...prev, permissions: newPerms };
    });
  };

  // Apply configs to backend (write back to real Android files on disk)
  const applyConfigurations = async () => {
    try {
      setSaving(true);
      setSaveStatus(null);
      const res = await fetch("/api/android/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (res.ok) {
        setSaveStatus({ type: "success", message: "Configurations and manifest permissions updated successfully!" });
        // Refresh code viewer to reflect package name/app name updates
        await fetchFileContent(selectedFileIdx, config.packageName);
      } else {
        setSaveStatus({ type: "error", message: data.error || "Failed to save settings." });
      }
    } catch (e) {
      setSaveStatus({ type: "error", message: "Network error saving settings to the backend." });
    } finally {
      setSaving(false);
    }
  };

  // Save manual edits in code viewer to filesystem
  const saveManualEdits = async () => {
    try {
      setSaving(true);
      const fileInfo = EXPLORABLE_FILES[selectedFileIdx];
      const pkgPathSegment = config.packageName.replace(/\./g, "/");
      const resolvedPath = fileInfo.path.replace("{PKG_PATH}", pkgPathSegment);

      const res = await fetch("/api/android/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relPath: resolvedPath, content: editingContent })
      });
      if (res.ok) {
        setFileContent(editingContent);
        setIsEditingFile(false);
        setSaveStatus({ type: "success", message: `Successfully edited ${fileInfo.name}!` });
        // If they edited gradle configuration or strings, pull configurations again
        fetchConfig();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to edit file.");
      }
    } catch (e) {
      alert("Error saving manual modifications.");
    } finally {
      setSaving(false);
    }
  };

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(fileContent);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  return (
    <div id="root-container" className="min-h-screen bg-slate-50 text-slate-800 antialiased font-sans flex flex-col">
      {/* Dynamic Top Bar */}
      <header id="app-header" className="bg-slate-900 text-white border-b border-slate-800 py-4 px-6 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500 rounded-lg text-slate-900">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Universal Android Builder</h1>
              <p className="text-xs text-slate-400">Continuous Integration Developer Suite</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full border border-slate-700 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Workspace Sync
            </span>
            <span className="px-3 py-1 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 rounded-full font-mono text-xs">
              Gradle 8.5
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column - Configuration & Form */}
        <section id="config-panel" className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-5">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-500" />
                App Configurations
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Customize core properties. Modifications update Gradle files and Android manifests.
              </p>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* App Title */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Application Display Name
                  </label>
                  <input
                    type="text"
                    value={config.appName}
                    onChange={(e) => handleFieldChange("appName", e.target.value)}
                    placeholder="E.g. My Awesome App"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium transition-colors"
                  />
                </div>

                {/* Package Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    Package Name (ApplicationID)
                  </label>
                  <input
                    type="text"
                    value={config.packageName}
                    onChange={(e) => handleFieldChange("packageName", e.target.value)}
                    placeholder="com.example.app"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono transition-colors"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                    Changing this re-formats code directories and updates references automatically.
                  </p>
                </div>

                {/* Double row versions */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                      Version Name
                    </label>
                    <input
                      type="text"
                      value={config.versionName}
                      onChange={(e) => handleFieldChange("versionName", e.target.value)}
                      placeholder="1.0.0"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                      Version Code
                    </label>
                    <input
                      type="number"
                      value={config.versionCode}
                      onChange={(e) => handleFieldChange("versionCode", parseInt(e.target.value, 10) || 1)}
                      min="1"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono transition-colors"
                    />
                  </div>
                </div>

                {/* Triple SDK rows */}
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Min SDK
                    </label>
                    <select
                      value={config.minSdk}
                      onChange={(e) => handleFieldChange("minSdk", parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 text-xs font-medium"
                    >
                      <option value="21">21 (Lollipop)</option>
                      <option value="24">24 (Android 7.0)</option>
                      <option value="26">26 (Android 8.0)</option>
                      <option value="30">30 (Android 11)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Target SDK
                    </label>
                    <select
                      value={config.targetSdk}
                      onChange={(e) => handleFieldChange("targetSdk", parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 text-xs font-medium"
                    >
                      <option value="33">33 (Android 13)</option>
                      <option value="34">34 (Android 14)</option>
                      <option value="35">35 (Android 15)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      Compile SDK
                    </label>
                    <select
                      value={config.compileSdk}
                      onChange={(e) => handleFieldChange("compileSdk", parseInt(e.target.value, 10))}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 text-xs font-medium"
                    >
                      <option value="33">33</option>
                      <option value="34">34</option>
                      <option value="35">35</option>
                    </select>
                  </div>
                </div>

                {/* Android Manifest Permissions */}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <span className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2.5">
                    Toggle Native Permissions
                  </span>
                  <div className="flex flex-col gap-2">
                    {AVAILABLE_PERMISSIONS.map((perm) => {
                      const checked = config.permissions.includes(perm.id);
                      return (
                        <div
                          key={perm.id}
                          onClick={() => handlePermissionToggle(perm.id)}
                          className={`flex items-start gap-3 p-2.5 rounded-lg border transition-all cursor-pointer ${
                            checked
                              ? "border-emerald-200 bg-emerald-50/40"
                              : "border-slate-100 bg-slate-50/50 hover:bg-slate-100/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            className="mt-1 accent-emerald-500 rounded cursor-pointer"
                          />
                          <div className="flex-1 select-none">
                            <span className="block text-xs font-bold text-slate-800">{perm.name}</span>
                            <span className="block text-[10px] text-slate-500 leading-normal mt-0.5">{perm.desc}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Apply Button */}
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    onClick={applyConfigurations}
                    disabled={saving}
                    className="w-full py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 active:bg-slate-950 font-bold text-sm tracking-wide shadow transition-all duration-150 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {saving ? (
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Apply Configurations
                  </button>

                  <AnimatePresence mode="wait">
                    {saveStatus && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs leading-normal ${
                          saveStatus.type === "success"
                            ? "bg-emerald-50/60 border-emerald-200 text-emerald-800"
                            : "bg-rose-50/60 border-rose-200 text-rose-800"
                        }`}
                      >
                        {saveStatus.type === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <span>{saveStatus.message}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            )}
          </div>

          {/* Core Build & Assembly Flowchart */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <FolderCode className="w-4 h-4 text-slate-600" />
              Automated Assembly Architecture
            </h3>
            
            <div className="flex flex-col gap-3 text-xs leading-relaxed text-slate-600">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-800 shrink-0 mt-0.5">1</div>
                <div>
                  <span className="font-bold text-slate-800 block">Configure Settings</span>
                  Select package properties and Android hardware permissions in this interface, and hit Apply.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-800 shrink-0 mt-0.5">2</div>
                <div>
                  <span className="font-bold text-slate-800 block">Export Codebase</span>
                  Click the **Settings (Gear icon)** in Google AI Studio to **Export to GitHub** or download a ZIP file.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-800 shrink-0 mt-0.5">3</div>
                <div>
                  <span className="font-bold text-slate-800 block">Automatic APK Build</span>
                  Once pushed to your GitHub repository, the `.github/workflows/build-apk.yml` pipeline compiles the APK dynamically.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column - Code Explorer & Pipeline Guide */}
        <section id="explorer-panel" className="lg:col-span-7 flex flex-col gap-6">
          <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-md overflow-hidden flex flex-col h-[550px]">
            {/* Header / Tabs */}
            <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                <span className="text-xs text-slate-400 font-mono ml-2">Android Code Studio</span>
              </div>

              <div className="flex items-center gap-2">
                {isEditingFile ? (
                  <>
                    <button
                      onClick={saveManualEdits}
                      disabled={saving}
                      className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-[11px] px-2.5 py-1 rounded transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Save File
                    </button>
                    <button
                      onClick={() => {
                        setEditingContent(fileContent);
                        setIsEditingFile(false);
                      }}
                      className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] px-2.5 py-1 rounded transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setIsEditingFile(true)}
                      className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] px-2.5 py-1 rounded transition-colors cursor-pointer"
                    >
                      <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                      Edit File
                    </button>
                    <button
                      onClick={copyCodeToClipboard}
                      className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-[11px] px-2.5 py-1 rounded transition-colors cursor-pointer"
                    >
                      {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedFile ? "Copied!" : "Copy Code"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Explorable files selector list */}
            <div className="bg-slate-900 border-b border-slate-850 px-4 py-2 flex flex-wrap gap-1.5 overflow-x-auto select-none shrink-0">
              {EXPLORABLE_FILES.map((file, idx) => {
                const ActiveIcon = file.icon;
                const active = selectedFileIdx === idx;
                return (
                  <button
                    key={file.name}
                    onClick={() => setSelectedFileIdx(idx)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-150 shrink-0 cursor-pointer ${
                      active
                        ? "bg-indigo-600 text-white font-semibold"
                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    <ActiveIcon className="w-3.5 h-3.5" />
                    {file.name}
                  </button>
                );
              })}
            </div>

            {/* Code Content Container */}
            <div className="flex-1 overflow-auto bg-slate-950 font-mono text-xs flex">
              {fileLoading ? (
                <div className="flex-1 flex flex-col justify-center items-center gap-3 text-slate-400">
                  <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-indigo-400"></div>
                  <span>Syncing file stream...</span>
                </div>
              ) : isEditingFile ? (
                <textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  className="w-full h-full p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-normal resize-none focus:outline-none border-0"
                />
              ) : (
                <pre className="p-4 text-slate-300 leading-normal overflow-x-auto whitespace-pre select-text flex-1">
                  <code>{fileContent}</code>
                </pre>
              )}
            </div>
            
            {/* Path details */}
            <div className="bg-slate-950 border-t border-slate-850 px-4 py-2 text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
              <span className="font-bold text-slate-400">WORKSPACE:</span>
              <span>{EXPLORABLE_FILES[selectedFileIdx].path.replace("{PKG_PATH}", config.packageName.replace(/\./g, "/"))}</span>
            </div>
          </div>

          {/* GitHub Actions Pipeline Visualizer */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-5">
            <div>
              <h3 className="text-md font-bold text-slate-950 flex items-center gap-1.5">
                <Github className="w-4 h-4 text-slate-800" />
                GitHub Actions Pipeline (build-apk.yml)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Visualizing how GitHub compiles the native code and generates the APK.
              </p>
            </div>

            {/* Pipeline flowchart graphics */}
            <div className="grid grid-cols-1 md:grid-cols-5 items-center gap-2.5">
              
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-center flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold mb-1.5">
                  <Github className="w-4 h-4" />
                </div>
                <span className="font-bold text-[10px] text-slate-800">1. PUSH</span>
                <span className="text-[9px] text-slate-500 leading-tight mt-0.5">Code push triggers build</span>
              </div>

              <div className="hidden md:flex justify-center text-slate-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-center flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold mb-1.5">
                  <Cpu className="w-4 h-4" />
                </div>
                <span className="font-bold text-[10px] text-slate-800">2. RUNNER</span>
                <span className="text-[9px] text-slate-500 leading-tight mt-0.5">Ubuntu sets JDK 17</span>
              </div>

              <div className="hidden md:flex justify-center text-slate-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-center flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold mb-1.5">
                  <Terminal className="w-4 h-4" />
                </div>
                <span className="font-bold text-[10px] text-slate-800">3. GRADLEW</span>
                <span className="text-[9px] text-slate-500 leading-tight mt-0.5">assembleDebug executes</span>
              </div>

              <div className="hidden md:flex justify-center text-slate-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-center flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold mb-1.5">
                  <Check className="w-4 h-4" />
                </div>
                <span className="font-bold text-[10px] text-slate-800">4. VERIFY</span>
                <span className="text-[9px] text-slate-500 leading-tight mt-0.5">Checks APK exist &gt; 0</span>
              </div>

              <div className="hidden md:flex justify-center text-slate-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              <div className="p-3 bg-emerald-100/50 border border-emerald-200 rounded-lg text-center flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold mb-1.5">
                  <Download className="w-4 h-4" />
                </div>
                <span className="font-bold text-[10px] text-slate-800">5. ARTIFACT</span>
                <span className="text-[9px] text-slate-500 leading-tight mt-0.5">Uploader saves real APK</span>
              </div>

            </div>

            {/* Real instructions block */}
            <div className="bg-slate-50 rounded-lg border border-slate-100 p-4 text-xs leading-relaxed text-slate-700 flex flex-col gap-2">
              <span className="font-bold text-slate-800 block">How to compile on GitHub:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                <li>Export this codebase by going to <strong className="text-slate-800">Settings (Gear) &gt; Export to GitHub</strong>.</li>
                <li>Connect your GitHub account and specify an empty repository. Pushing to <strong className="text-slate-800">main</strong> starts the workflow instantly.</li>
                <li>In your GitHub repo, go to the <strong className="text-indigo-600 font-bold">Actions</strong> tab to see the compiler pipeline execute.</li>
                <li>When complete, click on the successful run to download the real compiled Android APK under the <strong className="text-slate-800 font-bold">Artifacts</strong> section.</li>
              </ul>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer id="footer" className="bg-slate-900 text-slate-400 border-t border-slate-800 py-6 px-6 text-center text-xs mt-12 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span>&copy; 2026 Universal Android Builder. Generated in Google AI Studio.</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><Github className="w-4 h-4" /> Jetpack Compose</span>
            <span>&bull;</span>
            <span className="flex items-center gap-1"><Cpu className="w-4 h-4" /> Material 3</span>
            <span>&bull;</span>
            <span className="flex items-center gap-1"><Code2 className="w-4 h-4" /> Continuous Delivery</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
