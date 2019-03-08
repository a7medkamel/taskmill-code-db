var bytes = require('bytes')
  , fs    = require('fs')
  , ms    = require('ms')
  ;

module.exports = {
  "codedb" : {
    "ttl"             : ms('10m'),
    "file_size_limit" : bytes('1mb'),
    "git-crypt"     : {
      "passphrase"  : fs.readFileSync('/run/secrets/git-crypt/passphrase', 'utf-8'),
      "key"         : fs.readFileSync('/run/secrets/git-crypt/key', 'utf-8')
      // "passphrase"  : "",
      // "key"         : ""
    },
    "registry"        : {
      "username"      : fs.readFileSync('/run/secrets/registry/username', 'utf-8'),
      "password"      : fs.readFileSync('/run/secrets/registry/password', 'utf-8'),
      "serveraddress" : fs.readFileSync('/run/secrets/registry/serveraddress', 'utf-8'),
      "prefix"        : fs.readFileSync('/run/secrets/registry/prefix', 'utf-8')
    },
    "redis" : {
      "host"          : "codedb.redis.breadboard.xyz",
      "port"          : 6379,
      "password"      : null,
      "db"            : 0
    },
    "winston"       : "info",
    "port"          : "8585",
    "populate"      : {
      "limit"       : 100
    },
    "hook" : {
      "clean" : false,
      "set" : true
    },
    "pull-on-start"   : true
  },
  "pubsub" : {
    "host"          : "codedb.redis.breadboard.xyz",
    "port"          : 6379,
    "password"      : null,
    "db"            : 0
  },
  "git" : {
    "hook_url" : "https://breadboard.io/githook",
    "hosts" : [
      {
        "hostname" : "github.com",
        "platform" : "github",
        "hook": {
          "secret" : fs.readFileSync('/run/secrets/git/hosts/github.com/hook/secret', 'utf-8')
        },
        "options" : {
          "baseUrl": "https://api.github.com",
          "headers": { }
        }
      }
    ]
  }
};
