"use strict";

var Promise     = require('bluebird')
  , url         = require('url')
  , path        = require('path')
  , winston     = require('winston')
  , config      = require('config-url')
  , fse         = require('fs-extra')
  , _           = require('lodash')
  , uuid        = require('uuid')
  , Docker      = require('dockerode')
  , tar_fs      = require('tar-fs')
  ;

var dockerode = new Docker();

class Make {
  constructor(remote) {
    this.remote = remote;

    let url_parsed = url.parse(remote);

    this.path = path.join('.bld', url_parsed.hostname, url_parsed.pathname);
  }

  stream(repository, stream, options = {}) {
    let { sha, ifnonmatch } = options;

    let dirname = Make.path(repository, { sha });

    return Promise
            // todo [akamel] mkdirp might not be needed
            .fromCallback((cb) => fse.mkdirp(dirname, cb))
            .then(() => {
              return Promise
                      .fromCallback((cb) => {
                        stream
                          .pipe(tar_fs.extract(dirname))
                          .on('finish', cb)
                          .on('error', cb)
                          ;
                      });
            })
            .then(() => {
              return Promise
                      .fromCallback((cb) => {
                        dockerode
                          .run(
                              'a7medkamel/taskmill-core-worker'
                            , ['npm', 'install']
                            , [ process.stdout, process.stderr ]
                            , { 
                                  Tty : false
                                , WorkingDir : '/mnt/src/'
                                , HostConfig : { 'Binds' : [`${dirname}/:/mnt/src/`] }
                              }
                            , cb
                          );
                      });
            })
            .then(() => {
              let rm = () => {
                // fse.remove(dirname);
              };

              // tar dirname and return
              return tar_fs
                      .pack(dirname)
                      .on('finish', rm)
                      .on('error', rm)
                      ;
            });

  }

  static can(repository, options = {}) {
    return repository
            .entry('package.json', options.sha)
            .then(() => true)
            .catch(() => false)
            ;
  }

  static path(repository, options = {}) {
    let { sha } = options;

    switch(options.format) {
      case 'gzip':
      return path.join('.bld', repository.hostname, repository.pathname, sha + '.tar.gz');

      default:
      return path.join('.bld', repository.hostname, repository.pathname, sha);
    }
  }
}

module.exports = Make;

