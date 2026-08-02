const http = require("http");

const port = Number(process.env.PORT) || 3000;

http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello from node\n");
  })
  .listen(port, () => {
    console.log(`listening on ${port}`);
  });
