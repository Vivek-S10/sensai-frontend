const text = "A\nB";
const blocks = text.split('\n').map(line => ({
  type: "paragraph",
  content: [{ type: "text", text: line, styles: {} }]
}));
console.log(JSON.stringify(blocks, null, 2));
