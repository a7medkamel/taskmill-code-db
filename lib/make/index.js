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

              let buildargs = {
                  'GPG_UID' : `git@breadboard.io`
                , 'GPG_KEY' : `${config.get('codedb.git-crypt.key')}`
                , 'GPG_PASSPHRASE' : `${config.get('codedb.git-crypt.passphrase')}`
                , 'GIT_SHA' : `${sha}`
              };

              let pack = tar_fs.pack(context,{ finalize : false, finish : (pack) => {
                // pack.entry({ name : 'Dockerfile' }, "hello")
                tar_fs.pack('./data/repo', { pack });
              } });

              return dockerode
                      .buildImage(pack.pipe(zlib.createGzip()), { t: image, buildargs })
                      .then((out) => {
                        dockerode.modem.demuxStream(out, log.stdout(), log.stderr());
                        // dockerode.modem.demuxStream(out, process.stdout, process.stderr);

                        // return Promise.fromCallback((cb) => dockerode.modem.followProgress(out, cb));
                        return Promise.fromCallback((cb) => dockerode.modem.followProgress(out, (err, res) => {
                          console.log(err);
                        }, (e) => {
                          console.log(e);
                        }));
                      })
                      .then(() => {
                        // push
                        let img = docker.getImage(image);

                        return img.push();
                        // return log.pipe(child, { end : true });
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
