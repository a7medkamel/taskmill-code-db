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
  , output      = require('create-output-stream')
  , git         = require('taskmill-core-git')
  , zlib        = require('zlib')
  , mime        = require('mime-types')
  , PassThrough = require('stream').PassThrough
  , Reset       = Git.Reset
  , Make        = require('../make')
  // todo [akamel] temp direct hook to github based on hostname
  , GitHub      = require('../model/host/github')
  , redis       = require('redis')
  , async       = require('async')
  , cache_man   = require('cache-manager')
  ;

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

let redis_opts = {
    db              : config.get('codedb.redis.db')
  , host            : config.getUrlObject('codedb.redis').host
  , port            : config.getUrlObject('codedb.redis').port
};

if (config.has('codedb.redis.password')) {
  if (!_.isEmpty(config.get('codedb.redis.password'))) {
    redis_opts.password = config.get('codedb.redis.password');
  }
}

let redis_client = redis.createClient(redis_opts);

var cache = cache_man.caching({ store : 'memory', max : 1000, ttl : 20 /*seconds*/});

var pubsub = Promise.fromCallback((cb) => {
  let opts = {
      type            : 'redis'
    , redis
    , db              : config.get('pubsub.db')
    , host            : config.getUrlObject('pubsub').host
    , port            : config.getUrlObject('pubsub').port
    // return_buffers  : true, // to handle binary payloads
  };

  if (config.has('pubsub.password')) {
    if (!_.isEmpty(config.get('pubsub.password'))) {
      opts.password = config.get('pubsub.password');
    }
  }

  ascoltatori.build(opts, cb);
});

class Repository {
  constructor(remote) {
    this.def = git.remote(remote);

    // todo [akamel] we might want the key with a different user instead of repo's owner
    this.path = path.join('.db', git.dir(this.def));

    // todo [akamel] might not be required, we normalize path in .remote on the -git repo
    let rel = path.relative('.db', this.path);
    if (_.startsWith(rel, '..')) {
      throw new error('malformed repository name');
    }
  }

  full_name() {
    return _.toLower(this.def.repo);
  }

  key() {
    return git.key(this.def);
  }

  remote() {
    return git.normalize(this.def).remote;
  }

  username() {
    return git.normalize(this.def).username;
  }

  hostname() {
    return this.def.hostname;
  }

  pathname() {
    return this.def.pathname;
  }

  repo() {
    return git.normalize(this.def).repo;
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

  read_rec() {
    let key = `repo:${this.key()}`;

    let ret = redis_client.hgetallAsync(key);
    ret.private = !ret['acl:*'];

    return ret;
  }

  write_rec(/*patch*/) {
    let key = `repo:${this.key()}`;

    return Promise
            .try(() => {
              let remote    = this.remote()
                , data      = { remote }
                , arr       = _.chain(data).pickBy().entries().flatten().value()
                ;

              // .then(() => redis_client.expireAsync(this.key, ttl));
              return redis_client
                      .hmsetAsync(key, arr)
                      .tap(() => {
                        winston.info(`write_rec ${key} ${remote}`)
                      });
            });
  }

  // todo [akamel] SET might be better perf than key store
  del_acl(options = {}) {
    let token = options.token || '*'
      , key   = `repo:${this.key()}`
      ;

    return redis_client.hdelAsync(key, `acl.${token}`);
  }

  read_acl(options = {}) {
    let token = options.token || '*';

    return this.hget(`acl.${token}`);
  }

  write_acl(options = {}) {
    let token = options.token || '*';

    return this.hset(`acl.${token}`, true);
  }

  hget(field) {
    return redis_client.hgetAsync(`repo:${this.key()}`, field);
  }

  hset(field, value) {
    return redis_client.hsetAsync(`repo:${this.key()}`, field, value);
  }

  list_acl() {
    return this
            .read_rec()
            .then((rec) => {
              if (_.isEmpty(rec)) {
                return [];
              }

              return _.transform(rec, (result, value, key) => {
                if (_.startsWith(key, 'acl.')) {
                  result.push(key.substring(4));
                }
              }, []);
            });
  }

  list_oauth_acl() {
    return this
            .list_acl()
            .then((arr) => {
              return _.filter(arr, (t) => t != '*');
            });
  }

  // todo [akamel] what does this do?
  any_acl() {
    return this
            .list_acl()
            .then((arr) => {
              let token = arr[0];

              if (token === '*') {
                token = undefined;
              }

              return token;
            });
  }

  del_git_rec(options = {}) {
    let key = `git:${this.key()}:pull`;

    return redis_client.delAsync(key);
  }

  read_git_rec() {
    let key = `git:${this.key()}:pull`;

    return redis_client.getAsync(key);
  }

  write_git_rec(options = {}) {
    let key = `git:${this.key()}:pull`
      , ttl = options.ttl || config.get('codedb.ttl')
      ;

    return redis_client
            .setAsync(key, new Date().getTime())
            .then(() => {
              if (ttl > 0) {
                return redis_client.expireAsync(key, ttl);
              }
            });
  }

  acl(options = {}) {
    // 1. check if public access
    return this
            .read_acl()
            .then((acl) => {
              if (!acl) {
                // 2. check if private access
                let { token } = options;

                // 2.1 if no token exit
                if (!token) {
                  throw new Error('repository not found');
                }

                // 2.2 check if token was already used with this repo
                return this
                        .read_acl(options)
                        .then((acl) => {
                          if (!acl) {
                            // 2.3 if token not used, try to pull with token
                            return this.pull({ token });
                          }
                        })
              }
            })
            .then(() => true);
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

  // todo [akamel] store token even if publicly accessable?
  clone(options = {}) {
    if (!this.c) {
      this.c = Promise
                .promisify(fs.ensureDir)(path.dirname(this.path))
                .then(() => {
                  var opt = { fetchOpts : { callbacks : { certificateCheck  : () => 1 } } };

                  return Promise
                          .resolve(Git.Clone(this.remote(), this.path, opt))
                          .tap(() => {
                            return this.write_acl();
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
                                      .resolve(Git.Clone(this.remote(), this.path, opt))
                                      .tap(() => {
                                        return this.write_acl(options);
                                      });
                            } else {
                              throw new Error('authentication required');
                            }
                          })
                          .then(() => {
                            return this.write_rec();
                          });
                })
                .catch((err) => {
                  delete Repository.store[this.key()];
                  // mask error
                  winston.info(`clone failed for ${this.remote()}`);
                  throw new Error('repository not found');
                })
                .finally(() => {
                  delete this.c;
                });
    }

    return this.c;
  }

  // todo [akamel] problem when clone with token A fails / chained clone with token B will also fail and must retry
  pull(options = {}) {
    var ret = this.p || this.c;

    if (!ret) {
      // todo [akamel] onLocal can result in a race condition?
      ret = this
              .onLocal()
              .then((local) => {
                if (!local) {
                  return this.clone({ token : options.token });
                }

                this.p = Promise
                          .resolve(Git.Repository.open(this.path))
                          .then((repo) => {
                            // todo [akamel] use sha-ify instead of 'origin/master'
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
                                      // todo [akamel] use sha-ify
                                      return repo.mergeBranches('master', 'origin/master');
                                    })
                                    .tap(() => {
                                      return this.write_acl(options);
                                    });
                          })
                          .catch((err) => {
                            // winston.error('repository.pull', err);
                            // todo [akamel] this masks many errors
                            throw new Error('repository not found');
                          })
                          .finally(() => {
                            delete this.p;
                          });

                return this.p;
              })
              .tap(() => {
                return this.write_git_rec();
              })
              .tap(() => {
                return this.notify({ action : 'pull' });
              });
    }

    return ret;
  }

  // todo [akamel] this might not be the best place for github api related work
  hook() {
    return this
            .hget('githook')
            .then((ret) => {
              if (!_.isEmpty(ret)) {
                return;
              }

              if (_.get(this.config(), 'platform') != 'github') {
                winston.error('hook:not-implemented', this.remote());
                return;
              }

              let github = new GitHub();

              return this
                      .list_oauth_acl()
                      .tap((tokens) => {
                        // todo [akamel] implement try logic here as well
                        let token = tokens[0];

                        if (!token) {
                          return;
                        }

                        if (config.has('codedb.hook.clean') && config.get('codedb.hook.clean')) {
                          return github
                                  .clean_hooks(this, { token })
                                  .catch((err) => {
                                    winston.error('hook::clean', this.remote(), err);
                                  });
                        }
                      })
                      .then((tokens) => {
                        return Promise
                                .fromCallback((cb) => {
                                  async.someSeries(tokens, (token, callback) => {
                                    github
                                      .create_hook(this, { token })
                                      .then((result) => {
                                        winston.info('hook', this.remote());
                                        // todo [akamel] race condition where we create multiple hooks
                                        let rec = JSON.stringify(result);
                                        return this.hset('githook', rec);
                                      })
                                      .then(() => {
                                        return true;
                                      })
                                      .catch((err) => {
                                        winston.info('hook:token:failed', this.remote(), token);
                                        return false;
                                      })
                                      .asCallback(callback);
                                  }, cb);
                                })
                                .then((ret) => {
                                  // we failed to create a hook
                                  if (ret != true) {
                                    throw new Error('hook failed');
                                  }
                                });
                      });
            });
  }

  notify(msg = {}) {
    winston.info('git:notify', this.remote());

    this
      .hook()
      .catch((err) => {
        winston.error('hook:failed', this.remote());
      });

    return pubsub
            .then((store) => {
              return this
                      .read_acl()
                      .then((public_acl) => {
                        let msg = {
                            remote  : this.remote()
                          , private : !public_acl
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
                                              remote  : this.remote()
                                            , blob    : text
                                          };

                                          return Promise.fromCallback((cb) => store.publish('codedb/pull/crontab', msg, cb));
                                        });

                        return Promise.all([ pub_pull, pub_cron ]);
                      });
            });
  }

  // todo [akamel] change etag to something other than date?
  snapshot(options = {}) {
    var { token, branch, ifnonmatch } = options;

    // todo [akamel] check ifnonmatch based on sha, not date (based on sha of HEAD branch or branch)
    // todo [akamel] we broke etag
    return this
            .sha_ify(branch, { pull : true, token })
            .then((sha) => {
              let filename = Make.path(this, { sha, format : 'gzip' });

              return Promise
                      .fromCallback((cb) => fs.access(filename, fs.constants.R_OK, cb))
                      .then(() => {
                        winston.info(`cached snapshot found ${filename}`);
                        return [sha, fs.createReadStream(filename)]
                      })
                      .catch((err) => {
                        // todo [akamel] return cached file if sha is a commit?
                        return this
                                .archive({ sha })
                                .then((tar_stream) => {
                                  if (!options.make) {
                                    winston.info(`make on snapshot not requested ${filename}`);
                                    return tar_stream;
                                  }

                                  return tar_stream;
                                  // make is requested but make not supported on this repo
                                  return Make
                                          .can(this, { sha })
                                          .then((should_build) => {
                                            if (should_build) {
                                              winston.info(`make on snapshot required ${filename}`);
                                              return new Make(this.remote()).stream(this, tar_stream, { sha, ifnonmatch });
                                            }

                                            winston.info(`make on snapshot not required ${filename}`);
                                            return tar_stream;
                                          });
                                })
                                .then((tar_stream) => {
                                  let out = tar_stream;

                                  if (options.make) {
                                    out = new PassThrough();

                                    // todo [akamel] handle pipe errors in promise
                                    // .on('error', on_err)
                                    let gziped = tar_stream.pipe(zlib.createGzip());

                                    gziped.pipe(output(filename, { flags : 'w' }));
                                    gziped.pipe(out);
                                  }


                                  return [sha, out];
                                });
                      });
            });
  }

  archive(options = {}) {
    return Promise
            .try(() => {
              return this.sha_ify(options.sha);
            })
            .then((rev) => {
              let dirname = path.join(this.path, '/.git')
                , args    = ['archive', '--format=tar', rev]
                ;

              return git_spawn(dirname, args);
            });
  }

  head() {
    return Git.Repository
            .open(this.path)
            .then((repo) => {
              return repo.head();
            });
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

  sha_ify(sha_or_branch, options = {}) {
    let { pull, token } = options;

    let func = () => Promise
                      .try(() => {
                        if (!sha_or_branch) {
                          return this.getMasterCommit();
                        }

                        return Git.Repository
                                .open(this.path)
                                .then((repo) => {
                                  let find = (name) => {
                                    return repo
                                            .getCommit(name)
                                            // if can't find commit by sha? assume it is branch name
                                            .catch((err) => repo.getBranchCommit(name));
                                  }

                                  return find(sha_or_branch)
                                          .catch((err) => {
                                            if (!pull) {
                                              throw err;
                                            }
                                            // if still fails, do a pull and try again?
                                            // todo [akamel] this isn't too clean
                                            return this.pull({ token }).then(() => find(name));
                                          })
                                });
                      })
                      .then((commit) => {
                        return commit.sha();
                      });

      if (options.cache) {
        let key = `${this.remote()}#${sha_or_branch}`;
        return cache.wrap(key, func);
      }

      return func();
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
                    // let ext = path.extname(filename);
                    let mime_type = mime.lookup(filename)
                    switch(mime_type) {
                      case 'application/javascript':
                      case 'text/x-markdown':
                      // case 'text/html':
                      ret.push({
                          path  : entry.path()
                        , sha   : entry.sha()
                      });
                      break
                    }
                    // if (ext === '.js') {
                    // }

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

  stale() {
    return this
            .read_git_rec()
            .then((m) => _.isEmpty(m))
            .tap((is_stale) => {
              if (is_stale) {
                winston.info(`stale ${this.remote()}`);
              }
            });
    // return this
    //         .updatedAt()
    //         .then((at) => {
    //           // ttl is in seconds
    //           if (!at || (Date.now() - at) / 1000 > config.get('codedb.ttl')) {
    //             return true;
    //           }
    //
    //           return false;
    //         });
  }

  config() {
    let hostname  = this.hostname()
      , ret       = _.find(config.get('git.hosts'), { hostname })
      ;

    if (!ret) {
      winston.error('config:error', this.remote(), this.hostname());
    }

    return ret;
  }

  static key(remote) {
    return git.key(remote);
  }

  static get(remote, options = {}) {
    return Promise
            .try(() => {
              let key = Repository.key(remote);

              if (!Repository.store[key]) {
                Repository.store[key] = new Repository(remote);
              }

              return Repository.store[key];
            })
            .tap((repo) => {
              let { pull, acl, token } = options;

              if (pull || acl) {
                return Promise
                        .try(() => {
                          if (pull == 'force') {
                            return true;
                          }

                          return repo.stale();
                        })
                        .then((do_pull) => {
                          if (do_pull) {
                            return repo.pull({ token });
                          }
                        });
                        // todo [akamel] set _at_ on the repo for quick access when calling updatedAt
              }
            })
            .tap((repo) => {
              let { acl, token } = options;

              if (acl) {
                return repo.acl({ token });
              }
            })
            ;
  }

  static scan(on_data, cb) {
    let cursor = 0;

    async.doWhilst(
        (callback) => {
          redis_client.scan(cursor, ['MATCH', 'repo:*'], (err, ret) => {
            if (!err) {
              cursor = ret[0];
            }

            callback(err, ret[1]);
            _.each(ret[1], on_data);
          });
        }
      , () => cursor != 0
      , cb
    );
  }

  static pull_use_acl_rec(repo) {
    return repo
            .any_acl()
            .then((token) => {
              return repo
                      .pull({ token })
                      .then(() => {
                        // winston.info('pull_use_acl_rec', repo.remote(), token);
                      })
                      .catch(() => {
                        // winston.error('pull_use_acl_rec', repo.remote(), token);
                      });
            });
  }

  static pullAll() {
    Repository.scan((key) => {
      redis_client
        .hgetallAsync(key)
        .then((data) => {
          if (data) {
            let { remote, token } = data;

            return Repository
                    .get(remote)
                    .then((repo) => Repository.pull_use_acl_rec(repo));
          }
        });
    }, () => {});
  }
}

Repository.store = {};

module.exports = Repository;
