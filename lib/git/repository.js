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

  clone() {
    if (!this.c) {
      this.c = Promise
                .promisify(fs.ensureDir)(this.path)
                .then(() => {
                  var opt = { remoteCallbacks : { certificateCheck  : function() { return 1; } } }

                  if (this.token) {
                    opt.remoteCallbacks.credentials = function() { return Git.Cred.userpassPlaintextNew(this.token, 'x-oauth-basic'); };
                  }

                  return Git
                          .Clone(this.remote, this.path, opt)
                          .finally(() => {
                            delete this.c;
                          });
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
                            var opt = { remoteCallbacks : { certificateCheck  : function() { return 1; } } }

                            if (this.token) {
                              opt.remoteCallbacks.credentials = function() { return Git.Cred.userpassPlaintextNew(this.token, 'x-oauth-basic'); };
                            }

                            return repo.fetch('origin', opt);
                          })
                          .finally(() => {
                            delete this.p;
                          });

                return this.p;
              });
    }

    return ret;
  }

  // todo [akamel] only allow .js files
  // todo [akamel] only allow smallish files
  // todo [akamel] only allow text files
  readFile(filename) {
    return Promise.promisify(fs.readFile)(path.join(this.path, filename), 'utf8');
  }

  static get(id, token) {
    if (!Repository.store[id]) {
      Repository.store[id] = new Repository(id, token);
    }

    return Repository.store[id];
  }
}

Repository.store = {};

module.exports = {
    get : Repository.get
};