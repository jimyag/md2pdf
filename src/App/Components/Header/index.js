import React from "react";
import { useState } from "react";
import styled from "styled-components";
import UploadButton from "./Upload.js";
import FontPicker from "./FontPicker.js";

const CSS_PIXELS_PER_MM = 96 / 25.4;

function printSinglePage(previewEl, title) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    window.print();
    return;
  }

  const pageStyles = Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map(node => node.outerHTML)
    .join("\n");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    ${pageStyles}
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: white;
      }
      .markdown-body {
        box-sizing: border-box;
        width: 210mm;
        max-width: none;
        overflow: visible;
        padding: 16mm;
      }
      @media print {
        html,
        body,
        .markdown-body {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }
      }
    </style>
  </head>
  <body>
    <main class="markdown-body">${previewEl.innerHTML}</main>
  </body>
</html>`);
  printWindow.document.close();

  const printWhenReady = async () => {
    if (printWindow.document.fonts && printWindow.document.fonts.ready) {
      await printWindow.document.fonts.ready;
    }

    await new Promise(resolve => printWindow.requestAnimationFrame(resolve));
    await new Promise(resolve => printWindow.requestAnimationFrame(resolve));

    const contentEl = printWindow.document.querySelector(".markdown-body");
    const contentHeightPx = Math.max(
      contentEl.scrollHeight,
      contentEl.offsetHeight,
      contentEl.getBoundingClientRect().height
    );
    const contentHeightMm = Math.ceil(contentHeightPx / CSS_PIXELS_PER_MM) + 12;
    const printStyle = printWindow.document.createElement("style");
    printStyle.textContent = `@page { size: 210mm ${contentHeightMm}mm; margin: 0; }`;
    printWindow.document.head.appendChild(printStyle);

    await new Promise(resolve => printWindow.requestAnimationFrame(resolve));
    await new Promise(resolve => printWindow.requestAnimationFrame(resolve));

    printWindow.focus();
    printWindow.print();
    printWindow.addEventListener("afterprint", () => printWindow.close(), {
      once: true,
    });
  };

  printWhenReady();
}

const Header = ({ className }) => {
  const [singlePage, setSinglePage] = useState(false);

  const onTransfrom = async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }

    const previewEl = document.querySelector(".preview");
    let candidateTitle = "";
    const candidateTitleEl = previewEl && previewEl.querySelector("h1");
    if (candidateTitleEl) {
      candidateTitle = candidateTitleEl.innerText;
    }

    if (singlePage && previewEl) {
      printSinglePage(previewEl, candidateTitle || document.title);
      return;
    }

    // get the file name
    if (candidateTitle) {
      // do the effect change the title
      const currentTitle = document.title;
      document.title = candidateTitle;
      window.requestAnimationFrame(() => {
        // schedule resume back in next frame
        document.title = currentTitle;
      });
    }
    window.print();
  };
  return (
    <header className={className + " no-print"}>
      <p className="project"> md2pdf </p>
      <iframe
        title="github-button"
        className="project"
        style={{ display: "block" }}
        src="https://ghbtns.com/github-btn.html?user=realdennis&repo=md2pdf&type=star&count=true"
        frameBorder="0"
        scrolling="0"
        width="100px"
        height="20px"
      />

      <div className="menu">
        <FontPicker className="font-picker" />
        <UploadButton className="button upload" />
        <label className="single-page">
          <input
            type="checkbox"
            checked={singlePage}
            onChange={event => setSinglePage(event.target.checked)}
          />
          <span>Single page</span>
        </label>
        <p className="button download" onClick={onTransfrom}>
          <span role="img" aria-label="download">
            🎉
          </span>
          <span>Transform</span>
        </p>
      </div>
      {/* <span className="author">Powered by @realdennis</span> */}
    </header>
  );
};

export default styled(Header)`
  * {
    box-sizing: border-box;
  }
  flex-shrink: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  user-select: none;
  padding-left: 5px;
  padding-right: 5px;
  color: black;
  background-color: rgb(233, 233, 233);
  display: flex;
  align-items: center;
  height: 40px;
  .project {
    font-weight: bold;
    margin: 5px;
    flex-shrink: 0;
    height: 20px;
  }
  div.menu {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-end;
      .font-picker {
        display: flex;
        align-items: center;
      gap: 3px;
      height: 80%;
      margin-left: 3px;
      button,
      select {
        height: 100%;
        border: 1px solid black;
        border-radius: 3px;
        background: white;
      }
      button {
        cursor: pointer;
      }
      button:disabled {
        cursor: wait;
      }
      select {
        max-width: 180px;
      }
      .font-message {
        color: #b00020;
        font-weight: bold;
        cursor: help;
      }
    }
    .single-page {
      height: 80%;
      margin-left: 3px;
      display: flex;
      align-items: center;
      gap: 4px;
      border: 1px solid black;
      border-radius: 3px;
      padding: 0 8px;
      background: white;
      white-space: nowrap;
      position: relative;
      input,
      span {
        cursor: pointer;
      }
      span::after {
        content: "Print as one A4-width page. Turn off Headers and footers for best results.";
        display: none;
        position: absolute;
        top: 110%;
        right: 0;
        width: 260px;
        padding: 6px 8px;
        border: 1px solid #999;
        border-radius: 3px;
        background: white;
        color: #222;
        font-size: 12px;
        line-height: 1.4;
        white-space: normal;
        z-index: 10;
      }
      &:hover span::after {
        display: block;
      }
    }
    .button {
      height: 80%;
      margin: 0;
      display: flex;
      align-items: center;
      margin-left: 3px;
      border-radius: 3px;
      border: 1px solid black;
      padding: 10px;
      cursor: pointer;
    }
  }

  /* span.author {
    position: fixed;
    bottom: 2px;
    left: 2px;
    opacity: 0.5;
    color: white;
    height: 20px;
    z-index:99;
  } */
  @keyframes dance {
    0% {
      transform: rotate(3deg);
    }
    100% {
      transform: rotate(-2deg);
    }
  }
`;
