import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = __dirname;
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // Folder/direktori terkunci (EPERM/EBUSY, mis. watcher IDE) — hapus isi file-per-file,
      // biarkan direktori yang terkunci (ditimpa oleh copy berikutnya).
      for (const item of fs.readdirSync(dir)) {
        try {
          fs.rmSync(path.join(dir, item), { recursive: true, force: true });
        } catch (e2) { /* item terkunci: akan ditimpa oleh copy/overwrite berikutnya */ }
      }
    }
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyFilesRecursively(src, dest, extFilter = null) {
  const items = fs.readdirSync(src);
  for (const item of items) {
    const srcPath = path.join(src, item);
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      const destSubDir = path.join(dest, item);
      fs.mkdirSync(destSubDir, { recursive: true });
      copyFilesRecursively(srcPath, destSubDir, extFilter);
    } else {
      if (!extFilter || extFilter.includes(path.extname(item))) {
        const destPath = path.join(dest, item);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

console.log('=== STARTING ANSLA V2 BUILD ===');

// 1. Clean and recreate dist directory
console.log('- Cleaning dist directory...');
cleanDir(distDir);

// 2. Copy manifest and appsscript.json metadata
console.log('- Copying metadata files...');
if (fs.existsSync(path.join(rootDir, 'appsscript.json'))) {
  fs.copyFileSync(path.join(rootDir, 'appsscript.json'), path.join(distDir, 'appsscript.json'));
}
if (fs.existsSync(path.join(srcDir, 'appsscript.json'))) {
  fs.copyFileSync(path.join(srcDir, 'appsscript.json'), path.join(distDir, 'appsscript.json'));
}

// 3. Copy backend files (.gs)
console.log('- Copying backend Apps Script files...');
const backendSrc = path.join(srcDir, 'backend');
if (fs.existsSync(backendSrc)) {
  copyFilesRecursively(backendSrc, distDir, ['.gs']);
}

// 4. Inline frontend compiled assets into index.html
console.log('- Inlining frontend CSS and JS into index.html...');
const templatePath = path.join(srcDir, 'frontend', 'index.html');
const bundlePath = path.join(distDir, 'bundle.js');
const stylesPath = path.join(distDir, 'styles.css');
const outputPath = path.join(distDir, 'index.html');

if (!fs.existsSync(templatePath)) {
  console.error(`❌ Template index.html not found at: ${templatePath}`);
  process.exit(1);
}

let htmlContent = fs.readFileSync(templatePath, 'utf8');

// Inline CSS
if (fs.existsSync(stylesPath)) {
  const cssContent = fs.readFileSync(stylesPath, 'utf8');
  const styleTag = `<style>\n${cssContent}\n</style>`;
  // Replace or inject stylesheet
  htmlContent = htmlContent.replace(/<link[^>]*href="[^"]*styles\.css"[^>]*>/i, styleTag);
  if (!htmlContent.includes(styleTag)) {
    // If tag was not replaced, append before </head>
    htmlContent = htmlContent.replace('</head>', `${styleTag}\n</head>`);
  }
  // Delete raw css file (jika terkunci, biarkan — index.html sudah inline)
  try { fs.unlinkSync(stylesPath); } catch (e) {}
}

// Inline JS Bundle
if (fs.existsSync(bundlePath)) {
  const jsContent = fs.readFileSync(bundlePath, 'utf8');
  const scriptTag = `<script>\n${jsContent}\n</script>`;
  // Replace bundle.js script reference
  htmlContent = htmlContent.replace(/<script[^>]*src="[^"]*bundle\.js"[^>]*><\/script>/i, scriptTag);
  if (!htmlContent.includes(scriptTag)) {
    // Append before </body>
    htmlContent = htmlContent.replace('</body>', `${scriptTag}\n</body>`);
  }
  // Delete raw js file (jika terkunci, biarkan — index.html sudah inline)
  try { fs.unlinkSync(bundlePath); } catch (e) {}
}

fs.writeFileSync(outputPath, htmlContent, 'utf8');
console.log('✅ index.html compiled and inlined successfully.');

// 5. Copy frontend JS files and static assets to dist/
console.log('- Copying frontend JS files and static assets to dist...');
const frontendAssets = [
  'sales-ledger.js',
  'sw.js',
  'manifest.json'
];

frontendAssets.forEach(file => {
  const srcPath = path.join(rootDir, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(distDir, file));
  }
});

// Copy icons
const iconsSrc = path.join(rootDir, 'icons');
const iconsDest = path.join(distDir, 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.mkdirSync(iconsDest, { recursive: true });
  copyFilesRecursively(iconsSrc, iconsDest, ['.png', '.ico', '.json']);
}

// Copy subfolder frontend .js files
const frontendDirs = [
  'BusinessAnalytics',
  'NotificationCenter',
  'ProductionCenter',
  'RecoveryCenter',
  'ai',
  'components'
];

frontendDirs.forEach(dir => {
  let srcPath = path.join(srcDir, 'frontend', dir);
  if (!fs.existsSync(srcPath)) {
    srcPath = path.join(rootDir, dir);
  }
  const destPath = path.join(distDir, dir);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(destPath, { recursive: true });
    copyFilesRecursively(srcPath, destPath, ['.js', '.json', '.html']);
  }
});

// 6. Write Netlify _redirects file to dist/ for SPA routing
console.log('- Writing _redirects file for Netlify SPA routing...');
fs.writeFileSync(path.join(distDir, '_redirects'), '/* /index.html 200\n', 'utf8');

console.log('=== BUILD COMPLETED SUCCESSFULLY ===');
