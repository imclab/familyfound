#!/usr/bin/env node

require('js-yaml');
var express = require('express')
  , http = require('http')
  , app = express()
  , path = require('path')
  , fs = require('fs')
  , server = http.createServer(app)

  , connect = require('connect')
  , SessionSockets = require('session.socket.io')

  , db = require('./lib/db')
  , config = require('./lib/config')

  , api = require('./routes/api')
  , sock = require('./routes/sock')
  , oauth = require('./routes/oauth')
  , todos = require('./routes/todos')
  , alerts = require('./routes/alerts')

  , cookieParser = express.cookieParser(config.SECRET)
  , sessionStore = new connect.middleware.session.MemoryStore()
  , sessionSockets = new SessionSockets(io, sessionStore, cookieParser);

// all environments
app.set('port', process.env.PORT || config.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
// app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(cookieParser);
app.use(express.session({store: sessionStore}));
app.use(app.router);

var io = sock(sessionSockets)

// most things go through here
app.use(express.static(path.join(__dirname, 'static')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

api.addRoutes(app);
oauth.addRoutes(app);
alerts.addRoutes(app);
todos.addRoutes(app);

var index = function(req, res) {
  res.send(fs.readFileSync(path.join(__dirname, 'static', 'index.html')).toString('utf8'));
};

app.get('/', oauth.hostChecker, index);

var pages = require('./assets/pages');
Object.keys(pages.routes).forEach(function(page){
  app.get(page, oauth.hostChecker, index);
});

db.onload(function () {
  server.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
  });
});
