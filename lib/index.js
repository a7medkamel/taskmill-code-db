var express     = require('express')
  , Promise     = require('bluebird')
  , bodyParser  = require('body-parser')
  , winston     = require('winston')
  , config      = require('config-url')
  , _           = require('underscore')
  , rp          = require('request-promise')
  , Repository  = require('./git/repository')
  , urljoin     = require('url-join')
  ;

var app = express();

app.use(bodyParser.json());

app.post('/blob', function(req, res, next){
  var remote          = req.body.remote   //|| 'https://github.com/a7medkamel/taskmill-core-agent.git'
    , branch          = req.body.branch   || 'master' // todo [akamel] not used
    , filename        = req.body.filename //|| 'lib/core/worker.js'
    , token           = req.body.token
    ;

  Repository
    .get(remote)
    .then((repo) => {
      return repo
              .updatedAt()
              .then((at) => {
                winston.verbose('blob', 'at', repo.id, at);
                if (!at || Date.now - at > config.get('codedb.ttl')) {
                  return repo.pull({ token : token }).then(() => Date.now);
                }

                return at;
              })
              .then((at) => {
                return [ at, repo.acl({ token : token }) ];
              })
              .spread((at, repository) => {
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
                          return [ at, stat, repository ];
                        });
              })
              .spread((at, stat, repository) => {
                return repo
                        .cat(filename)
                        .then((data) => {
                          res.send({
                              stat        : stat
                            , repository  : _.omit(repository, '_id', 'token')
                            // todo [akamel] this doesn't have branch/commit
                            , uid         : urljoin(remote + '+', filename)
                            // todo [akamel] add branch and path to ls as well...
                            , branch      : branch
                            , path        : filename[0] === '/'? filename : '/' + filename
                            , updatedAt   : at
                            , content     : data
                          });
                        });
              });
    })
    .catch(function(err){
      winston.error(err);
      res.status(400).send({ message : err.message });
    });
});

app.post('/pull', function(req, res, next){
  var remote          = req.body.remote
    , token           = req.body.token
    ;

  Repository
    .get(remote)
    .then((repo) => {
      return repo
              .updatedAt()
              .then((at) => {
                winston.verbose('pull', 'at', repo.id, at);
                if (at) {
                  return repo.pull({ token : token });
                }
              })
              .then(() => {
                // read crontab file
                // todo [akamel] maybe we should update crontab on all pull calls [on db boot], not just /pull
                return repo
                        .cat('.crontab')
                        .catch((err) => {
                          // supress '.crontab' not found
                          return undefined;
                        })
                        .then((text) => {
                          // send even if text is empty to allow cron to delete existing crontab
                          return rp.post({
                                        // todo [akamel] use url-join or replace with message queue
                                        url   : config.getUrl('cron.scheduler') + '/cron'
                                      , json  : true
                                      , body  : {
                                                    remote  : remote
                                                  // , branch  : ''
                                                  , text    : text
                                                }
                                    });
                        });
              })
              .then(() => {
                res.send({ message : 'OK' });
              })
    })
    .catch(function(err){
      winston.error(err);
      res.status(400).send({ message : err.message });
    });
});

app.post('/ls', function(req, res, next){
  var remote          = req.body.remote
    , token           = req.body.token
    ;

  Repository
    .get(remote)
    .then((repo) => {
      return repo
              .updatedAt()
              .then((at) => {
                winston.verbose('ls', 'at', repo.id, at);
                if (!at) {
                  return repo.pull({ token : token }).then(() => at);
                }

                return at;
              })
              .tap(() => {
                return repo.acl({ token : token });
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
              });
    })
    .catch(function(err){
      winston.error(err);
      res.status(400).send({ message : err.message });
    });
});

function listen(options, cb) {
  return Promise
          .promisify(app.listen, { context : app})(options.port)
          .nodeify(cb);
}

module.exports = {
    listen : listen
};