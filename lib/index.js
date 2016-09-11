var express     = require('express')
  , Promise     = require('bluebird')
  , bodyParser  = require('body-parser')
  , winston     = require('winston')
  , config      = require('config-url')
  , _           = require('underscore')
  , man         = require('taskmill-core-man')
  , rp          = require('request-promise')
  , babel       = require('babel-core')
  , Repository  = require('./git/repository')
  , urljoin     = require('url-join')
  ;

var app = express();

app.use(bodyParser.json());

function blob_metadata(text, fields) {
  fields = fields || {};

  let ret = {};

  if (fields.ast || fields.manual || fields.es5) {
    try {
      let es6 = babel.transform(text); // => { code, map, ast }

      if (fields.ast) {
        ret.ast = es6.ast;
      }

      if (fields.manual) {
        ret.manual = man.get(es6);
      }

      if (fields.es5) {
        ret.es5 = es6.code;
      }
    } catch(err) {}
  }

  return ret;
}

app.post('/blob', function(req, res, next){
  var remote          = req.body.remote   //|| 'https://github.com/a7medkamel/taskmill-core-agent.git'
    , branch          = req.body.branch   || 'master' // todo [akamel] not used
    , filename        = req.body.filename //|| 'lib/core/worker.js'
    , token           = req.body.token
    , populate        = req.body.populate || {}
    ;

  let s = process.hrtime();
  Repository
    .get(remote)
    .then((repo) => {
      return repo
              .updatedAt()
              .then((at) => {
                winston.verbose('blob', 'at', repo.id, at);
                // ttl is in seconds
                if (!at || (Date.now - at) / 1000 > config.get('codedb.ttl')) {
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
                        .then((text) => {
                          let item = {
                              stat        : stat
                            , repository  : _.omit(repository, '_id', 'token')
                            // todo [akamel] this doesn't have branch/commit
                            , uid         : urljoin(remote + '+', filename)
                            // todo [akamel] add branch and path to ls as well...
                            , branch      : branch
                            , path        : filename[0] === '/'? filename : '/' + filename
                            , updatedAt   : at
                            , content     : text
                          };

                          let meta = blob_metadata(text, populate);

                          res.send(_.extend(item, meta));
                        });
              });
    })
    .catch((err) => {
      winston.error(err);
      res.status(400).send({ message : err.message });
    })
    .finally(() => {
      let diff = process.hrtime(s);
      winston.info(`blob read took ${(diff[0] * 1e9 + diff[1]) / 1e6} ms`);
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
    , populate        = req.body.populate
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
                if (_.isEmpty(populate)) {
                  return result;
                }

                let limited = _.take(result.data, config.get('codedb.populate.limit'));
                return Promise
                        .map(limited, (item) => {
                          if (populate.repository) {
                            item.repository = repo.name;
                          }

                          if (populate.username) {
                            item.username = repo.username;
                          }

                          return repo
                                  .stat(item.path)
                                  .then((stat) => {
                                    if (stat.rawsize > 1024 /* 1kb */ * 10) {
                                      item.rawsize = stat.rawsize;
                                      return item;
                                    }

                                    if (stat.isBinary) {
                                      item.binary = true;
                                      return item;
                                    }

                                    return repo
                                            .cat(item.path)
                                            .then((text) => {
                                              if (populate.blob) {
                                                item.blob = text;
                                              }

                                              let meta = blob_metadata(text, populate);

                                              _.extend(item, meta);

                                              return item;
                                            })
                                            .catch((err) => {
                                              // supress errors in populate
                                              return item;
                                            });
                                  });
                        })
                        .then((data) => {
                          // todo [akamel] this might not be required, as .map is acting on the original obj
                          // result.data = data;
                          return result;
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