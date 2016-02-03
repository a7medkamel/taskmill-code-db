"use strict";

var Promise   = require('bluebird')
  , url       = require('url')
  , path      = require('path')
  , fs        = require('fs-extra')
  , _         = require('underscore')
  , Git       = require('nodegit')
  ;

class Repository {
  constructor(id, token) {
    this.id = id;
    this.token = token;

    this.remote = id;

    var url_parsed = url.parse(this.id);

    this.path = path.join('.db', url_parsed.hostname, url_parsed.pathname);

    var path_parts = url_parsed.pathname.split(path.sep);
    
    this.username = path_parts[1];
    this.name = path.basename(path_parts[2], '.git');
  }

  updatedAt() {
    return Promise
            .promisify(fs.stat)(path.join(this.path, '.git/FETCH_HEAD'))
            .then((stat) => {
              return stat.mtime.getTime();
            })
            .catch(() => {
              return Promise
                      .promisify(fs.stat)(path.join(this.path, '.git/HEAD'))
                      .then((stat) => {
                        return stat.mtime.getTime();
                      });
            })
            .catch(() => {
              return undefined;
            })
            ;
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

  // todo [akamel] cache repository info in redis [ex: is private]
  clone() {
    if (!this.c) {
      this.c = Promise
                .promisify(fs.ensureDir)(path.dirname(this.path))
                .then(() => {
                  var opt = { fetchOpts : { callbacks : { certificateCheck  : () => 1 } } }

                  return Promise
                          .resolve(Git.Clone(this.remote, this.path, opt))
                          .catch({ message : 'authentication required but no callback set' }, (err) => {
                            this.private = true;
                            
                            if (this.token) {
                              opt.fetchOpts.callbacks.credentials = () => Git.Cred.userpassPlaintextNew(this.token, 'x-oauth-basic');
                              
                              return Git.Clone(this.remote, this.path, opt);
                            } else {
                              throw err;
                            }
                          });
                })
                .catchThrow((err) => {
                  this.err = err;
                })
                .finally(() => {
                  delete this.c;
                });
    }

    return this.c;
  }

  pull() {
    var ret = this.p || this.c;

    if (!ret) {
      ret = this
              .onLocal()
              .then((local) => {
                if (!local) {
                  return this.clone();
                }

                this.p = Git.Repository
                          .open(this.path)
                          .then((repo) => {
                            var opt = { fetchOpts : { callbacks : { certificateCheck  : () => 1 } } }
                            // var opt = {};

                            if (this.token) {
                              // opt.fetchOpts = { callbacks : {} };
                              opt.fetchOpts.callbacks.credentials = () => Git.Cred.userpassPlaintextNew(this.token, 'x-oauth-basic');
                            }

                            return repo.fetch('origin', opt);
                          })
                          // .catchThrow((err) => {
                          //   this.err = err;
                          // })
                          .finally(() => {
                            delete this.p;
                          });

                return this.p;
              });
    }

    return ret;
  }

  readFile(filename, encoding) {
    return Promise.promisify(fs.readFile)(path.join(this.path, filename), encoding || 'utf8');
  }

  statFile(filename) {
    return Promise.promisify(fs.stat)(path.join(this.path, filename));
  }

  static get(id, token) {
    if (!Repository.store[id]) {
      Repository.store[id] = new Repository(id, token);
    }

    return Repository.store[id];
  }
}

// todo [akamel] security we cache the repo with the token we are given / could be anyone's token
Repository.store = {};

module.exports = {
    get : Repository.get
};