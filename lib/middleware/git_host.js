var Promise     = require('bluebird')
  , _           = require('lodash')
  , config      = require('config')
  , url         = require('url')
  , xhub        = require('express-x-hub')
  ;

module.exports = {
  xhub : (req, res, next) => {
    let secret = (buf) => {
      let clone_url = _.get(req.body, 'repository.clone_url')
        , hostname  = url.parse(clone_url).hostname
        , info      = _.find(config.get('git.hosts'), { hostname })
        , secret    = _.get(info, 'hook.secret')
        ;

      return secret;
    };

    xhub({ algorithm : 'sha1', secret })(req, res, next);
  }
};
