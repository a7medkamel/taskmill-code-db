var Promise       = require('bluebird')
  , rp            = require('request-promise')
  , _             = require('lodash')
  , url           = require('url')
  , urljoin       = require('url-join')
  , config        = require('config')
  , Repository    = require('../git/repository')
  , RedisSMQ      = require('rsmq')
  , winston       = require('winston')
  , RSMQWorker    = require('rsmq-worker')
  , XHubSignature = require('express-x-hub/lib/signature')
  ;

const qname = 'git_event';

let rsmq_opts = {
    host      : config.get('codedb.redis.host')
  , port      : config.get('codedb.redis.port')
  , options   : {
      db        : config.get('codedb.redis.db')
  }
  , ns        : 'rsmq'
};

if (config.has('codedb.redis.password')) {
  if (!_.isEmpty(config.get('codedb.redis.password'))) {
    rsmq_opts.options.password = config.get('codedb.redis.password');
  }
}

let rsmq = new RedisSMQ(rsmq_opts);

let rsmq_worker = new RSMQWorker(qname, {
                          rsmq
                        , interval      : [ 0.05, 0.1, 0.2, 0.4 ]
                        , defaultDelay  : 0
                        , autostart     : true
                        , timeout       : 30 * 1000
                      });

rsmq_worker.on('message', (message, next, id) => {
  Promise
    .try(() => {
      let msg     = JSON.parse(message)
        , remote  = msg.repository.clone_url
        ;

      winston.info(`queue:message`, remote);
      return Repository
              .get(remote, { /*token*/ })
              .then(repo => {
                return Repository.pull_use_acl_rec(repo);
              })
              // .then(repo => repo.del_git_rec())
              ;
    })
    .then(() => next())
    .catch((err) => {
      winston.error(err);
      next(false);
    });
});

rsmq_worker.on('error', (err, msg) => {
 winston.error('rsmq', err, msg);
});

rsmq_worker.on('exceeded', (msg) => {
 winston.log('rsmq:exceeded', msg);
});

rsmq_worker.on('timeout', (msg) => {
 winston.log('rsmq:timeout', msg);
});

function hook(req, res, next) {
  if (!req.isXHub) {
    winston.error('/githook', 'not xhub');
    return res.end();
  }

  if (!req.isXHubValid()) {
    winston.error('/githook', 'invalid xhub');
    return res.end();
  }

  // todo [akamel] consider adding other events if needed
  // if (!_.has(req.body, 'head_commit')) {
  //   winston.error('/githook', 'no head_commit');
  //   return res.end();
  // }
  if (!_.has(req.body, 'repository.clone_url')) {
    winston.error('/githook', 'no clone_url');
    return res.end();
  }

  Promise
    .fromCallback((cb) => {
      let message = JSON.stringify(req.body);
      rsmq_worker.send(message, cb);
    })
    .then((r) => {
      res.send({ message : 'OK' });
    })
    .catch(() => next);
}

module.exports = {
  hook
};
