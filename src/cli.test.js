const path = require("path");
const { parseArguments, renderHtml } = require("../bin/md2pdf");

test("uses the input name for the default PDF path", () => {
  const options = parseArguments(["notes/example.md"]);

  expect(options.inputPath).toBe(path.resolve("notes/example.md"));
  expect(options.outputPath).toBe(path.resolve("notes/example.pdf"));
});

test("accepts an explicit output path", () => {
  const options = parseArguments(["notes/example.md", "-o", "out/result.pdf"]);

  expect(options.outputPath).toBe(path.resolve("out/result.pdf"));
});

test("renders Markdown with the source directory as its base URL", () => {
  const inputPath = path.resolve("notes/example.md");
  const html = renderHtml("# 标题\n\n![image](image.png)", inputPath);

  expect(html).toContain("<h1>标题</h1>");
  expect(html).toContain("<base href=");
  expect(html).toContain("<img src=\"image.png\"");
});
