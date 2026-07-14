#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const Remarkable = require("remarkable");
const hljs = require("highlight.js");

const packageJson = require("../package.json");

const HELP = `Usage: md2pdf <input.md> [-o <output.pdf>]

Options:
  -o, --output <file>  Output PDF path (default: input file with .pdf extension)
  -h, --help           Show this help
  -v, --version        Show version

Environment:
  CHROME_PATH          Path to a Chrome or Chromium executable`;

function parseArguments(args) {
  let input;
  let output;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "-h" || argument === "--help") {
      return { help: true };
    }
    if (argument === "-v" || argument === "--version") {
      return { version: true };
    }
    if (argument === "-o" || argument === "--output") {
      output = args[index + 1];
      if (!output) {
        throw new Error(`${argument} requires a file path`);
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      output = argument.slice("--output=".length);
      if (!output) {
        throw new Error("--output requires a file path");
      }
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (input) {
      throw new Error("Only one Markdown input file is supported");
    }
    input = argument;
  }

  if (!input) {
    throw new Error("A Markdown input file is required");
  }

  const inputPath = path.resolve(input);
  const parsedInput = path.parse(inputPath);
  const outputPath = output
    ? path.resolve(output)
    : path.join(parsedInput.dir, `${parsedInput.name}.pdf`);

  return { inputPath, outputPath };
}

function highlight(source, language) {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(language, source).value;
    } catch (error) {
      // Fall back to automatic language detection.
    }
  }

  try {
    return hljs.highlightAuto(source).value;
  } catch (error) {
    return "";
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(markdown, inputPath) {
  const parser = new Remarkable({ html: true, linkify: true, highlight });
  const markdownCss = fs.readFileSync(
    require.resolve("github-markdown-css/github-markdown.css"),
    "utf8"
  );
  const highlightCss = fs.readFileSync(
    require.resolve("highlight.js/styles/github-gist.css"),
    "utf8"
  );
  const baseUrl = pathToFileURL(`${path.dirname(inputPath)}${path.sep}`).href;
  const title = escapeHtml(path.basename(inputPath));

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <base href="${baseUrl}">
    <title>${title}</title>
    <style>${markdownCss}</style>
    <style>${highlightCss}</style>
    <style>
      @page { size: A4; margin: 16mm; }
      html, body { margin: 0; padding: 0; }
      body { background: #fff; }
      .markdown-body {
        box-sizing: border-box;
        max-width: 980px;
        margin: 0 auto;
        color: #24292e;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @media print { .markdown-body { max-width: none; } }
    </style>
  </head>
  <body>
    <main class="markdown-body">${parser.render(markdown)}</main>
  </body>
</html>`;
}

function executableFromPath(name) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE").split(";")
    : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch (error) {
        // Continue searching.
      }
    }
  }

  return undefined;
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    const configuredPath = path.resolve(process.env.CHROME_PATH);
    try {
      fs.accessSync(configuredPath, fs.constants.X_OK);
      return configuredPath;
    } catch (error) {
      throw new Error(`CHROME_PATH is not executable: ${configuredPath}`);
    }
  }

  const platformPaths = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    win32: [
      path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    ],
    linux: [],
  };
  const executableNames = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ];

  for (const candidate of platformPaths[process.platform] || []) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (error) {
      // Continue searching.
    }
  }

  for (const name of executableNames) {
    const executable = executableFromPath(name);
    if (executable) {
      return executable;
    }
  }

  throw new Error(
    "Chrome or Chromium was not found. Install it or set CHROME_PATH."
  );
}

function convert(inputPath, outputPath) {
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "md2pdf-"));
  const htmlPath = path.join(temporaryDirectory, "document.html");

  try {
    const markdown = fs.readFileSync(inputPath, "utf8");
    fs.writeFileSync(htmlPath, renderHtml(markdown, inputPath), "utf8");

    const chromeArguments = [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      `--print-to-pdf=${outputPath}`,
      pathToFileURL(htmlPath).href,
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      chromeArguments.unshift("--no-sandbox");
    }

    const result = spawnSync(findChrome(), chromeArguments, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Chrome exited with code ${result.status}`);
    }
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error("Chrome did not create a PDF file");
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(packageJson.version);
    return;
  }

  convert(options.inputPath, options.outputPath);
  console.log(options.outputPath);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`md2pdf: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { convert, findChrome, main, parseArguments, renderHtml };
