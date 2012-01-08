var fs = require('fs');
var net = require('net');
var https = require('https');
var crypto = require('crypto');
var urlParse = require('url').parse;
var WebSocketServer = require('websocket').server;

var key = fs.readFileSync('keys/ssl.key', 'utf8');
var cert = fs.readFileSync('keys/ssl.crt', 'utf8');
var users = loadUsers();

var server = https.createServer({key: key, cert: cert});

server.on('request', function(req, res) {
  if (req.url == '/') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('This is a secure HTTP/1.1 WebSocket server.\n');
  } else
  if (req.url == '/auth') {
    if (authenticate(req)) {
      res.writeHead(204);
    } else {
      res.writeHead(401, {'WWW-Authenticate': 'Basic'});
    }
    res.end();
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('404 Not Found.\n');
  }
});

server.listen(443, '192.168.67.11', function() {
  var addr = server.address();
  console.log('listening on ' + addr.address + ':' + addr.port);
});


var wsServer = new WebSocketServer({
  httpServer: server,
  key: key,
  cert: cert
});

wsServer.on('request', function(request) {
  var url = urlParse(request.resource, true);
  var args = url.pathname.split('/').slice(1);
  var action = args.shift();
  var params = url.query;
  if (action == 'tunnel') {
    createTunnel(request, params.port, params.host);
  } else {
    request.reject(404);
  }
});


function authenticate(request) {
  var encoded = request.headers['authorization'] || '', credentials;
  encoded = encoded.replace(/Basic /i, '');
  try {
    credentials = new Buffer(encoded, 'base64').toString('utf8').split(':');
  } catch(e) {
    credentials = [];
  }
  var user = credentials[0], hash = md5(credentials[1]);
  return (users[user] == hash);
}

function createTunnel(request, port, host) {
  if (!authenticate(request.httpRequest)) {
    request.reject(403);
    return;
  }
  var webSock = request.accept();
  console.log(webSock.remoteAddress + ' connected - Protocol Version ' + webSock.websocketVersion);

  var tcpSock = new net.Socket();

  tcpSock.on('error', function(err) {
    webSock.send(JSON.stringify({status: 'error', details: 'Upstream socket error; ' + err}));
  });

  tcpSock.on('data', function(data) {
    webSock.send(data);
  });

  tcpSock.on('close', function() {
    webSock.close();
  });

  tcpSock.connect(port, host || '127.0.0.1', function() {
    webSock.on('message', function(msg) {
      if (msg.type === 'utf8') {
        console.log('received utf message: ' + msg.utf8Data);
      } else {
        console.log('received binary message of length ' + msg.binaryData.length);
        tcpSock.write(msg.binaryData);
      }
    });
    webSock.send(JSON.stringify({status: 'ready', details: 'Upstream socket connected'}));
  });

  webSock.on('close', function() {
    tcpSock.destroy();
    console.log(webSock.remoteAddress + ' disconnected');
  });
}

function loadUsers() {
  var lines = fs.readFileSync('users.txt', 'utf8');
  var users = {};
  lines.split(/[\r\n]+/g).forEach(function(line) {
    var parts = line.split(':');
    if (parts.length == 2) {
      users[parts[0]] = parts[1];
    }
  });
  return users;
}

function md5(s) {
  var hash = crypto.createHash('md5');
  hash.update(new Buffer(String(s)));
  return hash.digest('hex');
}