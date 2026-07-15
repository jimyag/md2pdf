#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const Remarkable = require("remarkable");
const hljs = require("highlight.js");

const packageJson = require("../package.json");

const A4_WIDTH_INCHES = 8.27;
const A4_HEIGHT_INCHES = 11.69;
const PDF_MARGIN_INCHES = 16 / 25.4;
const CSS_PIXELS_PER_INCH = 96;
const CHROME_START_TIMEOUT_MS = 10000;

const HELP = `Usage: md2pdf <input.md> [-o <output.pdf>]

Options:
  -o, --output <file>  Output PDF path (default: input file with .pdf extension)
      --single-page    Export all content as one long A4-width PDF page
  -h, --help           Show this help
  -v, --version        Show version

Environment:
  CHROME_PATH          Path to a Chrome or Chromium executable`;

function parseArguments(args) {
  let input;
  let output;
  let singlePage = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "-h" || argument === "--help") {
      return { help: true };
    }
    if (argument === "-v" || argument === "--version") {
      return { version: true };
    }
    if (argument === "--single-page") {
      singlePage = true;
      continue;
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

  return { inputPath, outputPath, singlePage };
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

function createWebSocketFrame(text) {
  const payload = Buffer.from(text);
  let headerLength = 6;
  if (payload.length >= 126 && payload.length <= 65535) {
    headerLength = 8;
  } else if (payload.length > 65535) {
    headerLength = 14;
  }

  const frame = Buffer.alloc(headerLength + payload.length);
  frame[0] = 0x81;
  if (payload.length < 126) {
    frame[1] = 0x80 | payload.length;
  } else if (payload.length <= 65535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(payload.length, 6);
  }

  const maskOffset = headerLength - 4;
  const mask = crypto.randomBytes(4);
  mask.copy(frame, maskOffset);
  for (let index = 0; index < payload.length; index += 1) {
    frame[headerLength + index] = payload[index] ^ mask[index % 4];
  }

  return frame;
}

function parseWebSocketFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      const highBits = buffer.readUInt32BE(offset + 2);
      if (highBits !== 0) {
        throw new Error("Chrome DevTools message is too large");
      }
      payloadLength = buffer.readUInt32BE(offset + 6);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.slice(payloadStart, payloadStart + payloadLength));
    if (masked) {
      const mask = buffer.slice(offset + headerLength, offset + headerLength + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }
    offset += frameLength;
  }

  return { messages, remaining: buffer.slice(offset) };
}

function connectWebSocket(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(webSocketUrl);
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect(Number(parsedUrl.port), parsedUrl.hostname);
    let buffer = Buffer.alloc(0);
    let connected = false;
    let messageBuffer = Buffer.alloc(0);
    const messageHandlers = [];

    function fail(error) {
      socket.destroy();
      reject(error);
    }

    socket.setTimeout(CHROME_START_TIMEOUT_MS, () => {
      fail(new Error("Timed out connecting to Chrome DevTools"));
    });

    socket.on("connect", () => {
      socket.write([
        `GET ${parsedUrl.pathname}${parsedUrl.search} HTTP/1.1`,
        `Host: ${parsedUrl.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    });

    socket.on("data", chunk => {
      if (!connected) {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }

        const header = buffer.slice(0, headerEnd).toString("utf8");
        if (!header.startsWith("HTTP/1.1 101")) {
          fail(new Error("Chrome DevTools WebSocket handshake failed"));
          return;
        }

        connected = true;
        socket.setTimeout(0);
        resolve({
          close: () => socket.end(),
          onMessage: handler => messageHandlers.push(handler),
          send: message => socket.write(createWebSocketFrame(message)),
        });

        const remaining = buffer.slice(headerEnd + 4);
        buffer = Buffer.alloc(0);
        if (remaining.length === 0) {
          return;
        }
        chunk = remaining;
      }

      messageBuffer = Buffer.concat([messageBuffer, chunk]);
      const parsed = parseWebSocketFrames(messageBuffer);
      messageBuffer = parsed.remaining;
      for (const message of parsed.messages) {
        for (const handler of messageHandlers) {
          handler(message);
        }
      }
    });

    socket.on("error", error => {
      if (!connected) {
        reject(error);
      }
    });
  });
}

function createCdpClient(socket) {
  let nextId = 1;
  const pending = new Map();

  socket.onMessage(message => {
    const data = JSON.parse(message);
    if (!data.id) {
      return;
    }

    const request = pending.get(data.id);
    if (!request) {
      return;
    }

    pending.delete(data.id);
    if (data.error) {
      request.reject(new Error(data.error.message));
    } else {
      request.resolve(data.result || {});
    }
  });

  return {
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      const id = nextId;
      nextId += 1;

      const message = { id, method, params };
      if (sessionId) {
        message.sessionId = sessionId;
      }

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify(message));
      });
    },
  };
}

function launchChrome(htmlUrl, temporaryDirectory) {
  return new Promise((resolve, reject) => {
    const chromeArguments = [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(temporaryDirectory, "chrome-profile")}`,
      htmlUrl,
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      chromeArguments.unshift("--no-sandbox");
    }

    const chrome = spawn(findChrome(), chromeArguments, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    const timeout = setTimeout(() => {
      chrome.kill();
      reject(new Error("Timed out waiting for Chrome DevTools"));
    }, CHROME_START_TIMEOUT_MS);

    chrome.stderr.on("data", chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) {
        return;
      }

      clearTimeout(timeout);
      resolve({ chrome, webSocketUrl: match[1] });
    });

    chrome.on("error", error => {
      clearTimeout(timeout);
      reject(error);
    });

    chrome.on("exit", code => {
      if (!stderr.includes("DevTools listening on")) {
        clearTimeout(timeout);
        reject(new Error(stderr.trim() || `Chrome exited with code ${code}`));
      }
    });
  });
}

async function printPdf(htmlUrl, outputPath, temporaryDirectory, options = {}) {
  const { chrome, webSocketUrl } = await launchChrome(htmlUrl, temporaryDirectory);
  let client;

  try {
    client = createCdpClient(await connectWebSocket(webSocketUrl));
    const targets = await client.send("Target.getTargets");
    const pageTarget = targets.targetInfos.find(target => target.type === "page");
    if (!pageTarget) {
      throw new Error("Chrome did not create a page target");
    }

    const attached = await client.send("Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;

    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.bringToFront", {}, sessionId);
    await client.send("Emulation.setEmulatedMedia", { media: "print" }, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: Math.ceil((A4_WIDTH_INCHES - (PDF_MARGIN_INCHES * 2)) * CSS_PIXELS_PER_INCH),
      height: Math.ceil(A4_HEIGHT_INCHES * CSS_PIXELS_PER_INCH),
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await client.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: "document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()",
    }, sessionId);

    const metrics = await client.send("Page.getLayoutMetrics", {}, sessionId);
    const contentHeight = metrics.cssContentSize.height / CSS_PIXELS_PER_INCH;
    const paperHeight = options.singlePage
      ? Math.max(
        A4_HEIGHT_INCHES,
        Math.ceil((contentHeight + (PDF_MARGIN_INCHES * 2)) * 100) / 100
      )
      : A4_HEIGHT_INCHES;

    const pdf = await client.send("Page.printToPDF", {
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: false,
      paperWidth: A4_WIDTH_INCHES,
      paperHeight,
      marginTop: PDF_MARGIN_INCHES,
      marginBottom: PDF_MARGIN_INCHES,
      marginLeft: PDF_MARGIN_INCHES,
      marginRight: PDF_MARGIN_INCHES,
    }, sessionId);

    fs.writeFileSync(outputPath, Buffer.from(pdf.data, "base64"));
  } finally {
    if (client) {
      client.close();
    }
    chrome.kill();
  }
}

async function convert(inputPath, outputPath, options = {}) {
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "md2pdf-"));
  const htmlPath = path.join(temporaryDirectory, "document.html");

  try {
    const markdown = fs.readFileSync(inputPath, "utf8");
    fs.writeFileSync(htmlPath, renderHtml(markdown, inputPath), "utf8");

    await printPdf(pathToFileURL(htmlPath).href, outputPath, temporaryDirectory, options);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error("Chrome did not create a PDF file");
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(args) {
  const options = parseArguments(args);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.version) {
    console.log(packageJson.version);
    return;
  }

  await convert(options.inputPath, options.outputPath, {
    singlePage: options.singlePage,
  });
  console.log(options.outputPath);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`md2pdf: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { convert, findChrome, main, parseArguments, renderHtml };
