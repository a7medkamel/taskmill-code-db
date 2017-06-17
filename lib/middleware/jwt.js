var Promise     = require('bluebird')
  , winston     = require('winston')
  , config      = require('config-url')
  , _           = require('lodash')
  , url         = require('url')
  , account_sdk = require('taskmill-core-account-sdk')
  ;

function token(req, res, next) {
  let token = _.get(req, 'body.token');

  if (token) {
    return next();
  }

  let bearer = req.get('Authorization');
  if (!bearer) {
    return next();
  }

  let remote = _.get(req, 'body.remote');
  if (!remote) {
    return next();
  }

  return Promise
          .try(() => {
            let { hostname } = url.parse(remote);

            return account_sdk
                    .findGitToken({ bearer })
                    .then((result) => {
                      req.body.token = result.data.token;
                    });
          })
          // ignore err
          .catch((err) => {
            winston.error(err);
          })
          .asCallback(next);

}

module.exports = {
  token
};