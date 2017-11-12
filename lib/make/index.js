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

const BUILD_IMAGE_NAME = 'a7medkamel/taskmill-core-worker';

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
            .fromCallback((cb) => {
              winston.info('make:stream unpack', repository.remote(), dirname);

              let extract = tar_fs.extract(dirname);

              extract
                .on('finish', () => {
                  console.log('finish');
                  cb();
                })
                .on('error', (err) => {
                  console.error(err);
                  cb(err);
                });

              // stream.pipe(process.stdout);
              stream.pipe(extract);

              stream
                .on('end', () => { console.log('ended') })
                .on('error', (err) => { console.error(err) });
            })
            .timeout(60 * 1000)
            .catch(() => {
              console.error('caught timeout error on unpack')
            })
            .then(() => {
              let abs = path.resolve(dirname);

              winston.info('make:stream build', repository.remote(), abs);

              return dockerode
                      .run(
                          BUILD_IMAGE_NAME
                        , ['npm', 'install']
                        // , [ process.stdout, process.stderr ]
                        , undefined
                        , {
                              // Tty : false
                              WorkingDir : '/mnt/src/'
                            , HostConfig : { 'Binds' : [`${abs}/:/mnt/src/`] }
                          }
                      );
            })
            .tap((container) => {
              winston.info('make:stream status', container.output.StatusCode);
              container.remove();
            })
            .then(() => {
              winston.info('make:stream ok', repository.remote(), dirname);

              // let rm = () => {
              //   // fse.remove(dirname);
              // };

              // tar dirname and return
              return tar_fs
                      .pack(dirname)
                      // .on('finish', rm)
                      // .on('error', rm)
                      ;
            })
            .tap(() => {
              winston.info('make:stream packed', repository.remote(), dirname);
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
      return path.join('.bld', repository.hostname(), repository.pathname(), sha + '.tar.gz');

      default:
      return path.join('.bld', repository.hostname(), repository.pathname(), sha);
    }
  }

  static pull() {
    return Promise
            .fromCallback((cb) => {
              winston.info('make:pull', BUILD_IMAGE_NAME);
              dockerode.pull(BUILD_IMAGE_NAME, (err, stream) => {
                if (err) {
                  cb(err);
                  return;
                }

                dockerode.modem.followProgress(stream, (err, output) => cb(err));
              });
            })
            .tap(() => {
              winston.info('make:pull ok');
            });
  }
}

module.exports = Make;
