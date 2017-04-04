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
  }

  can(disk) {
    return Promise
            .fromCallback((cb) => fse.access(path.join(disk, 'package.json'), fse.constants.R_OK, cb))
            .then(() => true)
            .catch(() => false)
            ;
  }

  stream(stream, options = {}) {
    let { branch, ifnonmatch } = options;

    let disk = path.join(process.cwd(), '.tmp', uuid.v4());

    return Promise
            .fromCallback((cb) => {
              stream
                .pipe(tar_fs.extract(disk))
                .on('finish', cb)
                .on('error', cb)
                ;
            })
            .then(() => {
              return this
                      .can(disk)
                      .then((build_required) => {
                        if (build_required) {
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
                                            , HostConfig : { 'Binds' : [`${disk}/:/mnt/src/`] }
                                          }
                                        , cb
                                      );
                                  });
                        }
                      });
            })
            .then(() => {
              let rm = () => {
                fse.remove(disk);
              };

              // tar disk and return
              return tar_fs
                      .pack(disk)
                      .on('finish', rm)
                      .on('error', rm)
                      ;
            });

  }
}

module.exports = Make;

