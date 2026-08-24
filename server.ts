import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  app.use(express.json());
  
  const PORT = 3000;

  // Path helpers
  const stringsXmlPath = path.join(process.cwd(), "app", "src", "main", "res", "values", "strings.xml");
  const appBuildGradlePath = path.join(process.cwd(), "app", "build.gradle.kts");
  const manifestPath = path.join(process.cwd(), "app", "src", "main", "AndroidManifest.xml");
  const javaSourceRoot = path.join(process.cwd(), "app", "src", "main", "java");

  // Helper to recursively find files
  function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        getFilesRecursively(filePath, fileList);
      } else {
        fileList.push(filePath);
      }
    });
    return fileList;
  }

  // Helper to remove empty directories recursively
  function removeEmptyDirs(dir: string) {
    if (!fs.existsSync(dir)) return;
    const isDir = fs.statSync(dir).isDirectory();
    if (!isDir) return;
    let files = fs.readdirSync(dir);
    if (files.length > 0) {
      files.forEach((file) => {
        removeEmptyDirs(path.join(dir, file));
      });
      // Re-evaluate if empty now
      files = fs.readdirSync(dir);
    }
    if (files.length === 0 && dir !== javaSourceRoot) {
      try {
        fs.rmdirSync(dir);
      } catch (e) {}
    }
  }

  // API - Get current config
  app.get("/api/android/config", (req, res) => {
    try {
      let appName = "Universal Android Builder";
      let packageName = "com.universal.androidbuilder";
      let versionCode = 1;
      let versionName = "1.0.0";
      let compileSdk = 34;
      let targetSdk = 34;
      let minSdk = 24;
      let permissions: string[] = [];

      // Parse App Name
      if (fs.existsSync(stringsXmlPath)) {
        const content = fs.readFileSync(stringsXmlPath, "utf-8");
        const match = content.match(/<string name="app_name">([^<]+)<\/string>/);
        if (match) {
          appName = match[1];
        }
      }

      // Parse App Build Gradle
      if (fs.existsSync(appBuildGradlePath)) {
        const content = fs.readFileSync(appBuildGradlePath, "utf-8");
        
        const nsMatch = content.match(/namespace\s*=\s*"([^"]+)"/);
        const appIdMatch = content.match(/applicationId\s*=\s*"([^"]+)"/);
        if (nsMatch) packageName = nsMatch[1];
        else if (appIdMatch) packageName = appIdMatch[1];

        const vcMatch = content.match(/versionCode\s*=\s*(\d+)/);
        if (vcMatch) versionCode = parseInt(vcMatch[1], 10);

        const vnMatch = content.match(/versionName\s*=\s*"([^"]+)"/);
        if (vnMatch) versionName = vnMatch[1];

        const compMatch = content.match(/compileSdk\s*=\s*(\d+)/);
        if (compMatch) compileSdk = parseInt(compMatch[1], 10);

        const targMatch = content.match(/targetSdk\s*=\s*(\d+)/);
        if (targMatch) targetSdk = parseInt(targMatch[1], 10);

        const minMatch = content.match(/minSdk\s*=\s*(\d+)/);
        if (minMatch) minSdk = parseInt(minMatch[1], 10);
      }

      // Parse Manifest Permissions
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, "utf-8");
        const regex = /<uses-permission\s+android:name="android\.permission\.([^"]+)"\s*\/>/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          permissions.push(match[1]);
        }
      }

      // Read workflow content
      let workflowContent = "";
      const wfPath = path.join(process.cwd(), ".github", "workflows", "build-apk.yml");
      if (fs.existsSync(wfPath)) {
        workflowContent = fs.readFileSync(wfPath, "utf-8");
      }

      res.json({
        appName,
        packageName,
        versionCode,
        versionName,
        compileSdk,
        targetSdk,
        minSdk,
        permissions,
        workflowContent,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API - Save config
  app.post("/api/android/config", (req, res) => {
    try {
      const {
        appName,
        packageName: newPackageName,
        versionCode,
        versionName,
        compileSdk,
        targetSdk,
        minSdk,
        permissions,
      } = req.body;

      // 1. Update strings.xml App Name
      if (fs.existsSync(stringsXmlPath)) {
        let content = fs.readFileSync(stringsXmlPath, "utf-8");
        content = content.replace(
          /<string name="app_name">[^<]+<\/string>/,
          `<string name="app_name">${appName}</string>`
        );
        fs.writeFileSync(stringsXmlPath, content, "utf-8");
      }

      // Get current package name first
      let oldPackageName = "com.universal.androidbuilder";
      if (fs.existsSync(appBuildGradlePath)) {
        const content = fs.readFileSync(appBuildGradlePath, "utf-8");
        const nsMatch = content.match(/namespace\s*=\s*"([^"]+)"/);
        if (nsMatch) oldPackageName = nsMatch[1];
      }

      // 2. Update build.gradle.kts
      if (fs.existsSync(appBuildGradlePath)) {
        let content = fs.readFileSync(appBuildGradlePath, "utf-8");
        content = content.replace(/namespace\s*=\s*"[^"]+"/, `namespace = "${newPackageName}"`);
        content = content.replace(/applicationId\s*=\s*"[^"]+"/, `applicationId = "${newPackageName}"`);
        content = content.replace(/compileSdk\s*=\s*\d+/, `compileSdk = ${compileSdk}`);
        content = content.replace(/targetSdk\s*=\s*\d+/, `targetSdk = ${targetSdk}`);
        content = content.replace(/minSdk\s*=\s*\d+/, `minSdk = ${minSdk}`);
        content = content.replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`);
        content = content.replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${versionName}"`);
        fs.writeFileSync(appBuildGradlePath, content, "utf-8");
      }

      // 3. Update Manifest Permissions
      if (fs.existsSync(manifestPath)) {
        let content = fs.readFileSync(manifestPath, "utf-8");
        const permString = (permissions || [])
          .map((p: string) => `    <uses-permission android:name="android.permission.${p}" />`)
          .join("\n");

        const permRegex = /(<!-- PERMISSIONS_START -->)[\s\S]*?(<!-- PERMISSIONS_END -->)/;
        content = content.replace(permRegex, `$1\n${permString}\n$2`);
        fs.writeFileSync(manifestPath, content, "utf-8");
      }

      // 4. Update Package Declarations and Directory Structures if Changed
      if (newPackageName !== oldPackageName && fs.existsSync(javaSourceRoot)) {
        const allFiles = getFilesRecursively(javaSourceRoot);
        const ktFiles = allFiles.filter((f) => f.endsWith(".kt"));

        ktFiles.forEach((file) => {
          let content = fs.readFileSync(file, "utf-8");
          content = content.replace(
            new RegExp(`package\\s+${oldPackageName}`, "g"),
            `package ${newPackageName}`
          );
          content = content.replace(
            new RegExp(`${oldPackageName}`, "g"),
            newPackageName
          );
          fs.writeFileSync(file, content, "utf-8");
        });

        const oldPathSegment = oldPackageName.replace(/\./g, "/");
        const newPathSegment = newPackageName.replace(/\./g, "/");
        const oldDir = path.join(javaSourceRoot, oldPathSegment);
        const newDir = path.join(javaSourceRoot, newPathSegment);

        if (fs.existsSync(oldDir)) {
          const copyRecursive = (src: string, dest: string) => {
            fs.mkdirSync(dest, { recursive: true });
            const items = fs.readdirSync(src);
            items.forEach((item) => {
              const sPath = path.join(src, item);
              const dPath = path.join(dest, item);
              if (fs.statSync(sPath).isDirectory()) {
                copyRecursive(sPath, dPath);
              } else {
                fs.writeFileSync(dPath, fs.readFileSync(sPath));
                fs.unlinkSync(sPath);
              }
            });
          };
          copyRecursive(oldDir, newDir);
          removeEmptyDirs(javaSourceRoot);
        }
      }

      res.json({ success: true, message: "Configuration successfully applied to codebase!" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API - Get single file content
  app.get("/api/android/file", (req, res) => {
    try {
      const { relPath } = req.query;
      if (!relPath) return res.status(400).json({ error: "Missing relPath parameter" });
      const fullPath = path.join(process.cwd(), relPath as string);
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "File not found" });
      const content = fs.readFileSync(fullPath, "utf-8");
      res.json({ content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API - Save single file content
  app.post("/api/android/file", (req, res) => {
    try {
      const { relPath, content } = req.body;
      if (!relPath || content === undefined) return res.status(400).json({ error: "Missing parameters" });
      const fullPath = path.join(process.cwd(), relPath);
      const relative = path.relative(process.cwd(), fullPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return res.status(403).json({ error: "Access Denied: Path outside workspace" });
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite development middleware vs Static Production delivery
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
