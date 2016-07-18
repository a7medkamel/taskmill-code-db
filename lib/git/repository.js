"use strict";

var Promise   = require('bluebird')
  , url       = require('url')
  , path      = require('path')
  , fs        = require('fs-extra')
  , _         = require('underscore')
  , Git       = require('nodegit')
  , Reset     = Git.Reset
  , Datastore = require('nedb')
  ;

var db = new Datastore({ filename: '.db/repository.db', autoload: true });

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

    return Promise.promisify(db.update, { context : db })(query, data, opts);
  }

  acl(options) {
    return this
            .getMetadata()
            .then((m) => {
              if (!_.isObject(m)) {
                throw new Error('not found');
              }

              var ret = Promise.resolve(m);

              if (m.private && options.token !== m.token) {
                // it is possible that the token was update / try a fetch and accept new token on success
                ret.tap(() => {
                  this.pull(options);
                });
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
                              opt.fetchOpts.callbacks.credentials = () => Git.Cred.userpassPlaintextNew(options.token, 'x-oauth-basic');
                              
                              return Promise
                                      .resolve(Git.Clone(this.remote, this.path, opt))
                                      .tap(() => {
                                        return this.updateMetadata({ private : true, token : options.token });
                                      });
                            } else {
                              throw err;
                            }
                          });
                })
                .catch((err) => {
                  delete Repository.store[this.id];
                  // mask error
                  console.error(this.remote, err);
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

                this.p = Git.Repository
                          .open(this.path)
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
                                        opt.callbacks.credentials = () => Git.Cred.userpassPlaintextNew(options.token, 'x-oauth-basic');
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
                            console.error(err);
                            // todo [akamel] this masks many errors
                            throw new Error('not found', this.id);
                          })
                          .finally(() => {
                            delete this.p;
                          });

                return this.p;
              });
    }

    return ret;
  }

  getMasterCommit() {
    return Git.Repository
            .open(this.path)
            .then((repo) => {
              return repo.getMasterCommit()
            });
  }

  entry(name) {
    return this
            .getMasterCommit()
            .then((commit) => {
              return commit.getEntry(name)
            });
  }

  blob(name) {
    return Promise
            .resolve(_.isString(name)? this.entry(name) : name)
            .then((entry) => {
              return entry.getBlob();
            });
  }

  stat(name) {
    return this
            .blob(name)
            .then((blob) => {
              return {
                  sha       : blob.id().toString()
                , isBinary  : !!blob.isBinary()
                , rawsize   : blob.rawsize()
              };
            });
  }

  // todo [akamel] this can refetch blob even if we got it from stat
  cat(name) {
    return this
            .blob(name)
            .then((blob) => {
              return blob.toString();
            });
  }

  walk(entry, end) {
    this
      .getMasterCommit()
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
  ls() {
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

                    if (filename === '.crontab') {
                      ret.push({
                          path  : entry.path()
                        , sha   : entry.sha()
                      });
                    }
                  }
                }
              }, () => {
                cb(undefined, {
                  data    : ret
                });
              });
            });
  }

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
                            console.log('pulled', doc.remote);
                          });
                })
                .catch((err) => {
                  console.error('error pulling repository', doc.remote, err, err.stack);
                });
      }, { concurrency : 5 });
    });
  }
}

Repository.store = {};

// todo [akamel] is this the right place for this?
Repository.pullAll();

module.exports = {
    get : Repository.get
};