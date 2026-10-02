import http from 'node:http';

// TODO: read the port from an environment variable
const server = http.createServer((req, res) => res.end('ok'));
server.listen(3000);
