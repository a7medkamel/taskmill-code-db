"use strict";

var Promise   = require('bluebird')
  , url       = require('url')
  , path      = require('path')
  , fs        = require('fs-extra')
  , _         = require('underscore')
  , Git       = require('nodegit')
  , GitHubApi = require('github')
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

// cloneOptions.fetchOpts = {
//   callbacks: {
//     certificateCheck: function() { return 1; },
//     credentials: function() {
//       return NodeGit.Cred.userpassPlaintextNew(GITHUB_TOKEN, "x-oauth-basic");
//     }
//   }
// };

  clone() {
    if (!this.c) {
      this.c = Promise
                .promisify(fs.ensureDir)(this.path) // todo [akamel] only create parent folder
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

  // TODO TODO TODO TODO //
  // CACHE INFO ABOUT PRIVACY IN REDIS
  // TRY CLONE WITHOUT TOKEN to TEST FOR PRIVACY
  //


  // ex: https://raw.githubusercontent.com/a7medkamel/taskmill-help/master/helloworld.js
  // var raw_url = url_join('https://raw.githubusercontent.com', username, repository, branch, path);
  // privacy() {
  //   return this
  //             .info()
  //             .then((data) => {

  //             });
  // }

  // todo [akamel] try to do memoize instead of __info
  info() {
    if (this.__info) {
      return Promise.resolve(this.__info);
    }

    var github = new GitHubApi({
        version: '3.0.0'
      , headers: { 'user-agent': 'a7medkamel' } // GitHub is happy with a unique user agent
    });

    github.authenticate({
        type    : 'oauth'
      , token   : this.token
    });

    // todo [akamel] this will cache the info as long as process is up [bad if repo privacy changes]
    return Promise
            .fromCallback((cb) => {
              github.repos.get({
                  user      : this.username
                , repo      : this.name
              }, cb);
            })
            .tap((data) => {
              this.__info = data;
            })
            ;
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

// todo [akamel] security we cache the repo with the token we are given / could be anyone's token
Repository.store = {};

module.exports = {
    get : Repository.get
};