"use strict";

var Promise     = require('bluebird')
  , url         = require('url')
  , path        = require('path')
  , winston     = require('winston')
  , config      = require('config-url')
  , fs          = require('fs-extra')
  , ascoltatori = require('ascoltatori')
  , _           = require('lodash')
  , Git         = require('nodegit')
  , git_spawn   = require('git-spawned-stream')
  , Reset       = Git.Reset
  , Datastore   = require('nedb')
  , Make        = require('../make')
  ;

var db = new Datastore({ filename: '.db/repository.db', autoload: true });

var pubsub = Promise.fromCallback((cb) => {
  ascoltatori.build({
    type            : 'redis',
    redis           : require('redis'),
    db              : config.get('pubsub.db'),
    host            : config.getUrlObject('pubsub').host,
    port            : config.getUrlObject('pubsub').port,
    password        : config.get('pubsub.password')
    // return_buffers  : true, // to handle binary payloads
  }, cb);
});

class Repository {
  constructor(id) {
    this.id = id;

    this.remote = id;

    var url_parsed = url.parse(this.id);

    this.path = path.join('.db', url_parsed.hostname, url_parsed.pathname);

    var path_parts = url_parsed.pathname.split(path.sep);
    
    this.username = path_parts[1];
    this.name = path.basename(path_parts[2], '.git');
  }

  cloneAt() {
    return Promise
            .promisify(fs.stat)(path.join(this.path, '.git/HEAD'))
            .then((stat) => {
              return stat.mtime.getTime();
            });
  }

  fetchAt() {
    return Promise
            .promisify(fs.stat)(path.join(this.path, '.git/FETCH_HEAD'))
            .then((stat) => {
              return stat.mtime.getTime();
            });
  }

  updatedAt() {
    return this.fetchAt()
            .catch(() => this.cloneAt() )
            .catch(() => undefined )
            ;
  }

  getMetadata() {
    return Promise.promisify(db.findOne, { context : db })({ remote : this.remote });
  }

  updateMetadata(patch) {
    var query   = { remote : this.remote }
      , data    = _.defaults({ remote : this.remote }, patch)
      , opts    = { upsert: true }
      ;

    winston.debug('repository.updateMetadata',  this.remote, { $set : data });
    return Promise.promisify(db.update, { context : db })(query, { $set : data }, opts);
  }

  acl(options) {
    return this
            .getMetadata()
            .then((m) => {
              if (!_.isObject(m)) {
                throw new Error('not found');
              }

              var ret = Promise.resolve(m);

              winston.debug('repository.acl', options, m)
              if (m.private && options.token !== m.token) {
                // it is possible that the token was update / try a fetch and accept new token on success
                ret = ret.then(() => this.pull(options));
              }

              return ret;
            });
  }

  onLocal() {
    return Promise
              .promisify(fs.access)(path.join(this.path, '.git/HEAD'), fs.R_OK | fs.W_OK)
              .then(() => {
                return true;
              })
              .catch(() => {
                return false;
              });
  }

  clone(options) {
    if (!this.c) {
      this.c = Promise
                .promisify(fs.ensureDir)(path.dirname(this.path))
                .then(() => {
                  var opt = { fetchOpts : { callbacks : { certificateCheck  : () => 1 } } };

                  return Promise
                          .resolve(Git.Clone(this.remote, this.path, opt))
                          .tap(() => {
                            return this.updateMetadata({ private : false });
                          })
                          .catch({ message : 'authentication required but no callback set' }, (err) => {
                            if (options.token) {
                              let attempt = 0;
                              opt.fetchOpts.callbacks.credentials = () => {
                                if (attempt) { return Git.Cred.defaultNew(); }

                                attempt++;
                                return Git.Cred.userpassPlaintextNew(options.token, 'x-oauth-basic');
                              };
                              
                              return Promise
                                      .resolve(Git.Clone(this.remote, this.path, opt))
                                      .tap(() => {
                                        return this.updateMetadata({ private : true, token : options.token });
                                      });
                            } else {
                              throw new Error('authentication required');
                            }
                          });
                })
                .catch((err) => {
                  delete Repository.store[this.id];
                  // mask error
                  winston.info(`clone failed for ${this.remote}`);
                  throw new Error('not found');
                })
                .finally(() => {
                  delete this.c;
                });
    }

    return this.c;
  }

  // todo [akamel] problem when clone with token A fails / chained clone with token B will also fail and must retry
  pull(options) {
    var ret = this.p || this.c;

    if (!ret) {
      ret = this
              .onLocal()
              .then((local) => {
                if (!local) {
                  return this.clone({ token : options.token });
                }

                this.p = Promise
                          .resolve(Git.Repository.open(this.path))
                          .then((repo) => {
                            return Promise
                                    .resolve(repo.getBranchCommit('origin/master'))
                                    .then((originHeadCommit) => {
                                      // todo [akamel] shouldn't need this / but prod ended with merge conflict / diverge
                                      return Reset.reset(repo, originHeadCommit, Reset.TYPE.HARD);
                                    })
                                    .then(() => {
                                      var opt = { callbacks : { certificateCheck  : () => 1 } };
                                      
                                      if (options.token) {
                                        let attempt = 0;
                                        opt.callbacks.credentials = () => {
                                          if (attempt) { return Git.Cred.defaultNew(); }

                                          attempt++;
                                          return Git.Cred.userpassPlaintextNew(options.token, 'x-oauth-basic');
                                        };
                                      }

                                      return repo.fetch('origin', opt);
                                    })
                                    .then(() => {
                                      return repo.mergeBranches('master', 'origin/master');
                                    })
                                    .tap(() => {
                                      return this
                                              .getMetadata()
                                              .then((m) => {
                                                // todo [akamel] this doesn't deal with repos that change from public to private?
                                                // update token in case it changed
                                                if (m && m.token) {
                                                  return this.updateMetadata({ token : options.token });
                                                }
                                              });
                                    });
                          })
                          .catch((err) => {
                            winston.error('repository.pull', err);
                            // todo [akamel] this masks many errors
                            throw new Error('not found', this.id);
                          })
                          .finally(() => {
                            delete this.p;
                          });

                return this.p;
              })
              .tap(() => {
                return pubsub
                        .then((store) => {
                          return this
                                  .getMetadata()
                                  .then((m) => {
                                    if (!_.isObject(m)) {
                                      throw new Error('not found');
                                    }

                                    let msg = {
                                        remote  : this.remote
                                      , private : m.private
                                    }

                                    let pub_pull = Promise.fromCallback((cb) => store.publish('codedb/pull', msg, cb));

                                    let pub_cron = this
                                                    .cat('.crontab')
                                                    .catch((err) => {
                                                      // supress '.crontab' not found
                                                      return undefined;
                                                    })
                                                    .then((text) => {
                                                      // send even if text is empty to allow cron to delete existing crontab
                                                      let msg = {
                                                          remote  : this.remote
                                                        // , branch  : ''
                                                        , blob    : text
                                                      };

                                                      return Promise.fromCallback((cb) => store.publish('codedb/pull/crontab', msg, cb));
                                                    });

                                    return Promise.all([ pub_pull, pub_cron ]);
                                  });
                        });
              });
    }

    return ret;
  }


  // todo [akamel] change etag to something other than date?
  snapshot(options = {}) {
    var { token, branch, ifnonmatch } = options;

    // todo [akamel] check ifnonmatch based on sha, not date
    return this
            .updatedAt()
            .then((at) => {
              winston.verbose('pull', 'at', this.id, at);
              if (_.isUndefined(ifnonmatch) || at != ifnonmatch) {
                // todo [akamel] this might be to agressive for /archive
                return this
                        .pull({ token : token })
                        .then((pull) => {
                          return Promise
                                  .try(() => {
                                    return Promise.all([this.updatedAt(), this.archive({ branch })]);
                                  })
                                  .spread((at, stream) => {
                                    if (!options.make) {
                                      return [at, stream];
                                    }

                                    return new Make(this.remote)
                                                .stream(stream, { branch, ifnonmatch })
                                                .then((stream) => {
                                                  return [at, stream];
                                                });
                                  })
                        });
              } else {
                return [at];
              }
            });
  }

  archive(options = {}) {
    let rev     = options.branch || 'HEAD'
      , dirname = path.join(this.path, '/.git')
      , args    = ['archive', '--format=tar', rev]
      ;

    return git_spawn(dirname, args);
  }

  getMasterCommit() {
    return Git.Repository
            .open(this.path)
            .then((repo) => {
              return repo.getMasterCommit()
            });
  }

  getBranchCommit(name) {
    if (!name) {
      return this.getMasterCommit();
    }

    return Git.Repository
            .open(this.path)
            .then((repo) => {
              return repo
                      .getCommit(name)
                      // if can't find a named branch, try by sha
                      .catch((err) => repo.getBranchCommit(name));
            });
  }

  entry(name, branch) {
    return this
            .getBranchCommit(branch)
            .then((commit) => {
              return commit.getEntry(name)
            });
  }

  blob(name, branch) {
    return Promise
            .resolve(_.isString(name)? this.entry(name, branch) : name)
            .then((entry) => {
              return entry.getBlob();
            });
  }

  stat(name, branch) {
    return this
            .blob(name, branch)
            .then((blob) => {
              return {
                  sha       : blob.id().toString()
                , isBinary  : !!blob.isBinary()
                , rawsize   : blob.rawsize()
              };
            });
  }

  // todo [akamel] this can refetch blob even if we got it from stat
  cat(name, branch) {
    return this
            .blob(name, branch)
            .then((blob) => {
              return blob.toString();
            });
  }

  walk(entry, end, branch) {
    this
      .getBranchCommit(branch)
      .then((commit) => {
        commit
          .getTree()
          .then((tree) => {
            var walker = tree.walk();
            walker.on('entry', entry);
            walker.on('end', end);

            walker.start();
          });
      });
  }

  // todo [akamel] this doesn't measure size
  ls(branch) {
    return Promise
            .fromCallback((cb) => {
              var ret = [];

              this.walk((entry) => {
                if(entry.isFile()) {
                  var filename = entry.path();
                  if (!/\/node_modules\//.test(filename)) {
                    let ext = path.extname(filename);
                    if (ext === '.js') {
                      ret.push({
                          path  : entry.path()
                        , sha   : entry.sha()
                      });
                    }

                    // todo [akamel] find best way to expose .crontab to user
                    // if (filename === '.crontab') {
                    //   ret.push({
                    //       path  : entry.path()
                    //     , sha   : entry.sha()
                    //   });
                    // }
                  }
                }
              }, () => {
                cb(undefined, {
                  data    : ret
                });
              }, branch);
            });
  }

  // commits(count) {
  //   return Git.Repository
  //           .open(this.path)
  //           .then((repo) => {
  //             let revwalk = Git.Revwalk.create(repo);

  //             revwalk.sorting(Git.Revwalk.SORT.TIME);
  //             revwalk.pushHead();

  //             return revwalk.getCommits(count);
  //           })
  //           .then((commits) => {
  //             console.log('commits->', _.map(commits, (commit) => { return { date : commit.date(), message : commit.message(), parents : commit.parents(), sha : commit.sha() } }));
  //           });
  // }

  static get(id) {
    return Promise.try(() => {
      if (!Repository.store[id]) {
        Repository.store[id] = new Repository(id);
      }

      return Repository.store[id];
    });
  }

  static pullAll() {
    db.find({}, function (err, docs) {
      Promise.map(docs, (doc) => {
        return Repository
                .get(doc.remote)
                .then((repo) => {
                  return repo
                          .pull({ token : doc.token })
                          .tap(() => {
                            winston.info('pulled', doc.remote);
                          });
                })
                .catch((err) => {
                  winston.error('error pulling repository', doc.remote, err, err.stack);
                });
      }, { concurrency : 5 });
    });
  }
}

Repository.store = {};

// todo [akamel] is this the right place for this?
if (config.get('codedb.pull-on-start')) {
  Repository.pullAll();
}

module.exports = {
    get : Repository.get
};