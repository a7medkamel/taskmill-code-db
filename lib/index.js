var express     = require('express')
  , Promise     = require('bluebird')
  , bodyParser  = require('body-parser')
  , config      = require('config')
  , Repository  = require('./git/repository')
  ;

var app = express();

app.use(bodyParser.json());

app.post('/blob', function(req, res, next){
  var remote          = req.body.remote   //|| 'https://github.com/a7medkamel/taskmill-core-agent.git'
    , branch          = req.body.branch   || 'master' // todo [akamel] not used
    , filename        = req.body.filename //|| 'lib/core/worker.js'
    , token           = req.body.token
    , criteria        = req.body.criteria
    ;

  var repo = Repository.get(remote);

  repo
    .updatedAt()
    .then((at) => {
      console.log('blob', 'at', repo.id, at);
      if (!at || Date.now - at > config.get('ttl')) {
        return repo.pull({ token : token }).then(() => Date.now);
      }

      return at;
    })
    .tap(() => {
      return repo.acl(criteria);
    })
    .then((at) => {
      // todo [akamel] this can leak repo existance, mask with 'file not found'
      return repo
              .stat(filename)
              .then((stat) => {
                if (stat.rawsize > 1024 /* 1kb */ * 10) {
                  throw new Error('file is larger than 10kb limit');
                }

                if (stat.isBinary) {
                  throw new Error('file is binary');
                }
                return [ at, stat ];
              });
    })
    .spread((at, stat) => {
      return repo
              .cat(filename)
              .then((data) => {
                res.send({
                    stat      : stat
                  , updatedAt : at
                  , content   : data
                });
              });
    })
    .catch(function(err){
      console.error(err);
      res.status(400).send({ message : err.message });
    });
});

app.post('/pull', function(req, res, next){
  var remote          = req.body.remote
    , token           = req.body.token
    ;

  var repo = Repository.get(remote);

  repo
    .updatedAt()
    .then((at) => {
      console.log('pull', 'at', repo.id, at);
      if (at) {
        return repo.pull({ token : token });
      }
    })
    .then(() => {
      res.send({ message : 'OK' });
    })
    .catch(function(err){
      console.error(err);
      res.status(400).send({ message : err.message });
    });
});

app.post('/ls', function(req, res, next){
  var remote          = req.body.remote
    , token           = req.body.token
    , criteria        = req.body.criteria
    ;

  var repo = Repository.get(remote);

  repo
    .updatedAt()
    .then((at) => {
      console.log('ls', 'at', repo.id, at);
      if (!at) {
        return repo.pull({ token : token }).then(() => at);
      }

      return at;
    })
    .tap(() => {
      return repo.acl(criteria);
    })
    .then((at) => {
      return repo
              .ls()
              .then((result) => {
                return {
                    updatedAt : at
                  , data      : result.data
                }
              });
    })
    .then((result) => {
      res.send(result);
    })
    .catch(function(err){
      console.error(err);
      res.status(400).send({ message : err.message });
    });
});

function listen(options, cb) {
    Promise
      .promisify(app.listen, { context : app})(options.port)
      .tap(function(){
      console.log('codedb started and listeing to:', options.port);
    })
    .nodeify(cb);
}

module.exports = {
    listen : listen
};