let fs            = require('fs')
  , _             = require('lodash')
  , redis         = require('redis')
  , config        = require('config-url')
  , Promise       = require('bluebird')
  , account_sdk   = require('taskmill-core-account-sdk')
  , Repository    = require('../../lib/git/repository')
  ;

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

let fi = process.argv[2]
  , fo = process.argv[3]
  ;

let opts = {
    db              : config.get('codedb.redis.db')
  , host            : config.getUrlObject('codedb.redis').host
  , port            : config.getUrlObject('codedb.redis').port
};

if (config.has('codedb.redis.password')) {
  if (!_.isEmpty(config.get('codedb.redis.password'))) {
    opts.password = config.get('codedb.redis.password');
  }
}

let redis_client = redis.createClient(opts);

redis_client
  .flushdbAsync()
  .then(() => {
    fs.readFile(fi, 'utf8', (err, text) => {
      let arr = text.split(/\n/);

      let ret = _.chain(arr)
                  .compact()
                  .map(JSON.parse)
                  .map(i => {
                    let { remote, token } = i;

                    return {
                        repo  : new Repository(remote)
                      , token
                    }
                  })
                  .reverse()
                  .uniqBy(i => i.repo.key())
                  .reverse()
                  .value();

      Promise
        .map(ret, (i) => {
          return Promise
                  .all([
                    , i.repo.write_rec()
                    , i.repo.write_acl({ token : i.token })
                    , Promise
                        .try(() => {
                          if (i.token) {
                            return;
                          }

                          return account_sdk
                                  .issueTokenByUsername('github.com', i.repo.username())
                                  .then((bearer) => {
                                    return account_sdk.findGitToken({ bearer : `bearer ${bearer}` });
                                  })
                                  .then((result) => {
                                    i.repo.write_acl({ token : result.data.token })
                                  })
                                  .catch((err) => {
                                    // console.error('trying token', i.repo.username(), err)
                                  });
                        })
                  ])
                  .then(() => {
                    return i.repo.list_acl().then((rec) => console.log(rec, i.repo.remote()));
                  });
        })
        .catch((err) => {
          console.error(err);
        })
        .finally(() => {
          process.exit();
        })
    });
  });
