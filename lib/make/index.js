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
  , map         = require('through2-map')
  , Dockerode   = require('dockerode')
  , zlib        = require('zlib')
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

var dockerode = new Dockerode({ Promise, socketPath : '/var/run/docker.sock' });

class Make {
  constructor(remote) {
    this.remote = remote;

    let url_parsed = url.parse(remote);

    // todo [akamel] normalize in taskmill-core-git
    this.path = path.join('.bld', _.toLower(url_parsed.hostname), _.toLower(url_parsed.pathname));
  }

  static build(repository, sha, options = {}) {
    let { tailf } = options;

    let dirname = repository.path;

    let context     = path.resolve(dirname)
      , key         = randtoken.generate(32)
      , image       = `${config.get('codedb.registry.prefix')}/${key}`
      ;

    winston.info('make:build', repository.remote());

    return Promise
            .try(() => {
              return Log.open(tailf);
            })
            .tap((log) => {
              winston.info(`${log}`);

              let buildargs     = {
                    'GPG_UID' : `git@breadboard.io`
                  , 'GPG_KEY' : `${config.get('codedb.git-crypt.key')}`
                  , 'GPG_PASSPHRASE' : `${config.get('codedb.git-crypt.passphrase')}`
                  , 'GIT_SHA' : `${sha}`
                }
              , serveraddress   = config.get('codedb.registry.serveraddress')
              , username        = config.get('codedb.registry.username')
              , password        = config.get('codedb.registry.password')
              , registryconfig  = { [serveraddress] : { username, password } }
              ;

              // memory	integer Set memory limit for build.
              // memswap	integer Total memory (memory + swap). Set as -1 to disable swap.
              // cpushares	integer CPU shares (relative weight).
              // cpusetcpus	string CPUs in which to allow execution (e.g., 0-3, 0,1).
              // cpuperiod	integer The length of a CPU period in microseconds.
              // cpuquota	integer Microseconds of CPU time that the container can get in a CPU period.

              let pack = tar_fs.pack(context,{ finalize : false, finish : (pack) => { tar_fs.pack('./data/repo', { pack }); } });

              return dockerode
                      .buildImage(pack.pipe(zlib.createGzip()), { t: [image], buildargs, registryconfig })
                      .then((out) => {
                        let m = (chunk) => {
                          if (chunk) {
                            try {
                              let obj = JSON.parse(chunk.toString());
                              return obj && obj.stream? obj.stream : '';
                            } catch(err) {
                              return '';
                            };
                          }
                          return null;
                        };

                        out.pipe(map(m)).pipe(log.stdout({ end : false }));

                        return Promise.fromCallback((cb) => dockerode.modem.followProgress(out, (err, res) => {
                          if (err) {
                            log.error(err);
                          }

                          log.end();

                          cb(err, res);
                        }, (e) => { }));
                      })
                      .then(() => {
                        // push
                        let img = dockerode.getImage(image);

                        return img.push({ authconfig : { serveraddress, username, password } });
                      })
                      .tap(() => {
                        return Make.write_build(repository, sha, image);
                      })
                      .then(() => {
                        let tailf = log.toString();

                        return { image, tailf };
                      })
                      .catch((err) => {
                        log.error(err.toString());
                        log.error(err.stack);

                        err.log = log;

                        throw err;
                      });
            })
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

  static read_build(repository, sha) {
    return repository.hget(`image.${sha}`);
  }

  static write_build(repository, sha, image) {
    return repository.hset(`image.${sha}`, image);
  }
}

module.exports = Make;
