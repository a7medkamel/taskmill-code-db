"use strict";

var Promise     = require('bluebird')
  , crypto      = require('crypto')
  , url         = require('url')
  , path        = require('path')
  , winston     = require('winston')
  , config      = require('config-url')
  , fse         = require('fs-extra')
  , _           = require('lodash')
  , uuid        = require('uuid')
  , Docker      = require('dockerode')
  // todo [akamel] do we need tar-fs?
  , tar_fs      = require('tar-fs')
  , shell       = require('shelljs')
  , { Log }     = require('tailf.io-sdk')
  , redis       = require('redis')
  , randtoken   = require('rand-token').generator({ chars : 'a-z' })
  ;

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

let redis_opts = {
    db              : config.get('make.redis.db')
  , host            : config.getUrlObject('make.redis').host
  , port            : config.getUrlObject('make.redis').port
};

if (config.has('make.redis.password')) {
  if (!_.isEmpty(config.get('make.redis.password'))) {
    redis_opts.password = config.get('make.redis.password');
  }
}

let redis_client = redis.createClient(redis_opts);

var dockerode = new Docker({ Promise });

// const BUILD_IMAGE_NAME = 'a7medkamel/taskmill-core-worker';

class Make {
  constructor(remote) {
    this.remote = remote;

    let url_parsed = url.parse(remote);

    // todo [akamel] normalize in taskmill-core-git
    this.path = path.join('.bld', _.toLower(url_parsed.hostname), _.toLower(url_parsed.pathname));
  }

  static build(repository, sha, options = {}) {
    let { tailf } = options;

    // let dirname = Make.path(repository, { sha });
    let dirname = repository.path;

    let cwd         = path.resolve(dirname)
      , Dockerfile  = path.resolve('./data/repo/Dockerfile')
      , key         = randtoken.generate(32)
      , image       = `docker.breadboard.io/${key}`
      ;

    winston.info('make:build', repository.remote());

    return Promise
            .try(() => {
              return Log.open(tailf);
            })
            .tap((log) => {
              winston.info(`${log}`);

              return Promise
                      .try(() => {
                        let args = [
                            `GPG_UID="git@breadboard.io"`
                          , `GPG_KEY="$(cat ./key/pgp.asc)"`
                          , `GPG_PASSPHRASE="$(cat ./key/pgp.passphrase)"`
                          , `GIT_SHA="${sha}"`
                        ]
                        , build_arg = _.map(args, (a) => `--build-arg ${a}`).join(' ')
                        ;

                        let cmd   = `docker build -f ${Dockerfile} ${build_arg} -t ${image} ${dirname}`
                          , child = shell.exec(cmd, { async : true, silent : true })
                          ;

                        return log.pipe(child, { end : false });
                      })
                      .then(() => {
                        let cmd   = `docker push ${image}`
                          , child = shell.exec(cmd, { async : true, silent : true })
                          ;

                        return log.pipe(child, { end : true });
                      })
                      .tap(() => {
                        return Make.write_build(repository, sha, image);
                      })
                      .then((log) => {
                        let tailf = log.toString();

                        return { image, tailf };
                      })
                      .catch((err) => {
                        err.log = log;

                        throw err;
                      })
            })
  }

  // stream(repository, stream, options = {}) {
  //   let { sha, ifnonmatch, tailf } = options;
  //
  //   let dirname = Make.path(repository, { sha });
  //
  //   return Promise
  //           .fromCallback((cb) => {
  //             winston.info('make:stream unpack', repository.remote(), dirname);
  //
  //             let extract = tar_fs.extract(dirname);
  //
  //             extract
  //               .on('finish', cb)
  //               .on('error', cb);
  //
  //             stream.pipe(extract);
  //
  //             // stream
  //             //   .on('end', () => { console.log('ended') })
  //             //   .on('error', (err) => { console.error(err) });
  //           })
  //           .timeout(10 * 1000)
  //           .then(() => {
  //             let abs = path.resolve(dirname);
  //
  //             winston.info('make:stream build', repository.remote(), abs);
  //
  //             return Promise
  //                     .try(() => {
  //                       return Log.open(tailf);
  //                     })
  //                     .then((log) => {
  //                       winston.info('make:stream tailf', repository.remote(), log.identity());
  //
  //                       let stdout = log.stdout()
  //                         , stderr = log.stderr()
  //                         ;
  //
  //                       return dockerode
  //                               .run(
  //                                   BUILD_IMAGE_NAME
  //                                 , ['npm', 'i', '--verbose']
  //                                 , [ stdout, stderr ]
  //                                 , {
  //                                       Tty : false
  //                                     , WorkingDir : '/mnt/src/'
  //                                     , HostConfig : { 'Binds' : [`${abs}/:/mnt/src/`] }
  //                                   }
  //                               )
  //                               .tap(() => {
  //                                 log.end();
  //                               });
  //                     });
  //           })
  //           .then((container) => {
  //             winston.info('make:stream status', container.output.StatusCode);
  //             // container will be deleted automaticaly at end of npm run
  //             // container.remove();
  //           })
  //           .then(() => {
  //             winston.info('make:stream ok', repository.remote(), dirname);
  //
  //             // let rm = () => {
  //             //   // fse.remove(dirname);
  //             // };
  //
  //             // tar dirname and return
  //             return tar_fs
  //                     .pack(dirname)
  //                     // .on('finish', rm)
  //                     // .on('error', rm)
  //                     ;
  //           })
  //           .tap(() => {
  //             winston.info('make:stream tar-ing', repository.remote(), dirname);
  //           });
  //
  // }

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

  static read_build(repository, sha) {
    return repository.hget(`image.${sha}`);
  }

  static write_build(repository, sha, image) {
    return repository.hset(`image.${sha}`, image);
  }

  // static pull() {
  //   return Promise
  //           .fromCallback((cb) => {
  //             winston.info('make:pull', BUILD_IMAGE_NAME);
  //             dockerode.pull(BUILD_IMAGE_NAME, (err, stream) => {
  //               if (err) {
  //                 cb(err);
  //                 return;
  //               }
  //
  //               dockerode.modem.followProgress(stream, (err, output) => cb(err));
  //             });
  //           })
  //           .tap(() => {
  //             winston.info('make:pull ok');
  //           });
  // }
}

module.exports = Make;
